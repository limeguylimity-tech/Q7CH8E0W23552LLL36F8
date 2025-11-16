// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();        // socket.id → { name, status }
const friendRequests = new Map(); // requesterId → targetId

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ✅ JOIN - User connects with name
  socket.on('join', (data) => {
    const name = data.name.trim() || 'Guest';
    users.set(socket.id, { name, status: 'online' });
    console.log(`${name} joined`);
    
    // Send all users to the new user
    const userList = {};
    users.forEach((user, id) => {
      userList[user.name] = user.status;
    });
    io.emit('users', userList);
  });

  // ✅ CHAT MESSAGE - Global chat
  socket.on('msg', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    console.log(`Message from ${user.name}:`, data.msg.text);
    
    // Broadcast to ALL clients including sender
    io.emit('msg', {
      server: data.server || 'home',
      channel: data.channel || 'general',
      msg: {
        user: user.name,
        text: data.msg.text,
        time: data.msg.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    });
  });

  // ✅ DIRECT MESSAGE
  socket.on('dm', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    console.log(`DM from ${user.name} to ${data.to}`);
    
    // Find recipient by name
    let recipientId = null;
    users.forEach((u, id) => {
      if (u.name === data.to) recipientId = id;
    });
    
    if (recipientId) {
      // Send to recipient
      io.to(recipientId).emit('dm', {
        from: user.name,
        to: data.to,
        msg: data.msg
      });
      // Send back to sender
      socket.emit('dm', {
        from: user.name,
        to: data.to,
        msg: data.msg
      });
    }
  });

  // ✅ FRIEND REQUEST
  socket.on('friendRequest', (data) => {
    const requester = users.get(socket.id);
    if (!requester) return;
    
    console.log(`Friend request from ${data.from} to ${data.to}`);
    
    // Find target user
    let targetId = null;
    users.forEach((u, id) => {
      if (u.name === data.to) targetId = id;
    });
    
    if (targetId) {
      friendRequests.set(socket.id, targetId);
      io.to(targetId).emit('friendRequest', {
        from: data.from,
        to: data.to
      });
    }
  });

  // ✅ FRIEND RESPONSE (accept/reject)
  socket.on('friendResponse', (data) => {
    const responder = users.get(socket.id);
    if (!responder) return;
    
    console.log(`Friend response from ${data.from} to ${data.to}:`, data.accepted);
    
    // Find the requester
    let requesterId = null;
    users.forEach((u, id) => {
      if (u.name === data.to) requesterId = id;
    });
    
    if (requesterId) {
      io.to(requesterId).emit('friendResponse', {
        from: data.from,
        to: data.to,
        accepted: data.accepted
      });
      
      if (data.accepted) {
        friendRequests.delete(requesterId);
      }
    }
  });

  // ✅ DISCONNECT
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`${user.name} disconnected`);
    }
    users.delete(socket.id);
    
    // Clean up friend requests
    friendRequests.forEach((v, k) => {
      if (v === socket.id || k === socket.id) friendRequests.delete(k);
    });
    
    // Broadcast updated user list
    const userList = {};
    users.forEach((user, id) => {
      userList[user.name] = user.status;
    });
    io.emit('users', userList);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GHOSTCORD Server running on port ${PORT}`);
  console.log(`📡 Ready for connections!`);
});
