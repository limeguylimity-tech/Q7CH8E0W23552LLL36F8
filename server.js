const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static('public'));

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, bio TEXT, avatar TEXT, status VARCHAR(20) DEFAULT 'online', theme VARCHAR(20) DEFAULT 'dark', points INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS servers (id VARCHAR(50) PRIMARY KEY, name VARCHAR(100) NOT NULL, owner VARCHAR(50) NOT NULL);
      CREATE TABLE IF NOT EXISTS channels (id SERIAL PRIMARY KEY, server_id VARCHAR(50) REFERENCES servers(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL);
      CREATE TABLE IF NOT EXISTS server_members (server_id VARCHAR(50) REFERENCES servers(id) ON DELETE CASCADE, username VARCHAR(50), PRIMARY KEY (server_id, username));
      CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, server_id VARCHAR(50), channel_name VARCHAR(100), username VARCHAR(50) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS direct_messages (id SERIAL PRIMARY KEY, from_user VARCHAR(50) NOT NULL, to_user VARCHAR(50) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS global_messages (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS friends (user1 VARCHAR(50), user2 VARCHAR(50), status VARCHAR(20) DEFAULT 'pending', PRIMARY KEY (user1, user2));
    `);
  } catch (err) { console.error(err); } finally { client.release(); }
}
initDB();

app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || username.length < 3 || !password || password.length < 4) return res.status(400).json({ error: 'Invalid input' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashed]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!result.rows.length || !await bcrypt.compare(password, result.rows[0].password)) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    res.json({ user: { username: user.username, bio: user.bio, avatar: user.avatar, status: user.status, theme: user.theme, points: user.points } });
  } catch { res.status(500).json({ error: 'Error' }); }
});

const onlineUsers = {};

function findUserSocket(username) {
  for (const [id, socket] of io.sockets.sockets) if (socket.username === username) return socket;
  return null;
}

io.on('connection', socket => {
  socket.on('join', async ({ name }) => {
    socket.username = name;
    onlineUsers[name] = 'online';

    const serversRes = await pool.query('SELECT s.id, s.name, s.owner FROM servers s JOIN server_members sm ON s.id = sm.server_id WHERE sm.username = $1', [name]);
    const serversData = {};
    for (const srv of serversRes.rows) {
      const channels = await pool.query('SELECT name FROM channels WHERE server_id = $1', [srv.id]);
      const members = await pool.query('SELECT username FROM server_members WHERE server_id = $1', [srv.id]);
      serversData[srv.id] = { name: srv.name, owner: srv.owner, channels: channels.rows.map(c => c.name), members: members.rows.map(m => m.username) };
    }

    const friendsRes = await pool.query('SELECT CASE WHEN user1 = $1 THEN user2 ELSE user1 END as friend, status FROM friends WHERE user1 = $1 OR user2 = $1', [name]);
    const friendsData = {};
    friendsRes.rows.forEach(r => {
      friendsData[r.friend] = r.status === 'pending' ? (r.friend === name ? 'sent' : 'pending') : r.status;
    });

    socket.emit('userData', { servers: serversData, friends: friendsData });
    io.emit('users', onlineUsers);
    io.emit('userOnline', { name });
  });

  socket.on('createServer', async ({ serverId, server }) => {
    await pool.query('INSERT INTO servers (id, name, owner) VALUES ($1, $2, $3)', [serverId, server.name, server.owner]);
    await pool.query('INSERT INTO server_members (server_id, username) VALUES ($1, $2)', [serverId, server.owner]);
    await pool.query('INSERT INTO channels (server_id, name) VALUES ($1, $2)', [serverId, 'general']);
    io.emit('serverCreated', { serverId, server: { ...server, channels: ['general'] } });
  });

  socket.on('getServers', async () => {
    const res = await pool.query('SELECT id, name, owner FROM servers');
    const data = {};
    for (const s of res.rows) {
      const ch = await pool.query('SELECT name FROM channels WHERE server_id = $1', [s.id]);
      const mem = await pool.query('SELECT username FROM server_members WHERE server_id = $1', [s.id]);
      data[s.id] = { name: s.name, owner: s.owner, channels: ch.rows.map(c => c.name), members: mem.rows.map(m => m.username) };
    }
    socket.emit('allServers', data);
  });

  socket.on('joinServer', async ({ serverId, username }) => {
    await pool.query('INSERT INTO server_members (server_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', [serverId, username]);
  });

  socket.on('channelMessage', async d => {
    await pool.query('INSERT INTO messages (server_id, channel_name, username, message) VALUES ($1, $2, $3, $4)', [d.server, d.channel, d.msg.user, d.msg.text]);
    io.emit('channelMessage', d);
  });

  socket.on('getMessages', async d => {
    const res = await pool.query('SELECT username, message, created_at FROM messages WHERE server_id = $1 AND channel_name = $2 ORDER BY created_at ASC LIMIT 100', [d.server, d.channel]);
    const msgs = res.rows.map(r => ({ user: r.username, text: r.message, time: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
    socket.emit('messageHistory', { server: d.server, channel: d.channel, messages: msgs });
  });

  socket.on('dm', async d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('dm', { from: d.msg.user, msg: d.msg });
  });

  socket.on('globalMessage', async d => {
    io.emit('globalMessage', { user: socket.username, text: d.text, time: d.time });
  });

  socket.on('friendRequest', async d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('friendRequest', { from: socket.username });
    socket.emit('friendRequestSent', { to: d.to });
  });

  socket.on('acceptFriend', async d => {
    await pool.query('UPDATE friends SET status = $1 WHERE (user1 = $2 AND user2 = $3) OR (user1 = $3 AND user2 = $2)', ['accepted', socket.username, d.to]);
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('acceptFriend', { from: socket.username });
    socket.emit('friendAccepted', { friend: d.to });
  });

  socket.on('removeFriend', async d => {
    await pool.query('DELETE FROM friends WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)', [socket.username, d.username]);
    const recipient = findUserSocket(d.username);
    if (recipient) recipient.emit('friendRemoved', { from: socket.username });
    socket.emit('friendRemovedConfirm', { username: d.username });
  });

  // WebRTC
  socket.on('callUser', d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('incomingCall', { from: socket.username, offer: d.offer });
  });

  socket.on('answerCall', d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('callAnswered', { from: socket.username, answer: d.answer });
  });

  socket.on('iceCandidate', d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('iceCandidate', { from: socket.username, candidate: d.candidate });
  });

  socket.on('endCall', d => {
    const recipient = findUserSocket(d.to);
    if (recipient) recipient.emit('callEnded', { from: socket.username });
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
server.listen(PORT, () => console.log(`GHOSTCORD v6.6 running on port ${PORT}`));
