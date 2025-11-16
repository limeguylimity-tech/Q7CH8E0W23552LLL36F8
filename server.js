const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const users = new Map();

io.on('connection', socket => {
  socket.on('join', data => {
    const name = (data.name || 'Guest').trim();
    users.set(socket.id, { name });
    socket.broadcast.emit('userOnline', { name });
    const list = {};
    users.forEach(u => list[u.name] = 'online');
    io.emit('users', list);
  });

  socket.on('channelMessage', data => {
    const user = users.get(socket.id);
    if (!user) return;
    const msg = { user: user.name, text: data.msg.text, time: data.msg.time };
    io.emit('channelMessage', { server: data.server, channel: data.channel, msg });
  });

  socket.on('globalMessage', msg => {
    const user = users.get(socket.id);
    if (!user) return;
    const payload = { user: user.name, text: msg.text, time: msg.time };
    io.emit('globalMessage', payload);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      io.emit('userOffline', { name: user.name });
    }
    users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GHOSTCORD v6.1 running on port ${PORT}`);
});
