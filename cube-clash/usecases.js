// Use cases - application logic. Depends only on entities and interfaces,
// never on Three.js, DOM, or any concrete adapter.
//
// Wrapped in an IIFE so this file loads cleanly from `file://`. Reads the
// entities namespace at boot time and exposes use cases via
// `CubeClash.usecases`.

(function (CubeClash) {
  'use strict';

  const E = CubeClash.entities;
  if (!E) throw new Error('usecases.js requires entities.js to be loaded first');

  const {
    Match, Bot, Projectile, Pickup, Arena,
    vec,
  } = E;
  const {
    ARENA_RADIUS, GRAVITY, JUMP_VELOCITY,
    PLAYER_MOVE_SPEED, BOT_MOVE_SPEED,
    PLAYER_FIRE_COOLDOWN, BOT_FIRE_COOLDOWN,
    PROJECTILE_DAMAGE, PROJECTILE_RADIUS,
    PLAYER_RESPAWN_DELAY, BOT_RESPAWN_DELAY,
    PLAYER_MAX_HP, BOT_COUNT,
    SCORE_HIT, SCORE_KILL, SCORE_DEATH_PENALTY,
    DASH_COOLDOWN, DASH_DURATION, DASH_SPEED_MULT,
    PICKUP_HEAL_AMOUNT, PICKUP_RESPAWN_DELAY, PICKUP_PICKUP_RADIUS,
    RESPAWN_INVULNERABILITY,
    TEAM_PLAYER, TEAM_BOT,
  } = E.constants;

  // ----- helpers -------------------------------------------------------------

  function clampPitch(p) {
    const lim = Math.PI / 2 - 0.1;
    if (p > lim) return lim;
    if (p < -lim) return -lim;
    return p;
  }

  function dist3D(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function normalize3(v) {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return vec(v.x / l, v.y / l, v.z / l);
  }

  // ----- StartMatchUseCase ---------------------------------------------------

  class StartMatchUseCase {
    constructor({ matchRepository }) {
      this.matchRepository = matchRepository;
      this.arena = new Arena(ARENA_RADIUS);
    }
    execute() {
      const match = new Match();
      match.player.position = vec(0, 0, 0);
      match.player.hp = PLAYER_MAX_HP;
      match.player.cameraYaw = 0;
      match.player.cameraPitch = -0.25;

      for (let i = 0; i < BOT_COUNT; i++) this._spawnBot(match);
      this._spawnPickup(match);

      match.emit({ type: 'matchStart' });
      this.matchRepository.save(match);
      return { match, arena: this.arena };
    }
    _spawnPickup(match) {
      // Random spot in the inner ring (avoid the very center where the
      // player spawns, and avoid the rim where bots spawn).
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 14; // 4..18 of the 25-radius arena
      const pos = vec(Math.cos(a) * r, 0.5, Math.sin(a) * r);
      const id = match.nextPickupId();
      const pickup = new Pickup({ id, kind: 'health', value: PICKUP_HEAL_AMOUNT, position: pos });
      match.pickups.set(id, pickup);
      match.emit({ type: 'pickupSpawn', position: { ...pos }, kind: 'health' });
    }
    _spawnBot(match) {
      const id = match.nextBotId();
      const pos = this.arena.randomEdgePosition();
      const bot = new Bot({ id, position: pos, color: E.randomBrightColor() });
      // Forward in entity-local space is (-sin(yaw), 0, -cos(yaw)). To face
      // the arena center from `pos`, that forward must equal -pos / |pos|.
      bot.yaw = Math.atan2(pos.x, pos.z);
      bot.invulnTimer = RESPAWN_INVULNERABILITY;
      match.bots.set(id, bot);
      return bot;
    }
  }

  // ----- HandlePlayerInputUseCase --------------------------------------------

  class HandlePlayerInputUseCase {
    execute({ match, input, dt: _dt }) {
      const p = match.player;
      if (!p) return;
      // Mouse look is always allowed (so the player can orient during the
      // pre-match countdown without being able to act).
      p.cameraYaw -= input.look.yawDelta;
      p.cameraPitch = clampPitch(p.cameraPitch - input.look.pitchDelta);
      p.yaw = p.cameraYaw;
      if (p.alive && !match.isPreMatch()) {
        p.moveInput.x = input.move.x;
        p.moveInput.z = input.move.z;
        p.fireRequested = !!input.fire;
        if (input.jump && p.onGround) p.jumpRequested = true;
        if (input.dash && p.dashCooldown <= 0 && p.dashTimer <= 0) {
          p.dashRequested = true;
        }
      } else {
        p.moveInput.x = 0;
        p.moveInput.z = 0;
        p.fireRequested = false;
        p.jumpRequested = false;
        p.dashRequested = false;
      }
    }
  }

  // ----- BotAIUseCase --------------------------------------------------------

  class BotAIUseCase {
    execute({ match, dt }) {
      // Bots stay frozen during the pre-match countdown so the player
      // can settle in. They still drift their cooldowns down.
      if (match.isPreMatch()) {
        for (const bot of match.bots.values()) bot.fireRequested = false;
        return;
      }
      const player = match.player;
      for (const bot of match.bots.values()) {
        if (!bot.alive) continue;

        let dodgeUrgency = 0;
        for (const proj of match.projectiles.values()) {
          if (!proj.alive || proj.ownerTeam === TEAM_BOT) continue;
          const d = dist3D(proj.position, bot.position);
          if (d < 4.0) dodgeUrgency = Math.max(dodgeUrgency, 1 - d / 4);
        }
        if (dodgeUrgency > 0 && bot.dodgeTimer <= 0) {
          bot.dodgeDir = Math.random() < 0.5 ? -1 : 1;
          bot.dodgeTimer = 0.35;
        }
        if (bot.dodgeTimer > 0) bot.dodgeTimer -= dt;

        const toPlayer = vec(player.position.x - bot.position.x, 0, player.position.z - bot.position.z);
        const distToPlayer = Math.hypot(toPlayer.x, toPlayer.z) || 0.0001;
        // Forward in entity-local space is (-sin(yaw), 0, -cos(yaw)); set yaw
        // so that forward points from bot toward player.
        bot.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);

        let forwardInput = 0;
        if (distToPlayer > 15) forwardInput = 1;
        else if (distToPlayer < 8) forwardInput = -1;
        else forwardInput = 0;

        let strafeInput = bot.strafeBias;
        if (bot.dodgeTimer > 0) strafeInput = bot.dodgeDir;

        const fwd = vec(toPlayer.x / distToPlayer, 0, toPlayer.z / distToPlayer);
        const right = vec(fwd.z, 0, -fwd.x);
        const move = vec(
          fwd.x * forwardInput + right.x * strafeInput,
          0,
          fwd.z * forwardInput + right.z * strafeInput,
        );
        const ml = Math.hypot(move.x, move.z) || 1;
        const speedScale = Math.min(1, Math.hypot(forwardInput, strafeInput));
        bot.velocity.x = (move.x / ml) * BOT_MOVE_SPEED * speedScale;
        bot.velocity.z = (move.z / ml) * BOT_MOVE_SPEED * speedScale;

        bot.fireRequested = (player.alive && bot.canFire() && distToPlayer < 22);
      }
    }
  }

  // ----- UpdateMatchUseCase --------------------------------------------------

  class UpdateMatchUseCase {
    constructor({ matchRepository, arena, startMatchUseCase }) {
      this.matchRepository = matchRepository;
      this.arena = arena || new Arena(ARENA_RADIUS);
      this.startMatchUseCase = startMatchUseCase;
    }

    execute({ match, dt }) {
      if (!match || match.over) return;

      // Pre-match countdown freezes the match clock and combat.
      if (match.isPreMatch()) {
        const before = Math.ceil(match.preMatch);
        match.preMatch = Math.max(0, match.preMatch - dt);
        const after = Math.ceil(match.preMatch);
        if (after !== before) {
          match.emit({ type: 'countdown', remaining: after });
        }
        if (match.preMatch === 0) match.emit({ type: 'go' });
        // Still tick hit flashes / dash cooldown so visuals don't freeze
        // forever if the player respawned mid-countdown (rare).
        this._tickHitFlashes(match, dt);
        this._tickPlayerCooldowns(match, dt);
        this.matchRepository.save(match);
        return;
      }

      match.elapsed += dt;
      match.timeLeft = Math.max(0, match.duration - match.elapsed);

      this._updatePlayerPhysicsAndFire(match, dt);
      this._updateBotsPhysicsAndFire(match, dt);
      this._updateProjectiles(match, dt);
      this._updatePickups(match, dt);
      this._handleRespawns(match, dt);
      this._tickHitFlashes(match, dt);
      this._tickPlayerCooldowns(match, dt);

      if (match.timeLeft <= 0 && !match.over) {
        match.over = true;
        match.emit({ type: 'matchOver' });
      }
      this.matchRepository.save(match);
    }

    _tickPlayerCooldowns(match, dt) {
      const p = match.player;
      if (!p) return;
      if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      if (p.dashTimer > 0) p.dashTimer = Math.max(0, p.dashTimer - dt);
      if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      for (const bot of match.bots.values()) {
        if (bot.invulnTimer > 0) bot.invulnTimer = Math.max(0, bot.invulnTimer - dt);
      }
    }

    _tickHitFlashes(match, dt) {
      for (const c of match.allCombatants()) {
        if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - dt);
      }
    }

    _applyMovement(entity, dt) {
      entity.position.x += entity.velocity.x * dt;
      entity.position.z += entity.velocity.z * dt;
      entity.position.y += entity.velocity.y * dt;
      if (entity.position.y > 0 || entity.velocity.y > 0) {
        entity.velocity.y += GRAVITY * dt;
        entity.onGround = false;
      }
      if (entity.position.y <= 0) {
        entity.position.y = 0;
        entity.velocity.y = 0;
        entity.onGround = true;
      }
      this.arena.clampPosition(entity.position);
    }

    _updatePlayerPhysicsAndFire(match, dt) {
      const p = match.player;
      if (!p || !p.alive) return;

      const cy = Math.cos(p.cameraYaw), sy = Math.sin(p.cameraYaw);
      const inX = p.moveInput.x;
      const inZ = p.moveInput.z;
      const wx = (-sy) * inZ + (cy) * inX;
      const wz = (-cy) * inZ + (-sy) * inX;
      const len = Math.hypot(wx, wz) || 1;
      const speedScale = Math.min(1, Math.hypot(inX, inZ));

      // Trigger dash on the rising edge. If no movement input, dash
      // forward along the player's look direction instead.
      if (p.dashRequested && p.dashCooldown <= 0 && p.dashTimer <= 0) {
        p.dashTimer = DASH_DURATION;
        p.dashCooldown = DASH_COOLDOWN;
        match.emit({ type: 'dash', position: { ...p.position } });
      }
      p.dashRequested = false;

      let speed = PLAYER_MOVE_SPEED * speedScale;
      let vx, vz;
      if (p.dashTimer > 0) {
        const fwdX = -sy, fwdZ = -cy;
        const ux = (speedScale > 0.01) ? (wx / len) : fwdX;
        const uz = (speedScale > 0.01) ? (wz / len) : fwdZ;
        vx = ux * PLAYER_MOVE_SPEED * DASH_SPEED_MULT;
        vz = uz * PLAYER_MOVE_SPEED * DASH_SPEED_MULT;
      } else {
        vx = (wx / len) * speed;
        vz = (wz / len) * speed;
      }
      p.velocity.x = vx;
      p.velocity.z = vz;

      if (p.jumpRequested && p.onGround) {
        p.velocity.y = JUMP_VELOCITY;
        p.onGround = false;
      }
      p.jumpRequested = false;

      this._applyMovement(p, dt);

      if (p.fireCooldown > 0) p.fireCooldown -= dt;
      if (p.fireRequested && p.canFire()) {
        this._spawnPlayerProjectile(match);
        p.fireCooldown = PLAYER_FIRE_COOLDOWN;
      }
    }

    _updateBotsPhysicsAndFire(match, dt) {
      for (const bot of match.bots.values()) {
        if (!bot.alive) continue;
        this._applyMovement(bot, dt);
        if (bot.fireCooldown > 0) bot.fireCooldown -= dt;
        if (bot.fireRequested && bot.canFire()) {
          this._spawnBotProjectile(match, bot);
          bot.fireCooldown = BOT_FIRE_COOLDOWN;
          bot.fireRequested = false;
        }
      }
    }

    _spawnPlayerProjectile(match) {
      const p = match.player;
      const cy = Math.cos(p.cameraYaw), sy = Math.sin(p.cameraYaw);
      const cp = Math.cos(p.cameraPitch), sp = Math.sin(p.cameraPitch);
      const dir = vec(-sy * cp, sp, -cy * cp);
      const muzzle = vec(
        p.position.x + dir.x * 0.8,
        p.position.y + 0.6 + dir.y * 0.4,
        p.position.z + dir.z * 0.8,
      );
      const proj = new Projectile({
        id: match.nextProjectileId(),
        ownerId: p.id,
        ownerTeam: TEAM_PLAYER,
        position: muzzle,
        direction: dir,
        color: 0xffd84d,
      });
      match.projectiles.set(proj.id, proj);
      match.emit({
        type: 'fire',
        ownerId: p.id, ownerTeam: TEAM_PLAYER,
        position: { ...muzzle }, direction: { ...dir },
      });
    }

    _spawnBotProjectile(match, bot) {
      const player = match.player;
      const target = vec(player.position.x, player.position.y + 0.5, player.position.z);
      let dir = vec(target.x - bot.position.x, target.y - (bot.position.y + 0.5), target.z - bot.position.z);
      dir = normalize3(dir);
      const spread = 0.06;
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      const muzzle = vec(
        bot.position.x + dir.x * 0.8,
        bot.position.y + 0.6,
        bot.position.z + dir.z * 0.8,
      );
      const proj = new Projectile({
        id: match.nextProjectileId(),
        ownerId: bot.id,
        ownerTeam: TEAM_BOT,
        position: muzzle,
        direction: dir,
        color: bot.color,
      });
      match.projectiles.set(proj.id, proj);
      match.emit({
        type: 'fire',
        ownerId: bot.id, ownerTeam: TEAM_BOT,
        position: { ...muzzle }, direction: { ...dir },
      });
    }

    _updatePickups(match, _dt) {
      const p = match.player;
      const consumedIds = [];
      if (p && p.alive) {
        for (const pickup of match.pickups.values()) {
          if (!pickup.alive) continue;
          const dx = p.position.x - pickup.position.x;
          const dz = p.position.z - pickup.position.z;
          const dy = (p.position.y + 0.5) - pickup.position.y;
          if (dx * dx + dz * dz + dy * dy <= PICKUP_PICKUP_RADIUS * PICKUP_PICKUP_RADIUS) {
            const healed = p.heal(pickup.value);
            pickup.alive = false;
            consumedIds.push(pickup.id);
            match.emit({
              type: 'pickup',
              kind: pickup.kind,
              value: pickup.value,
              healed,
              position: { ...pickup.position },
              consumerId: p.id,
              consumerIsPlayer: true,
            });
            match.pendingPickupSpawn = PICKUP_RESPAWN_DELAY;
          }
        }
      }
      for (const id of consumedIds) match.pickups.delete(id);

      if (match.pickups.size === 0 && match.pendingPickupSpawn > 0) {
        match.pendingPickupSpawn = Math.max(0, match.pendingPickupSpawn - _dt);
        if (match.pendingPickupSpawn === 0 && this.startMatchUseCase) {
          this.startMatchUseCase._spawnPickup(match);
        }
      }
    }

    _updateProjectiles(match, dt) {
      const removeIds = [];
      for (const proj of match.projectiles.values()) {
        proj.life -= dt;
        if (proj.life <= 0) { proj.alive = false; removeIds.push(proj.id); continue; }

        proj.trail.push({ x: proj.position.x, y: proj.position.y, z: proj.position.z });
        if (proj.trail.length > 6) proj.trail.shift();

        proj.position.x += proj.velocity.x * dt;
        proj.position.y += proj.velocity.y * dt;
        proj.position.z += proj.velocity.z * dt;

        if (proj.position.y < -1) { proj.alive = false; removeIds.push(proj.id); continue; }
        const r2 = proj.position.x ** 2 + proj.position.z ** 2;
        if (r2 > (this.arena.radius + 2) ** 2) { proj.alive = false; removeIds.push(proj.id); continue; }

        let consumed = false;
        if (proj.ownerTeam === TEAM_PLAYER) {
          for (const bot of match.bots.values()) {
            if (!bot.alive) continue;
            if (this._hits(proj, bot)) { this._onHit(match, proj, bot); consumed = true; break; }
          }
        } else if (proj.ownerTeam === TEAM_BOT) {
          const player = match.player;
          if (player.alive && this._hits(proj, player)) { this._onHit(match, proj, player); consumed = true; }
        }
        if (consumed) { proj.alive = false; removeIds.push(proj.id); }
      }
      for (const id of removeIds) match.projectiles.delete(id);
    }

    _hits(proj, target) {
      const tx = target.position.x;
      const ty = target.position.y + 0.5;
      const tz = target.position.z;
      const half = 0.5 + PROJECTILE_RADIUS;
      return Math.abs(proj.position.x - tx) <= half
          && Math.abs(proj.position.y - ty) <= half
          && Math.abs(proj.position.z - tz) <= half;
    }

    _onHit(match, proj, target) {
      const result = target.takeDamage(PROJECTILE_DAMAGE, proj.ownerId);
      const died = result.died;
      const damage = result.damage;

      let shooterName = '';
      let shooterIsPlayer = false;
      if (proj.ownerTeam === TEAM_PLAYER) {
        const p = match.player;
        p.hits += 1;
        p.score += SCORE_HIT;
        if (died) { p.kills += 1; p.score += SCORE_KILL; }
        shooterName = p.name;
        shooterIsPlayer = true;
      } else {
        const bot = match.bots.get(proj.ownerId);
        if (bot) {
          bot.hits += 1;
          bot.score += SCORE_HIT;
          if (died) { bot.kills += 1; bot.score += SCORE_KILL; }
          shooterName = bot.name;
        }
      }

      const victimIsPlayer = (target.team === TEAM_PLAYER);
      match.emit({
        type: 'hit',
        shooterId: proj.ownerId,
        shooterName,
        shooterIsPlayer,
        victimId: target.id,
        victimName: target.name,
        victimIsPlayer,
        damage,
        position: { x: target.position.x, y: target.position.y + 1.2, z: target.position.z },
        killed: died,
      });

      if (died) {
        match.emit({
          type: 'kill',
          killerId: proj.ownerId,
          killerName: shooterName,
          killerIsPlayer: shooterIsPlayer,
          victimId: target.id,
          victimName: target.name,
          victimIsPlayer,
          position: { x: target.position.x, y: target.position.y + 0.5, z: target.position.z },
        });
        if (target.team === TEAM_PLAYER) {
          match.player.score += SCORE_DEATH_PENALTY;
          match.pendingPlayerRespawn = match.elapsed + PLAYER_RESPAWN_DELAY;
        } else if (target.team === TEAM_BOT) {
          match.pendingBotSpawns.push({ at: match.elapsed + BOT_RESPAWN_DELAY });
        }
      }
    }

    _handleRespawns(match, _dt) {
      if (match.pendingPlayerRespawn !== null && match.elapsed >= match.pendingPlayerRespawn) {
        const p = match.player;
        const pos = this.arena.randomEdgePosition();
        p.position = pos;
        p.velocity = vec();
        p.hp = PLAYER_MAX_HP;
        p.alive = true;
        p.fireCooldown = 0;
        p.hitFlash = 0;
        p.onGround = true;
        // Face the arena center on respawn (see _spawnBot for derivation).
        p.cameraYaw = Math.atan2(pos.x, pos.z);
        p.yaw = p.cameraYaw;
        // Reset dash so a respawning player isn't penalised by leftover
        // cooldown from before they died.
        p.dashCooldown = 0;
        p.dashTimer = 0;
        p.invulnTimer = RESPAWN_INVULNERABILITY;
        match.pendingPlayerRespawn = null;
        match.emit({ type: 'respawn', subjectIsPlayer: true, position: { ...pos } });
      }

      const deadIds = [];
      for (const bot of match.bots.values()) {
        if (!bot.alive) deadIds.push(bot.id);
      }
      for (const id of deadIds) match.bots.delete(id);

      const remaining = [];
      for (const spawn of match.pendingBotSpawns) {
        if (match.elapsed >= spawn.at) {
          if (this.startMatchUseCase) this.startMatchUseCase._spawnBot(match);
        } else {
          remaining.push(spawn);
        }
      }
      match.pendingBotSpawns = remaining;

      while (match.bots.size + match.pendingBotSpawns.length < BOT_COUNT) {
        match.pendingBotSpawns.push({ at: match.elapsed + BOT_RESPAWN_DELAY });
      }
    }
  }

  CubeClash.usecases = {
    StartMatchUseCase, UpdateMatchUseCase,
    HandlePlayerInputUseCase, BotAIUseCase,
  };
})(window.CubeClash = window.CubeClash || {});
