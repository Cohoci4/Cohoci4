import { Character } from './character.js';
import { CollisionSystem } from './collision.js';
import { LevelGenerator } from '../level/generator.js';
import { NetworkClient } from '../network/client.js';
import { SceneManager } from '../rendering/scene.js';
import { HUD } from '../ui/hud.js';
import { AudioManager } from '../audio/audio-manager.js';
import {
  BASE_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  OVERDRIVE_MULTIPLIER,
  OVERDRIVE_DURATION,
  SEGMENT_LENGTH,
} from '../../shared/constants.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = false;
    this.paused = false;
    this.speed = BASE_SPEED;
    this.distance = 0;
    this.score = 0;
    this.credits = 0;
    this.overdriveCharge = 0;
    this.overdriveActive = false;
    this.overdriveTimer = 0;
    this.alive = true;
    this.droneMode = false;

    this.scene = new SceneManager(canvas);
    this.character = new Character(this.scene);
    this.level = new LevelGenerator(this.scene);
    this.collision = new CollisionSystem();
    this.network = new NetworkClient();
    this.hud = new HUD();
    this.audio = new AudioManager();

    this.lastTime = 0;
    this.seed = 0;
    this.nickname = 'Runner';
    this.skin = 0;

    this._boundLoop = this._gameLoop.bind(this);
  }

  async init(nickname, skin) {
    this.nickname = nickname || 'Runner';
    this.skin = skin || 0;
    await this.scene.init();
    this.character.init();
    this.hud.init();
    this.audio.init();
    this._setupInput();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.network.connect();
      this.network.on('joined', (data) => {
        this.seed = data.seed;
        this.level.setSeed(data.seed);
        this.network.playerId = data.playerId;
        if (data.contract) this.hud.showContract(data.contract);
        if (data.leaderboard) this.hud.updateLeaderboard(data.leaderboard);
        resolve(data);
      });
      this.network.on('error', reject);
      this.network.join(this.nickname, this.skin);
    });
  }

  start() {
    this.running = true;
    this.alive = true;
    this.distance = 0;
    this.score = 0;
    this.credits = 0;
    this.speed = BASE_SPEED;
    this.overdriveCharge = 0;
    this.overdriveActive = false;
    this.droneMode = false;

    this.character.reset();
    this.level.reset();
    this.level.generateInitialSegments();
    this.scene.resetCamera();

    this.lastTime = performance.now();
    this.audio.playMusic();
    requestAnimationFrame(this._boundLoop);
  }

  restart() {
    this.level.clearAll();
    this.scene.clearGhosts();
    this.start();
    this.network.join(this.nickname, this.skin);
  }

  enterDroneMode() {
    this.droneMode = true;
    this.alive = false;
    this.scene.enableDroneCamera();
    this.hud.showDroneMode();
  }

  _gameLoop(time) {
    if (!this.running) return;
    const rawDt = (time - this.lastTime) / 1000;
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    this.lastTime = time;

    if (!this.paused && this.alive) {
      this._update(dt);
    }

    if (this.droneMode) {
      this._updateDroneCamera(dt);
    }

    this.scene.updateGhosts(this.network.ghosts, this.distance, dt);
    this.scene.render(dt);
    this.hud.update({
      distance: this.distance,
      score: this.score,
      credits: this.credits,
      speed: this.speed,
      overdrive: this.overdriveCharge,
      overdriveActive: this.overdriveActive,
      alive: this.alive,
      leaderboard: this.network.leaderboard,
    });

    requestAnimationFrame(this._boundLoop);
  }

  _update(dt) {
    // Speed ramp
    if (!this.overdriveActive) {
      this.speed = Math.min(MAX_SPEED, this.speed + SPEED_INCREMENT * this.speed * dt * 60);
    }

    const effectiveSpeed = this.overdriveActive ? this.speed * OVERDRIVE_MULTIPLIER : this.speed;
    this.distance += effectiveSpeed * dt;
    this.score += Math.max(0, Math.floor(effectiveSpeed * dt));

    // Overdrive timer
    if (this.overdriveActive) {
      this.overdriveTimer -= dt * 1000;
      if (this.overdriveTimer <= 0) {
        this.overdriveActive = false;
        this.scene.setOverdriveEffect(false);
        this.audio.stopOverdrive();
      }
    }

    // Update character
    this.character.update(dt, effectiveSpeed);

    // Level generation
    const currentSegment = Math.floor(this.distance / SEGMENT_LENGTH);
    this.level.update(currentSegment, this.distance);

    // Collisions
    const playerBox = this.character.getBoundingBox(this.distance);
    const obstacles = this.level.getActiveObstacles(this.distance);
    const collectibles = this.level.getActiveCollectibles(this.distance);

    for (const obs of obstacles) {
      if (this.collision.checkAABB(playerBox, obs.box)) {
        this._onDeath();
        return;
      }
    }

    for (const col of collectibles) {
      if (!col.collected && this.collision.checkAABB(playerBox, col.box)) {
        col.collected = true;
        this._onCollect(col);
        this.level.removeCollectible(col);
      }
    }

    // Network sync
    this.network.sendState({
      d: this.distance,
      l: this.character.lane,
      j: this.character.isJumping ? 1 : 0,
      s: this.character.isSliding ? 1 : 0,
      o: this.overdriveActive ? 1 : 0,
      y: this.character.y,
      sc: this.score,
    });

    // Environment
    this.scene.updateEnvironment(this.distance, effectiveSpeed, dt);
  }

  _onCollect(collectible) {
    switch (collectible.type) {
      case 'credit':
        this.credits += collectible.value || 10;
        this.score += collectible.value || 10;
        this.audio.playCollect();
        this.network.sendAction({ type: 'collect_credit', value: collectible.value || 10 });
        break;
      case 'battery':
        this.overdriveCharge = Math.min(100, this.overdriveCharge + 25);
        this.audio.playCollect();
        break;
      case 'key_fragment':
        this.audio.playKeyFragment();
        break;
    }
    this.hud.flashCollect(collectible.type);
  }

  activateOverdrive() {
    if (this.overdriveCharge >= 100 && !this.overdriveActive) {
      this.overdriveActive = true;
      this.overdriveTimer = OVERDRIVE_DURATION;
      this.overdriveCharge = 0;
      this.scene.setOverdriveEffect(true);
      this.audio.startOverdrive();
    }
  }

  _onDeath() {
    this.alive = false;
    this.audio.playDeath();
    this.scene.playDeathEffect();
    this.network.sendDeath({ distance: this.distance, score: this.score });
    this.hud.showDeathScreen({
      distance: this.distance,
      score: this.score,
      credits: this.credits,
      onRestart: () => this.restart(),
      onDrone: () => this.enterDroneMode(),
    });
  }

  _updateDroneCamera(dt) {
    this.scene.updateDroneCamera(dt, this.network.ghosts);
  }

  _setupInput() {
    const keys = {};
    window.addEventListener('keydown', (e) => {
      if (keys[e.code]) return;
      keys[e.code] = true;

      if (!this.alive && !this.droneMode) return;

      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          this.character.moveLeft();
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.character.moveRight();
          break;
        case 'ArrowUp':
        case 'KeyW':
        case 'Space':
          e.preventDefault();
          this.character.jump();
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.character.slide();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.activateOverdrive();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });

    // Touch / swipe support
    let touchStartX = 0;
    let touchStartY = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (Math.max(absDx, absDy) < 30) {
        this.activateOverdrive();
        return;
      }

      if (absDx > absDy) {
        if (dx > 0) this.character.moveRight();
        else this.character.moveLeft();
      } else {
        if (dy < 0) this.character.jump();
        else this.character.slide();
      }
    }, { passive: false });
  }

  destroy() {
    this.running = false;
    this.network.disconnect();
    this.scene.dispose();
    this.audio.dispose();
  }
}
