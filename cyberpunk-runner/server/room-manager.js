import { encodePlayerState } from '../shared/serialization.js';
import {
  MAX_PLAYERS_PER_ROOM,
  MAX_SPEED,
  BASE_SPEED,
} from '../shared/constants.js';

export class RoomManager {
  constructor(dailySeed) {
    this.rooms = new Map();
    this.playerRoomMap = new Map();
    this.players = new Map();
    this.dailySeed = dailySeed;
    this.createRoom('main');
  }

  createRoom(id) {
    const room = {
      id,
      seed: this.dailySeed,
      players: new Set(),
      created: Date.now(),
    };
    this.rooms.set(id, room);
    return room;
  }

  joinPlayer(playerId, nickname, skin) {
    let room = this.rooms.get('main');
    if (!room || room.players.size >= MAX_PLAYERS_PER_ROOM) {
      const newId = `room-${Date.now()}`;
      room = this.createRoom(newId);
    }

    const player = {
      id: playerId,
      nickname,
      skin,
      distance: 0,
      lane: 1,
      jumping: false,
      sliding: false,
      overdrive: false,
      y: 0,
      alive: true,
      score: 0,
      credits: 0,
      lastUpdate: Date.now(),
      lastDistance: 0,
      violations: 0,
    };

    this.players.set(playerId, player);
    room.players.add(playerId);
    this.playerRoomMap.set(playerId, room.id);
    return room;
  }

  updatePlayer(playerId, data) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return false;

    const now = Date.now();
    const dt = (now - player.lastUpdate) / 1000;
    const maxDist = MAX_SPEED * dt * 1.5;

    if (data.d !== undefined) {
      const distDelta = data.d - player.lastDistance;
      if (distDelta > maxDist && dt > 0.1) {
        player.violations++;
        if (player.violations > 5) return false;
      } else {
        player.violations = Math.max(0, player.violations - 1);
      }
      player.lastDistance = data.d;
      player.distance = data.d;
    }

    if (data.l !== undefined) player.lane = Math.max(0, Math.min(2, data.l));
    if (data.j !== undefined) player.jumping = !!data.j;
    if (data.s !== undefined) player.sliding = !!data.s;
    if (data.o !== undefined) player.overdrive = !!data.o;
    if (data.y !== undefined) player.y = data.y;
    if (data.sc !== undefined) player.score = data.sc;

    player.lastUpdate = now;
    return true;
  }

  handleAction(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (data.type === 'collect_credit') {
      player.credits += data.value || 10;
      player.score += data.value || 10;
    }
  }

  playerDied(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.alive = false;
    player.finalDistance = player.distance;
    return player;
  }

  revivePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.alive = true;
  }

  removePlayer(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) room.players.delete(playerId);
    }
    this.players.delete(playerId);
    this.playerRoomMap.delete(playerId);
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  getPlayersInRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.players)
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .map(encodePlayerState);
  }

  getEncodedStates(roomId) {
    return this.getPlayersInRoom(roomId);
  }

  getLeaderboard(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.players)
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        distance: Math.round(p.distance),
        score: p.score,
        alive: p.alive,
      }));
  }

  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  checkContractProgress(roomId, contract) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const players = Array.from(room.players)
      .map((id) => this.players.get(id))
      .filter(Boolean);

    switch (contract.type) {
      case 'collect_credits':
        return players.reduce((sum, p) => sum + p.credits, 0);
      case 'total_distance':
        return players.reduce((sum, p) => sum + p.distance, 0);
      case 'alive_players':
        return players.filter((p) => p.alive).length;
      default:
        return 0;
    }
  }

  rewardContract(roomId, contract) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const playerId of room.players) {
      const player = this.players.get(playerId);
      if (player && player.alive) {
        player.credits += 200;
        player.score += 200;
      }
    }
  }
}
