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

const WORDS = [
  "apple","car","dog","cat","tree","phone","river",
  "mountain","chair","book","clock","house","sun"
];

/* ---------------- HELPERS ---------------- */

function createRoom(ownerId, ownerName, settings) {
  const roomId = nanoid(5).toUpperCase();
  rooms[roomId] = {
    roomId,
    ownerId,
    settings,
    players: {},
    order: [],
    round: 1,
    drawerIndex: 0,
    currentWord: null,
    guesses: {},
    started: false
  };

  rooms[roomId].players[ownerId] = {
    id: ownerId,
    name: ownerName,
    score: 0
  };

  rooms[roomId].order.push(ownerId);
  return rooms[roomId];
}

function pickTwoWords() {
  const shuffled = [...WORDS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 2);
}

/* ---------------- SOCKET ---------------- */

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  /* ---------- CREATE ROOM ---------- */
  socket.on("createRoom", ({ name, settings }, cb) => {
    const room = createRoom(socket.id, name, settings);
    socket.join(room.roomId);
    socket.roomId = room.roomId;
    cb({ roomId: room.roomId });
    io.to(room.roomId).emit("roomUpdate", room);
  });

  /* ---------- JOIN ROOM ---------- */
  socket.on("joinRoom", ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: "Room not found" });
    if (room.order.length >= room.settings.maxPlayers)
      return cb({ ok: false, msg: "Room full" });

    room.players[socket.id] = {
      id: socket.id,
      name,
      score: 0
    };

    room.order.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    io.to(roomId).emit("roomUpdate", room);
    cb({ ok: true });
  });

  /* ---------- RANDOM MATCH ---------- */
  socket.on("findRandom", ({ name, settings }) => {
    if (randomQueue.length > 0) {
      const other = randomQueue.shift();
      const room = createRoom(
        other.id,
        other.name,
        settings
      );

      room.players[socket.id] = {
        id: socket.id,
        name,
        score: 0
      };

      room.order.push(socket.id);

      socket.join(room.roomId);
      io.sockets.sockets.get(other.id)?.join(room.roomId);

      socket.roomId = room.roomId;
      io.to(room.roomId).emit("roomUpdate", room);
    } else {
      randomQueue.push({
        id: socket.id,
        name,
        settings
      });
    }
  });
/* ================= DRAW & GUESS CANVAS ================= */

const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");

let isDrawing = false;
let isDrawer = false; // set from server later
let currentColor = "#000000";
let currentSize = 6;

/* Resize canvas properly */
function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
window.addEventListener("resize", resizeCanvas);
setTimeout(resizeCanvas, 300);

/* Tool bindings */
document.getElementById("colorPicker").oninput = e => {
  currentColor = e.target.value;
};

document.getElementById("brushSize").oninput = e => {
  currentSize = e.target.value;
};

document.getElementById("eraserBtn").onclick = () => {
  currentColor = "#ffffff";
};

document.getElementById("clearBtn").onclick = () => {
  if (!isDrawer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (Game.state.online.socket) {
    Game.state.online.socket.emit("draw", { type: "clear" });
  }
};

/* Start drawing */
canvas.addEventListener("pointerdown", e => {
  if (!isDrawer) return;
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);

  emitDraw("begin", e.offsetX, e.offsetY);
});

/* Drawing */
canvas.addEventListener("pointermove", e => {
  if (!isDrawing || !isDrawer) return;

  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = currentSize;
  ctx.lineCap = "round";
  ctx.stroke();

  emitDraw("draw", e.offsetX, e.offsetY);
});

/* Stop drawing */
canvas.addEventListener("pointerup", () => {
  isDrawing = false;
});

/* Emit drawing to server */
function emitDraw(type, x, y) {
  if (!Game.state.online.socket) return;
  Game.state.online.socket.emit("draw", {
    type,
    x,
    y,
    color: currentColor,
    size: currentSize
  });
}

/* Receive drawing from others */
function setupDrawSocket(socket) {
  socket.on("draw", data => {
    if (data.type === "clear") {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = "round";

    if (data.type === "begin") {
      ctx.beginPath();
      ctx.moveTo(data.x, data.y);
    } else {
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
    }
  });
}

/* Clear canvas on new round */
function clearCanvasForNewRound() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

  /* ---------- START GAME ---------- */
  socket.on("startGame", () => {
    const room = rooms[socket.roomId];
    if (!room || room.ownerId !== socket.id) return;

    room.started = true;
    room.drawerIndex = 0;
    startRound(room);
  });

  function startRound(room) {
    room.currentWord = null;
    room.guesses = {};
    const drawerId = room.order[room.drawerIndex];

    const words = pickTwoWords();
    io.to(drawerId).emit("chooseWord", words);

    io.to(room.roomId).emit("roundStarted", {
      round: room.round,
      drawerId,
      drawTime: room.settings.drawTime
    });
  }

  /* ---------- WORD SELECTED ---------- */
  socket.on("wordChosen", word => {
    const room = rooms[socket.roomId];
    if (!room) return;

    room.currentWord = word.toLowerCase();
    io.to(room.roomId).emit("drawingStarted");
  });

  /* ---------- DRAWING ---------- */
  socket.on("draw", data => {
    socket.to(socket.roomId).emit("draw", data);
  });

  /* ---------- GUESS ---------- */
  socket.on("guess", text => {
    const room = rooms[socket.roomId];
    if (!room || !room.currentWord) return;

    const guess = text.toLowerCase();
    const player = room.players[socket.id];
    if (!player || room.guesses[socket.id]) return;

    if (guess === room.currentWord) {
      room.guesses[socket.id] = true;
      player.score += 100;

      io.to(room.roomId).emit("correctGuess", {
        playerId: socket.id,
        name: player.name,
        word: room.currentWord
      });

      endRound(room);
    } else {
      io.to(room.roomId).emit("chat", {
        name: player.name,
        text
      });
    }
  });

  function endRound(room) {
    room.drawerIndex =
      (room.drawerIndex + 1) % room.order.length;
    room.round++;

    if (room.round > room.settings.rounds) {
      io.to(room.roomId).emit("gameOver", {
        players: room.players
      });
      return;
    }

    setTimeout(() => startRound(room), 3000);
  }

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    delete room.players[socket.id];
    room.order = room.order.filter(id => id !== socket.id);

    if (room.order.length === 0) {
      delete rooms[socket.roomId];
    } else {
      io.to(room.roomId).emit("roomUpdate", room);
    }
  });
});

server.listen(PORT, () => {
  console.log("Draw & Guess server running on", PORT);
});



