import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
    maxHttpBufferSize: 1e7, // 10MB for images/audio
  });

  const PORT = 3000;

  // In-memory store for rooms and messages
  // Structure: { [roomId: string]: { id, name, passwordProtected, passwordHash, creatorId, messages: [] } }
  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("get-rooms", () => {
      const roomList = Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        passwordProtected: r.passwordProtected,
        userCount: io.sockets.adapter.rooms.get(r.id)?.size || 0
      }));
      socket.emit("rooms-list", roomList);
    });

    socket.on("create-room", ({ name, passwordHash }) => {
      const roomId = Math.random().toString(36).substring(2, 9);
      const creatorToken = Math.random().toString(36).substring(2, 15);
      const newRoom = {
        id: roomId,
        name,
        passwordProtected: !!passwordHash,
        passwordHash,
        creatorToken, // Store a token instead of socket.id
        messages: []
      };
      rooms.set(roomId, newRoom);
      socket.emit("room-created", { roomId, creatorToken });
      io.emit("rooms-list", Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        passwordProtected: r.passwordProtected,
        userCount: io.sockets.adapter.rooms.get(r.id)?.size || 0
      })));
    });

    socket.on("join-room", ({ roomId, passwordHash, creatorToken }) => {
      const room = rooms.get(roomId);
      if (!room) {
        return socket.emit("error", "Sala não encontrada");
      }

      if (room.passwordProtected && room.passwordHash !== passwordHash) {
        return socket.emit("error", "Senha incorreta");
      }

      socket.join(roomId);
      socket.emit("joined-room", { 
        id: room.id, 
        name: room.name, 
        isCreator: room.creatorToken === creatorToken 
      });
      
      // Send message history (already encrypted from clients)
      socket.emit("message-history", room.messages);
    });

    socket.on("send-message", ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (room && socket.rooms.has(roomId)) {
        const msgWithId = { ...message, id: Math.random().toString(36).substring(7), timestamp: Date.now() };
        room.messages.push(msgWithId);
        // Limit history to 100 messages for memory safety
        if (room.messages.length > 100) room.messages.shift();
        
        io.to(roomId).emit("new-message", msgWithId);
      }
    });

    socket.on("destroy-room", ({ roomId, creatorToken }) => {
      console.log(`Tentativa de destruir sala: ${roomId}`);
      const room = rooms.get(roomId);
      if (room && room.creatorToken === creatorToken) {
        io.to(roomId).emit("room-destroyed");
        rooms.delete(roomId);
        console.log(`Sala ${roomId} destruída com sucesso.`);
        io.emit("rooms-list", Array.from(rooms.values()).map(r => ({
          id: r.id,
          name: r.name,
          passwordProtected: r.passwordProtected,
          userCount: io.sockets.adapter.rooms.get(r.id)?.size || 0
        })));
      } else {
        console.log(`Falha ao destruir sala ${roomId}: Token inválido ou sala inexistente.`);
        socket.emit("error", "Você não tem permissão para destruir esta sala");
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
