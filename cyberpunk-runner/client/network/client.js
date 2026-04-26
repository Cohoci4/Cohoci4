import { io } from 'socket.io-client';
import { decodeWorldState } from '../../shared/serialization.js';
import { INTERPOLATION_DELAY } from '../../shared/constants.js';

export class NetworkClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.ghosts = new Map();
    this.leaderboard = [];
    this.callbacks = new Map();
    this._lastSendTime = 0;
    this._sendInterval = 50; // 20 Hz
  }

  connect() {
    const url = window.location.hostname === 'localhost'
      ? 'http://localhost:3000'
      : window.location.origin;
    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[NET] Connected:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[NET] Disconnected:', reason);
    });

    this.socket.on('joined', (data) => {
      this.playerId = data.playerId;
      // Initialize existing players as ghosts
      if (data.players) {
        for (const p of decodeWorldState(data.players)) {
          if (p.id !== this.playerId) {
            this.ghosts.set(p.id, {
              ...p,
              buffer: [],
              renderX: 0,
              renderY: 0,
              renderZ: 0,
            });
          }
        }
      }
      if (data.leaderboard) this.leaderboard = data.leaderboard;
      this._emit('joined', data);
    });

    this.socket.on('world:state', (states) => {
      const now = performance.now();
      const decoded = decodeWorldState(states);
      for (const state of decoded) {
        if (state.id === this.playerId) continue;
        let ghost = this.ghosts.get(state.id);
        if (!ghost) {
          ghost = {
            ...state,
            buffer: [],
            renderX: 0,
            renderY: 0,
            renderZ: 0,
          };
          this.ghosts.set(state.id, ghost);
        }
        ghost.buffer.push({ ...state, timestamp: now });
        // Keep only last 1 second of states
        while (ghost.buffer.length > 20) ghost.buffer.shift();
        Object.assign(ghost, state);
      }
    });

    this.socket.on('player:joined', (data) => {
      this.ghosts.set(data.id, {
        id: data.id,
        nickname: data.nickname,
        skin: data.skin,
        distance: 0,
        lane: 1,
        jumping: false,
        sliding: false,
        overdrive: false,
        y: 0,
        alive: true,
        buffer: [],
        renderX: 0,
        renderY: 0,
        renderZ: 0,
      });
    });

    this.socket.on('player:left', (data) => {
      this.ghosts.delete(data.id);
    });

    this.socket.on('player:died', (data) => {
      const ghost = this.ghosts.get(data.id);
      if (ghost) ghost.alive = false;
    });

    this.socket.on('player:revived', (data) => {
      const ghost = this.ghosts.get(data.id);
      if (ghost) ghost.alive = true;
    });

    this.socket.on('leaderboard', (data) => {
      this.leaderboard = data;
      this._emit('leaderboard', data);
    });

    this.socket.on('contract:new', (data) => {
      this._emit('contract', data);
    });

    this.socket.on('contract:completed', (data) => {
      this._emit('contractCompleted', data);
    });

    this.socket.on('mega:start', (data) => {
      this._emit('megaStart', data);
    });

    this.socket.on('mega:end', () => {
      this._emit('megaEnd');
    });

    this.socket.on('emoji', (data) => {
      this._emit('emoji', data);
    });

    this.socket.on('kick', (data) => {
      console.warn('[NET] Kicked:', data.reason);
      this._emit('kicked', data);
    });
  }

  join(nickname, skin) {
    if (this.socket) {
      this.socket.emit('join', { nickname, skin });
    }
  }

  sendState(state) {
    const now = performance.now();
    if (now - this._lastSendTime < this._sendInterval) return;
    this._lastSendTime = now;
    if (this.socket) {
      this.socket.volatile.emit('state', state);
    }
  }

  sendAction(action) {
    if (this.socket) {
      this.socket.emit('action', action);
    }
  }

  sendDeath(data) {
    if (this.socket) {
      this.socket.emit('death', data);
    }
  }

  sendEmoji(emoji) {
    if (this.socket) {
      this.socket.emit('emoji', { emoji });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event).push(callback);
  }

  _emit(event, data) {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      for (const cb of cbs) cb(data);
    }
  }

  // Interpolate ghost positions for smooth rendering
  interpolateGhost(ghost, playerDistance) {
    if (!ghost.buffer || ghost.buffer.length < 2) {
      return {
        x: ghost.renderX || 0,
        y: ghost.y || 0,
        z: -(ghost.distance - playerDistance),
      };
    }

    const renderTime = performance.now() - INTERPOLATION_DELAY;
    const buf = ghost.buffer;

    // Find surrounding states
    let prev = buf[0];
    let next = buf[1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].timestamp <= renderTime && buf[i + 1].timestamp >= renderTime) {
        prev = buf[i];
        next = buf[i + 1];
        break;
      }
    }

    const range = next.timestamp - prev.timestamp;
    const t = range > 0 ? Math.max(0, Math.min(1, (renderTime - prev.timestamp) / range)) : 0;

    return {
      x: prev.distance + (next.distance - prev.distance) * t,
      y: prev.y + (next.y - prev.y) * t,
      z: -(ghost.distance - playerDistance),
      lane: next.lane,
      jumping: next.jumping,
      sliding: next.sliding,
      overdrive: next.overdrive,
    };
  }
}
