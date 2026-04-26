// Entities layer - pure business objects with no framework dependencies.
// Vectors are plain {x, y, z} objects so this layer has zero external deps.
// Wrapped as an IIFE so this file can be loaded from `file://` without
// the ES-module / CORS restrictions that block `<script type="module" src=>`
// in Chrome and Edge. Layer boundaries are preserved through the
// `CubeClash.entities` namespace.

(function (CubeClash) {
  'use strict';

  const ARENA_RADIUS = 25;
  const GRAVITY = -15;
  const PLAYER_SIZE = 1;
  const BOT_SIZE = 1;
  const PROJECTILE_RADIUS = 0.2;
  const PROJECTILE_SPEED = 30;
  const PROJECTILE_LIFETIME = 1.0;
  const PROJECTILE_DAMAGE = 20;

  const PLAYER_FIRE_COOLDOWN = 0.4;
  const BOT_FIRE_COOLDOWN = 0.8;

  const PLAYER_MAX_HP = 100;
  const BOT_MAX_HP = 100;

  const PLAYER_MOVE_SPEED = 9;
  const BOT_MOVE_SPEED = 5;
  const JUMP_VELOCITY = Math.sqrt(2 * Math.abs(GRAVITY) * 3); // peak ≈ 3 units

  const SCORE_HIT = 10;
  const SCORE_KILL = 50;
  const SCORE_DEATH_PENALTY = -20;

  const PLAYER_RESPAWN_DELAY = 3.0;
  const BOT_RESPAWN_DELAY = 2.0;

  const MATCH_DURATION = 180; // 3 minutes
  const BOT_COUNT = 5;

  const TEAM_PLAYER = 'player';
  const TEAM_BOT = 'bot';

  function vec(x = 0, y = 0, z = 0) { return { x, y, z }; }

  class Arena {
    constructor(radius = ARENA_RADIUS) {
      this.radius = radius;
    }
    clampPosition(p) {
      const distSq = p.x * p.x + p.z * p.z;
      const max = this.radius - 0.5;
      if (distSq > max * max) {
        const d = Math.sqrt(distSq);
        const k = max / d;
        p.x *= k;
        p.z *= k;
      }
      if (p.y < 0) p.y = 0;
      return p;
    }
    randomEdgePosition() {
      const angle = Math.random() * Math.PI * 2;
      const r = this.radius - 1.5;
      return vec(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    }
  }

  class Combatant {
    constructor({ id, team, color, maxHp, position }) {
      this.id = id;
      this.team = team;
      this.color = color;
      this.maxHp = maxHp;
      this.hp = maxHp;
      this.position = position || vec();
      this.velocity = vec();
      this.yaw = 0;
      this.alive = true;
      this.onGround = true;
      this.fireCooldown = 0;
      this.hitFlash = 0;
      this.respawnTimer = 0;
      this.score = 0;
      this.kills = 0;
      this.hits = 0;
      this.deaths = 0;
    }
    takeDamage(amount, _attackerId) {
      if (!this.alive) return false;
      this.hp -= amount;
      this.hitFlash = 0.18;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deaths += 1;
        return true;
      }
      return false;
    }
    canFire() { return this.alive && this.fireCooldown <= 0; }
  }

  class Player extends Combatant {
    constructor({ id = 'player', position = vec() } = {}) {
      super({ id, team: TEAM_PLAYER, color: 0x66ff99, maxHp: PLAYER_MAX_HP, position });
      this.name = 'You';
      this.cameraYaw = 0;
      this.cameraPitch = -0.25;
      this.fireRequested = false;
      this.jumpRequested = false;
      this.moveInput = vec();
    }
  }

  class Bot extends Combatant {
    constructor({ id, position = vec(), color }) {
      super({ id, team: TEAM_BOT, color: color ?? randomBrightColor(), maxHp: BOT_MAX_HP, position });
      this.name = `Bot ${id.replace(/^bot-/, '')}`;
      this.dodgeTimer = 0;
      this.dodgeDir = 0;
      this.strafeBias = (Math.random() - 0.5) * 0.6;
      this.fireRequested = false;
    }
  }

  class Projectile {
    constructor({ id, ownerId, ownerTeam, position, direction, color }) {
      this.id = id;
      this.ownerId = ownerId;
      this.ownerTeam = ownerTeam;
      this.position = { ...position };
      const d = direction;
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      this.velocity = vec(
        (d.x / len) * PROJECTILE_SPEED,
        (d.y / len) * PROJECTILE_SPEED,
        (d.z / len) * PROJECTILE_SPEED,
      );
      this.life = PROJECTILE_LIFETIME;
      this.alive = true;
      this.color = color ?? 0xffd84d;
      this.trail = [];
    }
  }

  class Match {
    constructor({ duration = MATCH_DURATION } = {}) {
      this.duration = duration;
      this.timeLeft = duration;
      this.elapsed = 0;
      this.player = new Player();
      this.bots = new Map();
      this.projectiles = new Map();
      this.pendingBotSpawns = [];
      this.pendingPlayerRespawn = null;
      this.over = false;
      this._nextProjectileId = 1;
      this._nextBotId = 1;
    }
    nextProjectileId() { return `p-${this._nextProjectileId++}`; }
    nextBotId() { return `bot-${this._nextBotId++}`; }
    allCombatants() {
      const out = [this.player];
      for (const b of this.bots.values()) out.push(b);
      return out;
    }
  }

  const BRIGHT_COLORS = [
    0xff5566, 0xff9933, 0xffd84d, 0x66ff99,
    0x33ddff, 0x9966ff, 0xff66cc, 0xff7733,
    0x99ff33, 0x33ffaa, 0x44aaff, 0xff5599,
  ];
  function randomBrightColor() {
    return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
  }

  CubeClash.entities = {
    Arena, Player, Bot, Projectile, Match, Combatant,
    vec, randomBrightColor,
    constants: {
      ARENA_RADIUS, GRAVITY, PLAYER_SIZE, BOT_SIZE,
      PROJECTILE_RADIUS, PROJECTILE_SPEED, PROJECTILE_LIFETIME, PROJECTILE_DAMAGE,
      PLAYER_FIRE_COOLDOWN, BOT_FIRE_COOLDOWN,
      PLAYER_MAX_HP, BOT_MAX_HP,
      PLAYER_MOVE_SPEED, BOT_MOVE_SPEED, JUMP_VELOCITY,
      SCORE_HIT, SCORE_KILL, SCORE_DEATH_PENALTY,
      PLAYER_RESPAWN_DELAY, BOT_RESPAWN_DELAY,
      MATCH_DURATION, BOT_COUNT,
      TEAM_PLAYER, TEAM_BOT,
    },
  };
})(window.CubeClash = window.CubeClash || {});
