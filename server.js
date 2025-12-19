import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

/* ===== CORS (VERY IMPORTANT) ===== */
app.use(cors({
  origin: "*"
}));

/* ===== SOCKET.IO ===== */
const io = new Server(server, {
  cors: {
    origin: "https://draw-guess-fun.netlify.app",
    methods: ["GET", "POST"]
  }
});

/* ===== BASIC ROUTE ===== */
app.get("/", (req, res) => {
  res.send("Draw Guess Server Running");
});

/* ===== GAME STATE ===== */
const rooms = {};

/* ===== SOCKET EVENTS ===== */
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("createRoom", ({ name }, cb) => {
    const roomCode = Math.random().toString(36).substring(2,7).toUpperCase();
    rooms[roomCode] = {
      players: [{ id: socket.id, name }],
      drawerIndex: 0
    };
    socket.join(roomCode);
    cb?.(roomCode);
    io.to(roomCode).emit("playerJoined");
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    if (!rooms[roomCode]) return;
    rooms[roomCode].players.push({ id: socket.id, name });
    socket.join(roomCode);
    io.to(roomCode).emit("playerJoined");
  });

  socket.on("startRound", roomCode => {
    const room = rooms[roomCode];
    if (!room) return;
    const drawer = room.players[room.drawerIndex];
    io.to(roomCode).emit("startRound", {
      drawer: drawer.id === socket.id
    });
  });

  socket.on("draw", data => {
    socket.broadcast.emit("draw", data);
  });

  socket.on("guess", text => {
    io.emit("chat", text);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* ===== START SERVER (RENDER NEEDS THIS) ===== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
