import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

/* ================= BASIC SETUP ================= */
const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: "https://draw-guess-fun.netlify.app"
}));

app.get("/", (req, res) => {
  res.send("Draw & Guess Server is running");
});

/* ================= SOCKET.IO WITH CORS ================= */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/* ================= GAME STATE ================= */
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

/* ================= SOCKET EVENTS ================= */
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("createRoom", ({ name, settings }, cb) => {
    const roomId = generateRoomCode();

    rooms[roomId] = {
      roomId,
      settings,
      players: [{ id: socket.id, name }],
      order: [socket.id],
      round: 0,
      drawerIndex: 0,
      word: null
    };

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    cb({ roomId });

    io.to(roomId).emit("roomUpdate", rooms[roomId]);
  });

  socket.on("joinRoom", ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: "Room not found" });
    if (room.players.length >= room.settings.maxPlayers)
      return cb({ ok: false, msg: "Room full" });

    room.players.push({ id: socket.id, name });
    room.order.push(socket.id);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    cb({ ok: true });
    io.to(roomId).emit("roomUpdate", room);
  });

  socket.on("startGame", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    room.round = 1;
    room.drawerIndex = 0;
    startRound(room);
  });

  socket.on("wordChosen", word => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    room.word = word;
    io.to(room.roomId).emit("drawingStarted");
  });

  socket.on("draw", data => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("draw", data);
  });

  socket.on("guess", text => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.word) return;

    if (text.toLowerCase() === room.word.toLowerCase()) {
      io.to(room.roomId).emit("correctGuess", {
        name: socket.data.name
      });
      nextRound(room);
    } else {
      io.to(room.roomId).emit("chat", {
        name: socket.data.name,
        text
      });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].players =
      rooms[roomId].players.filter(p => p.id !== socket.id);
    rooms[roomId].order =
      rooms[roomId].order.filter(id => id !== socket.id);

    if (rooms[roomId].players.length === 0) {
      delete rooms[roomId];
    } else {
      io.to(roomId).emit("roomUpdate", rooms[roomId]);
    }

    console.log("User disconnected:", socket.id);
  });
});

/* ================= GAME FLOW ================= */
function startRound(room) {
  const drawerId = room.order[room.drawerIndex];
  const words = getRandomWords();

  io.to(room.roomId).emit("roundStarted", {
    round: room.round,
    drawerId
  });

  io.to(drawerId).emit("chooseWord", words);
}

function nextRound(room) {
  room.drawerIndex++;
  if (room.drawerIndex >= room.order.length) {
    room.drawerIndex = 0;
    room.round++;
  }

  if (room.round > room.settings.rounds) {
    io.to(room.roomId).emit("gameOver");
    return;
  }

  room.word = null;
  startRound(room);
}

function getRandomWords() {
  const list = [
    "apple", "car", "house", "tree", "phone",
    "dog", "cat", "bike", "sun", "chair"
  ];
  return [
    list[Math.floor(Math.random() * list.length)],
    list[Math.floor(Math.random() * list.length)]
  ];
}

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
