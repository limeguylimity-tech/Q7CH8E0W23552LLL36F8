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

const users = new Map();        // socket.id → { name, socket }
const friendRequests = new Map(); // requesterId → targetId

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Set username
  socket.on('setUser', (data) => {
    const name = data.name.trim() || 'Guest';
    users.set(socket.id, { name, socket });
    socket.broadcast.emit('userOnline', { id: socket.id, name });
    console.log(`${name} is online`);
  });

  // Send message
  socket.on('sendMsg', (msg) => {
    const user = users.get(socket.id);
    if (!user) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = { msg: { user: user.name, text: msg.text, time } };
    io.emit('msg', payload); // broadcast to all
  });

  // Friend request
  socket.on('friendRequest', (targetName) => {
    const requester = users.get(socket.id);
    if (!requester) return;
    for (const [id, u] of users) {
      if (u.name === targetName) {
        friendRequests.set(socket.id, id);
        u.socket.emit('friendRequest', { from: requester.name, fromId: socket.id });
        socket.emit('msg', { msg: { user: 'System', text: `Friend request sent to ${targetName}`, time: '' } });
        return;
      }
    }
    socket.emit('msg', { msg: { user: 'System', text: `User ${targetName} not found or offline`, time: '' } });
  });

  // Accept friend
  socket.on('acceptFriend', (requesterId) => {
    const accepter = users.get(socket.id);
    if (!accepter) return;
    const requester = users.get(requesterId);
    if (requester) {
      io.to(requesterId).emit('friendAccepted', { name: accepter.name });
      socket.emit('friendAccepted', { name: requester.name });
    }
    friendRequests.delete(requesterId);
  });

  // Decline friend
  socket.on('declineFriend', (requesterId) => {
    friendRequests.delete(requesterId);
    io.to(requesterId).emit('friendDeclined', {});
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) console.log(`${user.name} disconnected`);
    users.delete(socket.id);
    friendRequests.forEach((v, k) => {
      if (v === socket.id || k === socket.id) friendRequests.delete(k);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GHOSTCORD Server running on http://localhost:${PORT}`);
  console.log(`Open in multiple tabs to chat!`);
});