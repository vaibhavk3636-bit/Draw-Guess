const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const app = express();
const server = http.createServer(app);

// ✅ Socket.io with CORS (required for Netlify)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ✅ Render dynamic port
const PORT = process.env.PORT || 3000;

/* ---------------- DATA ---------------- */
const rooms = {};
const randomQueue = [];
const WORDS = ["apple", "car", "house", "dog", "cat", "tree", "phone"];

/* ---------------- HELPERS ---------------- */
function createRoom(ownerId) {
  const id = nanoid(6);
  rooms[id] = {
    id,
    owner: ownerId,
    players: {},
    order: [],
    drawer: null,
    word: null
  };
  return rooms[id];
}

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

/* ---------------- SOCKET ---------------- */
io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // PLAY WITH FRIEND
  socket.on("createRoom", ({ nick }, cb) => {
    const room = createRoom(socket.id);
    room.players[socket.id] = { nick, score: 0 };
    room.order.push(socket.id);

    socket.join(room.id);
    socket.roomId = room.id;

    cb({ roomId: room.id });
    io.to(room.id).emit("roomUpdate", room);
  });

  socket.on("joinRoom", ({ roomId, nick }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.players[socket.id] = { nick, score: 0 };
    room.order.push(socket.id);

    socket.join(roomId);
    socket.roomId = roomId;

    io.to(roomId).emit("roomUpdate", room);
  });

  // PLAY WITH RANDOM
  socket.on("playRandom", ({ nick }) => {
    if (randomQueue.length > 0) {
      const other = randomQueue.shift();
      const room = createRoom(other.id);

      room.players[other.id] = other.player;
      room.players[socket.id] = { nick, score: 0 };
      room.order.push(other.id, socket.id);

      socket.join(room.id);
      io.sockets.sockets.get(other.id)?.join(room.id);

      socket.roomId = room.id;
      io.to(room.id).emit("randomMatched", room);
    } else {
      randomQueue.push({
        id: socket.id,
        player: { nick, score: 0 }
      });
    }
  });

  // START GAME (OWNER)
  socket.on("startGame", () => {
    const room = rooms[socket.roomId];
    if (!room || room.owner !== socket.id) return;

    room.drawer = room.order[0];
    room.word = pickWord();

    io.to(room.drawer).emit("yourWord", room.word);
    io.to(room.id).emit("gameStarted", { drawer: room.drawer });
  });

  // DRAWING
  socket.on("draw", data => {
    socket.to(socket.roomId).emit("draw", data);
  });

  // GUESS
  socket.on("guess", text => {
    const room = rooms[socket.roomId];
    if (!room) return;

    if (text.toLowerCase() === room.word) {
      io.to(room.id).emit("correctGuess", {
        word: room.word
      });
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    delete room.players[socket.id];
    room.order = room.order.filter(id => id !== socket.id);

    if (room.order.length === 0) delete rooms[room.id];
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
