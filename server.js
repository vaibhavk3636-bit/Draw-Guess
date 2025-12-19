const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "https://draw-guess-fun.netlify.app" }
});

const PORT = process.env.PORT || 3000;

const rooms = {};
const WORDS = ["apple", "car", "dog", "cat", "tree"];

io.on("connection", socket => {

  socket.on("createRoom", ({ name }, cb) => {
    const roomId = nanoid(5);
    rooms[roomId] = {
      owner: socket.id,
      players: {
        [socket.id]: { name }
      },
      drawer: null,
      word: null
    };
    socket.join(roomId);
    socket.roomId = roomId;
    cb({ roomId });
  });

  socket.on("joinRoom", ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false });

    room.players[socket.id] = { name };
    socket.join(roomId);
    socket.roomId = roomId;

    io.to(roomId).emit("players", room.players);
    cb({ ok: true });
  });

  socket.on("startGame", () => {
    const room = rooms[socket.roomId];
    if (!room || room.owner !== socket.id) return;

    const ids = Object.keys(room.players);
    room.drawer = ids[0];
    room.word = WORDS[Math.floor(Math.random() * WORDS.length)];

    io.to(room.drawer).emit("yourWord", room.word);
    io.to(socket.roomId).emit("gameStarted", { drawer: room.drawer });
  });

  socket.on("draw", data => {
    socket.to(socket.roomId).emit("draw", data);
  });

  socket.on("guess", text => {
    const room = rooms[socket.roomId];
    if (!room) return;

    if (text.toLowerCase() === room.word) {
      io.to(socket.roomId).emit("message", `✅ ${room.players[socket.id].name} guessed the word`);
    } else {
      io.to(socket.roomId).emit("message", `${room.players[socket.id].name}: ${text}`);
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      delete rooms[socket.roomId];
    }
  });

});

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
