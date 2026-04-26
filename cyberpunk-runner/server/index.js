import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './room-manager.js';
import { getDailySeed } from '../shared/seed.js';
import {
  SERVER_TICK_RATE,
  MAX_PLAYERS_PER_ROOM,
  CONTRACT_INTERVAL,
  MEGA_EVENT_INTERVAL,
} from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Serve static build in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Room & Game State ──────────────────────────────────────────
const roomManager = new RoomManager(getDailySeed());

// ── Contracts ──────────────────────────────────────────────────
function generateContract() {
  const types = [
    { type: 'collect_credits', target: 500, label: 'Собрать 500 кредитов' },
    { type: 'total_distance', target: 2000, label: 'Суммарная дистанция 2000 м' },
    { type: 'alive_players', target: 5, label: '5 бегунов одновременно живы' },
  ];
  const contract = types[Math.floor(Math.random() * types.length)];
  return { ...contract, progress: 0, completed: false, startTime: Date.now() };
}

let currentContract = generateContract();
setInterval(() => {
  currentContract = generateContract();
  io.emit('contract:new', currentContract);
}, CONTRACT_INTERVAL);

// ── Mega Events ────────────────────────────────────────────────
let megaEventActive = false;
setInterval(() => {
  megaEventActive = true;
  const megaSeed = Date.now() ^ 0xdeadbeef;
  io.emit('mega:start', { seed: megaSeed, duration: 5 * 60 * 1000 });
  setTimeout(() => {
    megaEventActive = false;
    io.emit('mega:end');
  }, 5 * 60 * 1000);
}, MEGA_EVENT_INTERVAL);

// ── Socket.io ──────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    const nickname = (data.nickname || 'Runner').slice(0, 16);
    const skin = data.skin || 0;
    const room = roomManager.joinPlayer(socket.id, nickname, skin);
    socket.join(room.id);

    socket.emit('joined', {
      playerId: socket.id,
      seed: room.seed,
      players: roomManager.getPlayersInRoom(room.id),
      contract: currentContract,
      megaEvent: megaEventActive,
      leaderboard: roomManager.getLeaderboard(room.id),
    });

    socket.to(room.id).emit('player:joined', {
      id: socket.id,
      nickname,
      skin,
    });
  });

  socket.on('state', (data) => {
    const valid = roomManager.updatePlayer(socket.id, data);
    if (!valid) {
      socket.emit('kick', { reason: 'Invalid state detected' });
      socket.disconnect();
      return;
    }
  });

  socket.on('action', (data) => {
    roomManager.handleAction(socket.id, data);
  });

  socket.on('death', (data) => {
    const result = roomManager.playerDied(socket.id, data);
    if (result) {
      const room = roomManager.getPlayerRoom(socket.id);
      if (room) {
        io.to(room.id).emit('player:died', { id: socket.id });
        io.to(room.id).emit('leaderboard', roomManager.getLeaderboard(room.id));
      }
    }
  });

  socket.on('revive', () => {
    roomManager.revivePlayer(socket.id);
    const room = roomManager.getPlayerRoom(socket.id);
    if (room) {
      socket.to(room.id).emit('player:revived', { id: socket.id });
    }
  });

  socket.on('emoji', (data) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (room) {
      socket.to(room.id).emit('emoji', { id: socket.id, emoji: data.emoji });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Player disconnected: ${socket.id}`);
    const room = roomManager.getPlayerRoom(socket.id);
    roomManager.removePlayer(socket.id);
    if (room) {
      io.to(room.id).emit('player:left', { id: socket.id });
    }
  });
});

// ── Server Game Loop ───────────────────────────────────────────
const tickInterval = 1000 / SERVER_TICK_RATE;
setInterval(() => {
  const rooms = roomManager.getAllRooms();
  for (const room of rooms) {
    const states = roomManager.getEncodedStates(room.id);
    if (states.length > 0) {
      io.to(room.id).emit('world:state', states);
    }

    // Check contract progress
    if (currentContract && !currentContract.completed) {
      const progress = roomManager.checkContractProgress(room.id, currentContract);
      if (progress >= currentContract.target) {
        currentContract.completed = true;
        io.to(room.id).emit('contract:completed', currentContract);
        roomManager.rewardContract(room.id, currentContract);
      }
    }
  }
}, tickInterval);

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🌆 Cyberpunk Runner server on port ${PORT}`);
  console.log(`   Daily seed: ${getDailySeed()}`);
});
