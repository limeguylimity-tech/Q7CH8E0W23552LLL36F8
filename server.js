const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        bio TEXT,
        avatar TEXT,
        status VARCHAR(20) DEFAULT 'online',
        theme VARCHAR(20) DEFAULT 'dark',
        points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS servers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        owner VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        server_id VARCHAR(50) REFERENCES servers(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS server_members (
        server_id VARCHAR(50) REFERENCES servers(id) ON DELETE CASCADE,
        username VARCHAR(50),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (server_id, username)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        server_id VARCHAR(50),
        channel_name VARCHAR(100),
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS direct_messages (
        id SERIAL PRIMARY KEY,
        from_user VARCHAR(50) NOT NULL,
        to_user VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS global_messages (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS friends (
        user1 VARCHAR(50),
        user2 VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user1, user2)
      );
    `);
    console.log('✓ Database tables initialized');
  } catch (err) {
    console.error('Database init error:', err);
  } finally {
    client.release();
  }
}

initDB();

// API Routes
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || username.length < 3 || !password || password.length < 4) {
    return res.status(400).json({ error: 'Username 3+ chars, Password 4+ chars' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2)',
      [username, hashedPassword]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username taken' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true,
      user: {
        username: user.username,
        bio: user.bio,
        avatar: user.avatar,
        status: user.status,
        theme: user.theme,
        points: user.points
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.io - Real-time communication
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', async ({ name }) => {
    socket.username = name;
    onlineUsers[name] = 'online';
    
    console.log(`User ${name} joined with socket ID: ${socket.id}`);
    console.log(`Online users:`, Object.keys(onlineUsers));
    
    // Get user's servers
    const servers = await pool.query(`
      SELECT s.id, s.name, s.owner 
      FROM servers s
      JOIN server_members sm ON s.id = sm.server_id
      WHERE sm.username = $1
    `, [name]);

    // Get channels for each server
    const serversData = {};
    for (const srv of servers.rows) {
      const channels = await pool.query(
        'SELECT name FROM channels WHERE server_id = $1 ORDER BY id',
        [srv.id]
      );
      const members = await pool.query(
        'SELECT username FROM server_members WHERE server_id = $1',
        [srv.id]
      );
      serversData[srv.id] = {
        name: srv.name,
        owner: srv.owner,
        channels: channels.rows.map(c => c.name),
        members: members.rows.map(m => m.username)
      };
    }

    // Get user's friends
    const friendsData = {};
    const friends = await pool.query(`
      SELECT 
        CASE 
          WHEN user1 = $1 THEN user2
          ELSE user1
        END as friend_username,
        status,
        CASE 
          WHEN user1 = $1 AND status = 'pending' THEN 'sent'
          WHEN user2 = $1 AND status = 'pending' THEN 'pending'
          ELSE status
        END as display_status
      FROM friends 
      WHERE user1 = $1 OR user2 = $1
    `, [name]);

    friends.rows.forEach(row => {
      friendsData[row.friend_username] = row.display_status;
    });

    socket.emit('userData', { servers: serversData, friends: friendsData });
    io.emit('users', onlineUsers);
    io.emit('userOnline', { name });
  });

  socket.on('createServer', async ({ serverId, server }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(
        'INSERT INTO servers (id, name, owner) VALUES ($1, $2, $3)',
        [serverId, server.name, server.owner]
      );

      await client.query(
        'INSERT INTO server_members (server_id, username) VALUES ($1, $2)',
        [serverId, server.owner]
      );

      await client.query(
        'INSERT INTO channels (server_id, name) VALUES ($1, $2)',
        [serverId, 'general']
      );

      await client.query('COMMIT');
      
      io.emit('serverCreated', { serverId, server: { ...server, channels: ['general'], members: [server.owner] } });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error creating server:', err);
    } finally {
      client.release();
    }
  });

  socket.on('getServers', async () => {
    try {
      const servers = await pool.query('SELECT id, name, owner FROM servers');
      const allServers = {};
      
      for (const srv of servers.rows) {
        const channels = await pool.query(
          'SELECT name FROM channels WHERE server_id = $1',
          [srv.id]
        );
        const members = await pool.query(
          'SELECT username FROM server_members WHERE server_id = $1',
          [srv.id]
        );
        
        allServers[srv.id] = {
          name: srv.name,
          owner: srv.owner,
          channels: channels.rows.map(c => c.name),
          members: members.rows.map(m => m.username)
        };
      }
      
      socket.emit('allServers', allServers);
    } catch (err) {
      console.error('Error getting servers:', err);
    }
  });

  socket.on('joinServer', async ({ serverId, username }) => {
    try {
      await pool.query(
        'INSERT INTO server_members (server_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [serverId, username]
      );
    } catch (err) {
      console.error('Error joining server:', err);
    }
  });

  socket.on('channelMessage', async ({ server, channel, msg }) => {
    try {
      await pool.query(
        'INSERT INTO messages (server_id, channel_name, username, message, created_at) VALUES ($1, $2, $3, $4, $5)',
        [server, channel, msg.user, msg.text, new Date()]
      );
      io.emit('channelMessage', { server, channel, msg });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('getMessages', async ({ server, channel }) => {
    try {
      const result = await pool.query(
        'SELECT username, message, created_at FROM messages WHERE server_id = $1 AND channel_name = $2 ORDER BY created_at ASC LIMIT 100',
        [server, channel]
      );
      
      const messages = result.rows.map(row => ({
        user: row.username,
        text: row.message,
        time: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));
      
      socket.emit('messageHistory', { server, channel, messages });
    } catch (err) {
      console.error('Error getting messages:', err);
    }
  });

  socket.on('dm', async ({ to, msg }) => {
    try {
      await pool.query(
        'INSERT INTO direct_messages (from_user, to_user, message, created_at) VALUES ($1, $2, $3, $4)',
        [msg.user, to, msg.text, new Date()]
      );
      
      // Find recipient's socket and send
      for (const [id, sock] of io.sockets.sockets) {
        if (sock.username === to) {
          sock.emit('dm', { from: msg.user, msg });
          break;
        }
      }
    } catch (err) {
      console.error('Error sending DM:', err);
    }
  });

  socket.on('globalMessage', async ({ text, time }) => {
    const msg = { user: socket.username, text, time };
    try {
      await pool.query(
        'INSERT INTO global_messages (username, message, created_at) VALUES ($1, $2, $3)',
        [socket.username, text, new Date()]
      );
      io.emit('globalMessage', msg);
    } catch (err) {
      console.error('Error sending global message:', err);
    }
  });

  socket.on('friendRequest', async ({ to }) => {
    try {
      // Check if user exists
      const userExists = await pool.query('SELECT username FROM users WHERE username = $1', [to]);
      if (userExists.rows.length === 0) {
        socket.emit('friendError', { message: 'User not found' });
        return;
      }

      // Check if already friends
      const existing = await pool.query(
        'SELECT * FROM friends WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)',
        [socket.username, to]
      );
      
      if (existing.rows.length > 0) {
        socket.emit('friendError', { message: 'Already friends or request pending' });
        return;
      }

      await pool.query(
        'INSERT INTO friends (user1, user2, status) VALUES ($1, $2, $3)',
        [socket.username, to, 'pending']
      );
      
      // Notify recipient if online
      for (const [id, sock] of io.sockets.sockets) {
        if (sock.username === to) {
          sock.emit('friendRequest', { from: socket.username });
          break;
        }
      }
      
      socket.emit('friendRequestSent', { to });
    } catch (err) {
      console.error('Error sending friend request:', err);
      socket.emit('friendError', { message: 'Failed to send request' });
    }
  });

  socket.on('acceptFriend', async ({ to }) => {
    try {
      console.log(`${socket.username} is accepting friend request from ${to}`);
      
      // Update the friend status to 'accepted' for both directions
      await pool.query(
        'UPDATE friends SET status = $1 WHERE (user1 = $2 AND user2 = $3) OR (user1 = $3 AND user2 = $2)',
        ['accepted', to, socket.username]
      );
      
      console.log(`Friend status updated in database`);
      
      // Notify the person who SENT the request (the 'to' person)
      let notified = false;
      for (const [id, sock] of io.sockets.sockets) {
        if (sock.username === to) {
          console.log(`Sending acceptFriend event to ${to}`);
          sock.emit('acceptFriend', { from: socket.username });
          notified = true;
          break;
        }
      }
      
      if (!notified) {
        console.log(`${to} is not currently online`);
      }
      
      // Confirm to the person who accepted
      socket.emit('friendAccepted', { friend: to });
      console.log(`Sent friendAccepted confirmation to ${socket.username}`);
    } catch (err) {
      console.error('Error accepting friend:', err);
    }
  });

  socket.on('removeFriend', async ({ username }) => {
    try {
      console.log(`${socket.username} is removing friend ${username}`);
      
      // Delete from database
      await pool.query(
        'DELETE FROM friends WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)',
        [socket.username, username]
      );
      
      console.log(`Friend removed from database`);
      
      // Notify the other person if they're online
      for (const [id, sock] of io.sockets.sockets) {
        if (sock.username === username) {
          sock.emit('friendRemoved', { from: socket.username });
          break;
        }
      }
      
      socket.emit('friendRemovedConfirm', { username });
    } catch (err) {
      console.error('Error removing friend:', err);
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      io.emit('users', onlineUsers);
      io.emit('userOffline', { name: socket.username });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✓ GHOSTCORD server running on port ${PORT}`);
});
