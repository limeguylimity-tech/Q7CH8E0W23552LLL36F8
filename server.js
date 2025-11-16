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

const users = new Map(); // socket.id → { name }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (data) => {
    const name = data.name.trim() || 'Guest';
    users.set(socket.id, { name });
    console.log(`${name} joined`);

    // Send full user list to new user
    const userList = {};
    users.forEach((u) => {
      userList[u.name] = 'online';
    });
    socket.emit('users', userList);

    // Broadcast new user to others
    socket.broadcast.emit('userOnline', { name });
  });

  socket.on('msg', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = {
      server: data.server || 'home',
      channel: data.channel || 'general',
      msg: { user: user.name, text: data.msg.text, time }
    };
    io.emit('msg', payload);
  });

  socket.on('dm', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    let recipientId = null;
    users.forEach((u, id) => {
      if (u.name === data.to) recipientId = id;
    });
    if (recipientId) {
      io.to(recipientId).emit('dm', { from: user.name, msg: data.msg });
      socket.emit('dm', { from: user.name, msg: data.msg });
    }
  });

  socket.on('friendRequest', (data) => {
    const requester = users.get(socket.id);
    if (!requester) return;
    let targetId = null;
    users.forEach((u, id) => {
      if (u.name === data.to) targetId = id;
    });
    if (targetId) {
      io.to(targetId).emit('friendRequest', { from: requester.name, to: data.to, fromId: socket.id });
    }
  });

  socket.on('acceptFriend', (requesterId) => {
    const accepter = users.get(socket.id);
    if (!accepter) return;
    const requester = users.get(requesterId);
    if (requester) {
      io.to(requesterId).emit('friendAccepted', { name: accepter.name });
      socket.emit('friendAccepted', { name: requester.name });
    }
  });

  socket.on('declineFriend', (requesterId) => {
    const accepter = users.get(socket.id);
    if (!accepter) return;
    io.to(requesterId).emit('friendDeclined', { name: accepter.name });
  });

  socket.on('globalMessage', (msg) => {
    const user = users.get(socket.id);
    if (!user) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const payload = { user: user.name, text: msg.text, time };
    io.emit('globalMessage', payload);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`${user.name} disconnected`);
      io.emit('userOffline', { name: user.name });
    }
    users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GHOSTCORD Server running on port ${PORT}`);
  console.log(`Open in multiple tabs to chat!`);
});
