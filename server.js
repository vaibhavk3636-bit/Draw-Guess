import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://draw-guess-fun.netlify.app"
  }
});

const rooms = {};
const WORDS = ["apple","car","house","dog","tree","phone"];

io.on("connection", socket => {

  socket.on("createRoom", ({ name, settings }) => {
    const code = Math.random().toString(36).substring(2,7).toUpperCase();

    rooms[code] = {
      owner: socket.id,
      players: [{ id: socket.id, name, score: 0 }],
      settings,
      round: 0,
      drawerIndex: 0,
      word: "",
      timer: null
    };

    socket.join(code);
    socket.emit("roomCreated", { roomCode: code });
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.players.push({ id: socket.id, name, score: 0 });
    socket.join(roomCode);

    socket.emit("roomJoined", { settings: room.settings });
    io.to(roomCode).emit("roomUpdate", room.players);
  });

  socket.on("startGame", ({ roomCode }) => {
    startRound(roomCode);
  });

  socket.on("wordChosen", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    room.word = word;

    io.to(roomCode).emit("drawingStarted");
    startTimer(roomCode);
  });

  socket.on("draw", data => {
    socket.to(data.roomCode).emit("draw", data);
  });

  socket.on("guess", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (text.toLowerCase() === room.word.toLowerCase()) {
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      player.score += 100;

      io.to(roomCode).emit("correctGuess", {
        name: player.name,
        word: room.word,
        leaderboard: room.players
      });

      clearInterval(room.timer);
      startRound(roomCode);
    } else {
      const player = room.players.find(p => p.id === socket.id);
      io.to(roomCode).emit("chat", { name: player.name, text });
    }
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
    }
  });
});

/* ================= ROUND / TIMER ================= */

function startRound(code) {
  const room = rooms[code];
  if (!room) return;

  room.round++;
  if (room.round > room.settings.rounds) {
    io.to(code).emit("gameOver", room.players);
    return;
  }

  const drawer = room.players[room.drawerIndex % room.players.length];
  room.drawerIndex++;

  const words = [
    WORDS[Math.floor(Math.random()*WORDS.length)],
    WORDS[Math.floor(Math.random()*WORDS.length)]
  ];

  io.to(code).emit("roundStarted", {
    drawerId: drawer.id,
    round: room.round
  });

  io.to(drawer.id).emit("chooseWord", words);
}

function startTimer(code) {
  const room = rooms[code];
  let time = room.settings.drawTime;

  io.to(code).emit("timer", time);

  room.timer = setInterval(() => {
    time--;
    io.to(code).emit("timer", time);

    if (time <= 0) {
      clearInterval(room.timer);
      startRound(code);
    }
  }, 1000);
}

server.listen(3000);
