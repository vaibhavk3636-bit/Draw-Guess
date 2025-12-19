const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://draw-guess-fun.netlify.app",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

/* ---------------- DATA ---------------- */
const rooms = {};
const randomQueue = [];
const WORDS = ["apple", "car", "dog", "cat", "tree", "phone"];

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

function addBot(room) {
  const botId = "BOT_" + nanoid(4);
  room.players[botId] = { nick: "AI Bot 🤖", score: 0 };
  room.order.push(botId);
}

/* ---------------- SOCKET ---------------- */
io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", ({ nick }, cb) => {
    const room = createRoom(socket.id);
    room.players[socket.id] = { nick, score: 0 };
    room.order.push(socket.id);

    socket.join(room.id);
    socket.roomId = room.id;

    cb({ roomId: room.id });
    io.to(room.id).emit("roomUpdate", room);
  });

  socket.on("joinRoom", ({ roomId, nick }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false });

    room.players[socket.id] = { nick, score: 0 };
    room.order.push(socket.id);

    socket.join(roomId);
    socket.roomId = roomId;

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

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
      io.to(room.id).emit("roomUpdate", room);
    } else {
      randomQueue.push({
        id: socket.id,
        player: { nick, score: 0 }
      });

      // ⏱ Auto bot after 10 seconds
      setTimeout(() => {
        if (socket.roomId) return;
        const room = createRoom(socket.id);
        room.players[socket.id] = { nick, score: 0 };
        room.order.push(socket.id);
        addBot(room);

        socket.join(room.id);
        socket.roomId = room.id;
        io.to(room.id).emit("roomUpdate", room);
      }, 10000);
    }
  });

  socket.on("startGame", () => {
    const room = rooms[socket.roomId];
    if (!room || room.owner !== socket.id) return;

    room.drawer = room.order[0];
    room.word = pickWord();

    io.to(room.drawer).emit("yourWord", room.word);
    io.to(room.id).emit("gameStarted", { drawer: room.drawer });
  });

  socket.on("draw", data => {
    socket.to(socket.roomId).emit("draw", data);
  });

  socket.on("guess", text => {
    const room = rooms[socket.roomId];
    if (!room) return;

    if (text.toLowerCase() === room.word) {
      io.to(room.id).emit("correctGuess", {
        word: room.word
      });
    }
  });

  socket.on("leaveRoom", () => {
    socket.leave(socket.roomId);
    socket.roomId = null;
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
