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

  // Pre-match grace before AI/projectiles activate. Counts down a 3-2-1-GO
  // overlay; the match clock itself doesn't tick during this window.
  const PRE_MATCH_DURATION = 3.0;

  // Dash mechanic: short Shift-triggered burst.
  const DASH_COOLDOWN = 2.0;     // seconds between dashes
  const DASH_DURATION = 0.18;    // seconds the dash impulse is active
  const DASH_SPEED_MULT = 2.6;   // ground speed multiplier while dashing

  // Health pickup placed in the inner ring; respawns this many seconds
  // after being consumed.
  const PICKUP_HEAL_AMOUNT = 30;
  const PICKUP_RESPAWN_DELAY = 12.0;
  const PICKUP_PICKUP_RADIUS = 1.1;

  // Brief invulnerability window after the player respawns. Without this
  // five bots can volley the player back to zero hp before they finish
  // turning toward the action.
  const RESPAWN_INVULNERABILITY = 1.5;

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
      this.invulnTimer = 0; // > 0 means damage is ignored (post-respawn grace)
    }
    takeDamage(amount, _attackerId) {
      if (!this.alive) return { died: false, damage: 0 };
      if (this.invulnTimer > 0) return { died: false, damage: 0 };
      const dealt = Math.min(amount, this.hp);
      this.hp -= dealt;
      this.hitFlash = 0.18;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deaths += 1;
        return { died: true, damage: dealt };
      }
      return { died: false, damage: dealt };
    }
    heal(amount) {
      if (!this.alive) return 0;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      return this.hp - before;
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
      this.dashRequested = false;
      this.dashTimer = 0;       // > 0 while the dash impulse is active
      this.dashCooldown = 0;    // > 0 means dash is on cooldown
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

  class Pickup {
    constructor({ id, kind = 'health', value = PICKUP_HEAL_AMOUNT, position = vec() }) {
      this.id = id;
      this.kind = kind;
      this.value = value;
      this.position = { ...position };
      this.alive = true;
    }
  }

  class Match {
    constructor({ duration = MATCH_DURATION } = {}) {
      this.duration = duration;
      this.timeLeft = duration;
      this.elapsed = 0;
      this.preMatch = PRE_MATCH_DURATION;
      this.player = new Player();
      this.bots = new Map();
      this.projectiles = new Map();
      this.pickups = new Map();
      this.pendingBotSpawns = [];
      this.pendingPlayerRespawn = null;
      this.pendingPickupSpawn = 0; // seconds until next pickup spawns
      this.over = false;
      // Domain events emitted during a tick (fire, hit, kill, pickup, …).
      // Adapters drain this list to play sounds, show kill feed, etc.
      // Keeping events in the entity layer means use cases never reach
      // out to the renderer/audio/UI directly.
      this.events = [];
      this._nextProjectileId = 1;
      this._nextBotId = 1;
      this._nextPickupId = 1;
    }
    nextProjectileId() { return `p-${this._nextProjectileId++}`; }
    nextBotId() { return `bot-${this._nextBotId++}`; }
    nextPickupId() { return `pickup-${this._nextPickupId++}`; }
    emit(event) { this.events.push(event); }
    allCombatants() {
      const out = [this.player];
      for (const b of this.bots.values()) out.push(b);
      return out;
    }
    isPreMatch() { return this.preMatch > 0; }
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
    Arena, Player, Bot, Projectile, Pickup, Match, Combatant,
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
      PRE_MATCH_DURATION,
      DASH_COOLDOWN, DASH_DURATION, DASH_SPEED_MULT,
      PICKUP_HEAL_AMOUNT, PICKUP_RESPAWN_DELAY, PICKUP_PICKUP_RADIUS,
      RESPAWN_INVULNERABILITY,
      TEAM_PLAYER, TEAM_BOT,
    },
  };
})(window.CubeClash = window.CubeClash || {});
