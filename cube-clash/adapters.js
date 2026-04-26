// Adapters - concrete implementations of the abstractions in interfaces.js.
// These are the only places allowed to touch Three.js or the DOM.
//
// Wrapped in an IIFE so this file loads cleanly from `file://`. THREE is
// read from `window.THREE` (set by the inline bootstrap module in
// index.html, which is the only place that imports from the importmap).

(function (CubeClash) {
  'use strict';

  const E = CubeClash.entities;
  const I = CubeClash.interfaces;
  if (!E || !I) throw new Error('adapters.js requires entities.js and interfaces.js to be loaded first');

  const {
    ARENA_RADIUS, PROJECTILE_RADIUS,
    DASH_COOLDOWN,
  } = E.constants;
  const {
    IRenderer, IInputProvider, IUiPresenter, IMatchRepository, IAudioPresenter,
  } = I;

  // =============================================================================
  // InMemoryMatchRepository
  // =============================================================================

  class InMemoryMatchRepository extends IMatchRepository {
    constructor() { super(); this._match = null; }
    save(match) { this._match = match; }
    load() { return this._match; }
    clear() { this._match = null; }
  }

  // =============================================================================
  // InputAdapter (keyboard + mouse, with pointer lock)
  // =============================================================================

  class InputAdapter extends IInputProvider {
    constructor(canvas) {
      super();
      this.canvas = canvas;
      this.keys = new Set();
      this.fire = false;
      this.jumpQueued = false;
      this.yawDelta = 0;
      this.pitchDelta = 0;
      this.sensitivity = 0.0025;
      this._isLocked = false;

      this.dashQueued = false;
      this._gestureCallbacks = [];
      this._gestureFired = false;

      this._onKeyDown = (e) => {
        this.keys.add(e.code);
        if (e.code === 'Space') {
          this.jumpQueued = true;
          e.preventDefault();
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          if (!e.repeat) this.dashQueued = true;
          e.preventDefault();
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
      };
      this._onKeyUp = (e) => { this.keys.delete(e.code); };
      this._onMouseDown = (e) => {
        if (e.button === 0) {
          this._fireGesture();
          if (!this._isLocked) {
            this.canvas.requestPointerLock?.();
          } else {
            this.fire = true;
          }
        }
      };
      this._onMouseUp = (e) => { if (e.button === 0) this.fire = false; };
      this._onMouseMove = (e) => {
        if (!this._isLocked) return;
        this.yawDelta += (e.movementX || 0) * this.sensitivity;
        this.pitchDelta += (e.movementY || 0) * this.sensitivity;
      };
      this._onLockChange = () => {
        this._isLocked = (document.pointerLockElement === this.canvas);
        const hint = document.getElementById('pointer-lock-hint');
        if (hint) hint.classList.toggle('hidden', this._isLocked);
        if (!this._isLocked) this.fire = false;
      };

      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('keyup', this._onKeyUp);
      document.addEventListener('mousedown', this._onMouseDown);
      document.addEventListener('mouseup', this._onMouseUp);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('pointerlockchange', this._onLockChange);
    }

    isLocked() { return this._isLocked; }

    onUserGesture(cb) { this._gestureCallbacks.push(cb); }
    _fireGesture() {
      if (this._gestureFired) return;
      this._gestureFired = true;
      for (const cb of this._gestureCallbacks) {
        try { cb(); } catch (_e) { /* ignore */ }
      }
    }

    sample(_dt) {
      let mx = 0, mz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;

      const lookYaw = this.yawDelta;
      const lookPitch = this.pitchDelta;
      this.yawDelta = 0;
      this.pitchDelta = 0;

      const jump = this.jumpQueued;
      this.jumpQueued = false;

      const dash = this.dashQueued;
      this.dashQueued = false;

      return {
        move: { x: mx, z: mz },
        look: { yawDelta: lookYaw, pitchDelta: lookPitch },
        fire: this.fire && this._isLocked,
        jump,
        dash: dash && this._isLocked,
      };
    }

    dispose() {
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('keyup', this._onKeyUp);
      document.removeEventListener('mousedown', this._onMouseDown);
      document.removeEventListener('mouseup', this._onMouseUp);
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('pointerlockchange', this._onLockChange);
    }
  }

  // =============================================================================
  // ThreeRendererAdapter
  // =============================================================================

  function makeArenaTexture(THREE) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size/2, size/2, 20, size/2, size/2, size/2);
    grad.addColorStop(0, '#2a3658');
    grad.addColorStop(1, '#141a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    const step = size / 16;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step); ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 216, 77, 0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 6, 0, Math.PI * 2);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function makeSkyTexture(THREE) {
    const w = 32, h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0e1330');
    g.addColorStop(0.5, '#3a4d8c');
    g.addColorStop(0.85, '#ffb37a');
    g.addColorStop(1, '#ffe0a8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  class HpBar {
    constructor(THREE) {
      this.group = new THREE.Group();
      const bgGeo = new THREE.PlaneGeometry(1.2, 0.14);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7, depthTest: false });
      this.bg = new THREE.Mesh(bgGeo, bgMat);
      this.bg.renderOrder = 999;

      const fgGeo = new THREE.PlaneGeometry(1.16, 0.10);
      fgGeo.translate(0.58, 0, 0);
      const fgMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, depthTest: false });
      this.fg = new THREE.Mesh(fgGeo, fgMat);
      this.fg.position.x = -0.58;
      this.fg.renderOrder = 1000;

      this.group.add(this.bg);
      this.group.add(this.fg);
    }
    setPercent(p) {
      this.fg.scale.x = Math.max(0.0001, Math.min(1, p));
      const c = this.fg.material.color;
      if (p > 0.6) c.setHex(0x66ff99);
      else if (p > 0.3) c.setHex(0xffd84d);
      else c.setHex(0xff5566);
    }
  }

  class CombatantView {
    constructor(THREE, combatant) {
      this.id = combatant.id;
      this.combatant = combatant;
      this.group = new THREE.Group();

      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: combatant.color,
        roughness: 0.4,
        metalness: 0.1,
        emissive: 0x000000,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.position.y = 0.5;
      this.group.add(this.mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
      this.edges = new THREE.LineSegments(edges, lineMat);
      this.edges.position.copy(this.mesh.position);
      this.group.add(this.edges);

      const wedgeGeo = new THREE.ConeGeometry(0.18, 0.4, 4);
      wedgeGeo.rotateX(-Math.PI / 2);
      const wedgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
      this.wedge.position.set(0, 0.5, -0.7);
      this.group.add(this.wedge);

      this.hpBar = new HpBar(THREE);
      this.hpBar.group.position.y = 1.5;
      this.group.add(this.hpBar.group);
    }
    update(combatant, camera) {
      this.combatant = combatant;
      this.group.visible = combatant.alive;
      this.group.position.set(combatant.position.x, combatant.position.y, combatant.position.z);
      this.group.rotation.y = combatant.yaw;
      this.hpBar.setPercent(combatant.hp / combatant.maxHp);
      if (camera) this.hpBar.group.lookAt(camera.position);

      const flash = combatant.hitFlash || 0;
      this.mesh.material.emissive.setHex(0xffffff);
      this.mesh.material.emissiveIntensity = Math.min(1, flash * 4);

      // Post-respawn invulnerability blink: alternate opacity.
      if (combatant.invulnTimer > 0) {
        const blink = (Math.floor(combatant.invulnTimer * 12) % 2) === 0 ? 0.45 : 1;
        this.mesh.material.transparent = true;
        this.mesh.material.opacity = blink;
        this.edges.material.opacity = 0.2 * blink + 0.15;
      } else {
        this.mesh.material.transparent = false;
        this.mesh.material.opacity = 1;
        this.edges.material.opacity = 0.35;
      }
    }
    dispose() {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.edges.geometry.dispose();
      this.edges.material.dispose();
      this.wedge.geometry.dispose();
      this.wedge.material.dispose();
      this.hpBar.bg.geometry.dispose();
      this.hpBar.bg.material.dispose();
      this.hpBar.fg.geometry.dispose();
      this.hpBar.fg.material.dispose();
    }
  }

  // =============================================================================
  // PickupView — floating, glowing green plus sign
  // =============================================================================

  class PickupView {
    constructor(THREE, pickup) {
      this.id = pickup.id;
      this.group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x66ff99, emissive: 0x33dd66, emissiveIntensity: 0.7,
        roughness: 0.3, metalness: 0.1,
      });
      const armX = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.22), mat);
      const armY = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), mat);
      const armZ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.9), mat);
      this.group.add(armX);
      this.group.add(armY);
      this.group.add(armZ);
      this._arms = [armX, armY, armZ];
      this._sharedMat = mat;

      // Glow halo: a slightly larger transparent box for emissive bloom feel.
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x66ff99, transparent: true, opacity: 0.18,
      });
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), haloMat);
      this.halo = halo;
      this.group.add(halo);

      this._t = 0;
    }
    update(pickup, dt) {
      this._t += dt;
      this.group.position.set(
        pickup.position.x,
        pickup.position.y + Math.sin(this._t * 2.5) * 0.15,
        pickup.position.z,
      );
      this.group.rotation.y = this._t * 1.2;
    }
    dispose() {
      for (const arm of this._arms) arm.geometry.dispose();
      this._sharedMat.dispose();
      this.halo.geometry.dispose();
      this.halo.material.dispose();
    }
  }

  // =============================================================================
  // Procedural fx: muzzle flash, damage number, screen shake
  // =============================================================================

  function makeDamageNumberTexture(THREE, text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 44px system-ui, -apple-system, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  class ProjectileView {
    constructor(THREE, projectile) {
      this.id = projectile.id;
      this.group = new THREE.Group();
      const headGeo = new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 12);
      const headMat = new THREE.MeshBasicMaterial({ color: projectile.color });
      this.head = new THREE.Mesh(headGeo, headMat);
      this.group.add(this.head);

      this.trailMeshes = [];
      for (let i = 0; i < 5; i++) {
        const g = new THREE.SphereGeometry(PROJECTILE_RADIUS * (1 - i * 0.12), 8, 8);
        const m = new THREE.MeshBasicMaterial({
          color: projectile.color,
          transparent: true,
          opacity: 0.5 - i * 0.08,
        });
        const mesh = new THREE.Mesh(g, m);
        this.group.add(mesh);
        this.trailMeshes.push(mesh);
      }
    }
    update(projectile) {
      this.head.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      const t = projectile.trail;
      for (let i = 0; i < this.trailMeshes.length; i++) {
        const m = this.trailMeshes[i];
        const sample = t[t.length - 1 - i];
        if (sample) {
          m.visible = true;
          m.position.set(sample.x, sample.y, sample.z);
        } else {
          m.visible = false;
        }
      }
    }
    dispose() {
      this.head.geometry.dispose();
      this.head.material.dispose();
      for (const m of this.trailMeshes) {
        m.geometry.dispose(); m.material.dispose();
      }
    }
  }

  class ThreeRendererAdapter extends IRenderer {
    constructor(canvas) {
      super();
      const THREE = window.THREE;
      if (!THREE) throw new Error('window.THREE is not loaded');
      this.THREE = THREE;
      this.canvas = canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.scene = new THREE.Scene();
      this.scene.background = makeSkyTexture(THREE);

      this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
      this.camera.position.set(0, 6, 10);

      // Transient FX state.
      this._muzzleFlashes = [];      // {mesh, t, life}
      this._damageNumbers = [];      // {sprite, t, life, vy}
      this._shakeMag = 0;            // current shake magnitude (decays)
      this._shakeOffset = { x: 0, y: 0, z: 0 };

      const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 0.8);
      this.scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(15, 30, 10);
      this.scene.add(dir);
      const ambient = new THREE.AmbientLight(0x4466aa, 0.25);
      this.scene.add(ambient);

      const arenaGeo = new THREE.CircleGeometry(ARENA_RADIUS, 96);
      const arenaMat = new THREE.MeshStandardMaterial({
        map: makeArenaTexture(THREE),
        roughness: 0.85,
        metalness: 0.05,
      });
      const arena = new THREE.Mesh(arenaGeo, arenaMat);
      arena.rotation.x = -Math.PI / 2;
      this.scene.add(arena);

      const ringGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.25, 12, 96);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0xffd84d, emissive: 0xffaa22, emissiveIntensity: 0.6,
        roughness: 0.4, metalness: 0.2,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      this.scene.add(ring);

      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a3a66, roughness: 0.6 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const pg = new THREE.BoxGeometry(0.6, 4 + Math.random() * 1.5, 0.6);
        const pm = new THREE.Mesh(pg, pillarMat);
        pm.position.set(Math.cos(a) * (ARENA_RADIUS + 1.5), 2, Math.sin(a) * (ARENA_RADIUS + 1.5));
        this.scene.add(pm);
      }

      this.combatantViews = new Map();
      this.projectileViews = new Map();
      this.pickupViews = new Map();

      this.resize(window.innerWidth, window.innerHeight);
      window.addEventListener('resize', () => this.resize(window.innerWidth, window.innerHeight));
    }

    init(_match) {
      // Drop any views retained from a previous match so that "Play Again"
      // doesn't reuse stale meshes (bot IDs restart at 1 on each new Match
      // and would otherwise inherit the previous bot's color/material).
      for (const view of this.combatantViews.values()) {
        this.scene.remove(view.group);
        view.dispose();
      }
      this.combatantViews.clear();
      for (const view of this.projectileViews.values()) {
        this.scene.remove(view.group);
        view.dispose();
      }
      this.projectileViews.clear();
      for (const view of this.pickupViews.values()) {
        this.scene.remove(view.group);
        view.dispose();
      }
      this.pickupViews.clear();
      // Clear transient fx.
      for (const m of this._muzzleFlashes) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
      }
      this._muzzleFlashes.length = 0;
      for (const d of this._damageNumbers) {
        this.scene.remove(d.sprite);
        d.sprite.material.map?.dispose();
        d.sprite.material.dispose();
      }
      this._damageNumbers.length = 0;
      this._shakeMag = 0;
      this._shakeOffset.x = this._shakeOffset.y = this._shakeOffset.z = 0;
    }

    resize(w, h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    syncEntities(match) {
      const present = new Set();
      present.add(match.player.id);
      if (!this.combatantViews.has(match.player.id)) {
        const v = new CombatantView(this.THREE, match.player);
        this.combatantViews.set(match.player.id, v);
        this.scene.add(v.group);
      }
      for (const bot of match.bots.values()) {
        present.add(bot.id);
        if (!this.combatantViews.has(bot.id)) {
          const v = new CombatantView(this.THREE, bot);
          this.combatantViews.set(bot.id, v);
          this.scene.add(v.group);
        }
      }
      for (const [id, view] of this.combatantViews) {
        if (!present.has(id)) {
          this.scene.remove(view.group);
          view.dispose();
          this.combatantViews.delete(id);
        }
      }

      const pPresent = new Set();
      for (const proj of match.projectiles.values()) {
        pPresent.add(proj.id);
        if (!this.projectileViews.has(proj.id)) {
          const v = new ProjectileView(this.THREE, proj);
          this.projectileViews.set(proj.id, v);
          this.scene.add(v.group);
        }
      }
      for (const [id, view] of this.projectileViews) {
        if (!pPresent.has(id)) {
          this.scene.remove(view.group);
          view.dispose();
          this.projectileViews.delete(id);
        }
      }

      const pickupPresent = new Set();
      for (const pickup of match.pickups.values()) {
        if (!pickup.alive) continue;
        pickupPresent.add(pickup.id);
        if (!this.pickupViews.has(pickup.id)) {
          const v = new PickupView(this.THREE, pickup);
          this.pickupViews.set(pickup.id, v);
          this.scene.add(v.group);
        }
      }
      for (const [id, view] of this.pickupViews) {
        if (!pickupPresent.has(id)) {
          this.scene.remove(view.group);
          view.dispose();
          this.pickupViews.delete(id);
        }
      }
    }

    handleEvents(events, match) {
      const THREE = this.THREE;
      for (const ev of events) {
        if (ev.type === 'fire') {
          this._spawnMuzzleFlash(ev.position, ev.direction, ev.ownerTeam);
        } else if (ev.type === 'hit') {
          // Floating damage number above the victim.
          const color = ev.shooterIsPlayer ? '#ffd84d' : '#ff7b8b';
          this._spawnDamageNumber(
            ev.position,
            ev.killed ? `${ev.damage}!` : String(ev.damage),
            color,
          );
          // Shake the camera when the player takes damage.
          if (ev.victimIsPlayer) {
            this._shakeMag = Math.max(this._shakeMag, 0.45);
          }
        }
      }
      void THREE; // satisfy lint without unused-var noise
      void match;
    }

    _spawnMuzzleFlash(position, direction, ownerTeam) {
      const THREE = this.THREE;
      const color = (ownerTeam === E.constants.TEAM_PLAYER) ? 0xffe085 : 0xff8866;
      const geo = new THREE.SphereGeometry(0.35, 12, 8);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(position.x, position.y, position.z);
      this.scene.add(mesh);
      this._muzzleFlashes.push({ mesh, t: 0, life: 0.09 });
      // Cap simultaneous flashes; oldest gets removed early.
      if (this._muzzleFlashes.length > 24) {
        const oldest = this._muzzleFlashes.shift();
        this.scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        oldest.mesh.material.dispose();
      }
      void direction;
    }

    _spawnDamageNumber(position, text, color) {
      const THREE = this.THREE;
      const tex = makeDamageNumberTexture(THREE, text, color);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1.4, 0.7, 1);
      sprite.position.set(
        position.x + (Math.random() - 0.5) * 0.4,
        position.y,
        position.z + (Math.random() - 0.5) * 0.4,
      );
      this.scene.add(sprite);
      this._damageNumbers.push({ sprite, t: 0, life: 0.85, vy: 1.6 });
      if (this._damageNumbers.length > 32) {
        const oldest = this._damageNumbers.shift();
        this.scene.remove(oldest.sprite);
        oldest.sprite.material.map?.dispose();
        oldest.sprite.material.dispose();
      }
    }

    _tickFx(dt) {
      // Muzzle flashes fade out and shrink.
      for (let i = this._muzzleFlashes.length - 1; i >= 0; i--) {
        const m = this._muzzleFlashes[i];
        m.t += dt;
        const k = m.t / m.life;
        if (k >= 1) {
          this.scene.remove(m.mesh);
          m.mesh.geometry.dispose();
          m.mesh.material.dispose();
          this._muzzleFlashes.splice(i, 1);
        } else {
          m.mesh.material.opacity = (1 - k) * 0.9;
          const s = 1 + k * 1.4;
          m.mesh.scale.setScalar(s);
        }
      }
      // Damage numbers float up and fade.
      for (let i = this._damageNumbers.length - 1; i >= 0; i--) {
        const d = this._damageNumbers[i];
        d.t += dt;
        const k = d.t / d.life;
        if (k >= 1) {
          this.scene.remove(d.sprite);
          d.sprite.material.map?.dispose();
          d.sprite.material.dispose();
          this._damageNumbers.splice(i, 1);
        } else {
          d.sprite.position.y += d.vy * dt;
          d.sprite.material.opacity = 1 - k;
        }
      }
      // Screen shake decays exponentially toward zero.
      this._shakeMag *= Math.exp(-dt / 0.12);
      if (this._shakeMag < 0.005) {
        this._shakeMag = 0;
        this._shakeOffset.x = this._shakeOffset.y = this._shakeOffset.z = 0;
      } else {
        this._shakeOffset.x = (Math.random() - 0.5) * this._shakeMag;
        this._shakeOffset.y = (Math.random() - 0.5) * this._shakeMag * 0.6;
        this._shakeOffset.z = (Math.random() - 0.5) * this._shakeMag;
      }
    }

    render(match, dt) {
      for (const [id, view] of this.combatantViews) {
        const entity = (id === match.player.id) ? match.player : match.bots.get(id);
        if (!entity) continue;
        view.update(entity, this.camera);
      }
      for (const [id, view] of this.projectileViews) {
        const proj = match.projectiles.get(id);
        if (proj) view.update(proj);
      }
      for (const [id, view] of this.pickupViews) {
        const pickup = match.pickups.get(id);
        if (pickup) view.update(pickup, dt);
      }

      this._tickFx(dt);

      const p = match.player;
      const cy = Math.cos(p.cameraYaw), sy = Math.sin(p.cameraYaw);
      const cp = Math.cos(p.cameraPitch), sp = Math.sin(p.cameraPitch);
      const back = 5;
      const headY = p.position.y + 0.9;
      const camX = p.position.x + (sy * cp) * back + this._shakeOffset.x;
      const camY = headY - sp * back + 0.6 + this._shakeOffset.y;
      const camZ = p.position.z + (cy * cp) * back + this._shakeOffset.z;
      this.camera.position.set(camX, Math.max(0.6, camY), camZ);
      this.camera.lookAt(p.position.x - sy * cp, headY + sp * 1.5, p.position.z - cy * cp);

      this.renderer.render(this.scene, this.camera);
    }
  }

  // =============================================================================
  // UIAdapter
  // =============================================================================

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  class UIAdapter extends IUiPresenter {
    constructor() {
      super();
      this.timerEl = document.getElementById('timer');
      this.scoreEl = document.getElementById('score-value');
      this.hpEl = document.getElementById('hp-value');
      this.hpBar = document.getElementById('hp-bar-inner');
      this.scoreboardList = document.getElementById('scoreboard-list');
      this.matchOverPanel = document.getElementById('match-over');
      this.finalScoreEl = document.getElementById('final-score');
      this.finalKillsEl = document.getElementById('final-kills');
      this.finalHitsEl = document.getElementById('final-hits');
      this.finalDeathsEl = document.getElementById('final-deaths');
      this.playAgainBtn = document.getElementById('play-again');
      this.vignetteEl = document.getElementById('damage-vignette');
      this.hitMarkerEl = document.getElementById('hit-marker');
      this.killFeedEl = document.getElementById('kill-feed');
      this.countdownEl = document.getElementById('countdown');
      this.dashBarInner = document.getElementById('dash-bar-inner');
      this.dashBar = document.getElementById('dash-bar');
      this._lastHp = null;
      this._hitMarkerUntil = 0;
      this._goShownUntil = 0;
      this._killFeed = []; // [{html, expiresAt}]
      this._now = () => performance.now() / 1000;
    }

    update(match) {
      const t = Math.max(0, match.timeLeft);
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      this.timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;

      const p = match.player;
      this.scoreEl.textContent = String(p.score);
      this.hpEl.textContent = String(Math.max(0, Math.round(p.hp)));
      const pct = Math.max(0, Math.min(1, p.hp / p.maxHp));
      this.hpBar.style.width = `${pct * 100}%`;

      // Dash bar fills as cooldown drains.
      if (this.dashBarInner) {
        const dashReady = 1 - Math.max(0, Math.min(1, p.dashCooldown / DASH_COOLDOWN));
        this.dashBarInner.style.width = `${dashReady * 100}%`;
        if (this.dashBar) this.dashBar.classList.toggle('ready', dashReady >= 0.999);
      }

      // Damage vignette: spike to ~1 when hp drops, otherwise fade with hitFlash.
      const hpDropped = this._lastHp !== null && p.hp < this._lastHp && p.alive;
      const flash = p.hitFlash || 0;
      const target = hpDropped ? 1 : Math.min(1, flash * 4);
      if (this.vignetteEl) this.vignetteEl.style.opacity = String(target);
      this._lastHp = p.hp;

      // Countdown overlay.
      if (this.countdownEl) {
        const now = this._now();
        if (match.isPreMatch()) {
          const remaining = Math.ceil(match.preMatch);
          this.countdownEl.textContent = String(remaining);
          this.countdownEl.classList.remove('hidden');
          this.countdownEl.classList.remove('go');
        } else if (now < this._goShownUntil) {
          this.countdownEl.textContent = 'GO!';
          this.countdownEl.classList.add('go');
          this.countdownEl.classList.remove('hidden');
        } else {
          this.countdownEl.classList.add('hidden');
        }
      }

      // Hit marker fade-out.
      if (this.hitMarkerEl) {
        const now = this._now();
        const visible = now < this._hitMarkerUntil;
        this.hitMarkerEl.classList.toggle('visible', visible);
      }

      // Kill feed expiration.
      if (this.killFeedEl) {
        const now = this._now();
        const before = this._killFeed.length;
        this._killFeed = this._killFeed.filter(e => e.expiresAt > now);
        if (this._killFeed.length !== before) this._renderKillFeed();
      }

      const bots = [...match.bots.values()];
      bots.sort((a, b) => b.score - a.score);
      const top = bots.slice(0, 3);
      const rows = [];
      rows.push({ name: p.name, score: p.score, you: true, color: '#66ff99' });
      for (const b of top) {
        rows.push({
          name: b.name, score: b.score, you: false,
          color: '#' + b.color.toString(16).padStart(6, '0'),
        });
      }
      rows.sort((a, b) => b.score - a.score);
      this.scoreboardList.innerHTML = rows.map(r => (
        `<li class="${r.you ? 'you' : ''}">` +
          `<span><span class="swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</span>` +
          `<span>${r.score}</span>` +
        `</li>`
      )).join('');
    }

    showMatchOver(match) {
      const p = match.player;
      this.finalScoreEl.textContent = String(p.score);
      this.finalKillsEl.textContent = String(p.kills);
      this.finalHitsEl.textContent = String(p.hits);
      this.finalDeathsEl.textContent = String(p.deaths);
      this.matchOverPanel.classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
    hideMatchOver() {
      this.matchOverPanel.classList.add('hidden');
      this._killFeed = [];
      this._renderKillFeed();
      this._hitMarkerUntil = 0;
      this._goShownUntil = 0;
    }
    onPlayAgain(cb) { this.playAgainBtn.addEventListener('click', () => cb()); }

    handleEvents(events, _match) {
      const now = this._now();
      for (const ev of events) {
        if (ev.type === 'hit' && ev.shooterIsPlayer) {
          this._hitMarkerUntil = now + 0.18;
        } else if (ev.type === 'kill') {
          const killer = ev.killerIsPlayer ? 'You' : ev.killerName;
          const victim = ev.victimIsPlayer ? 'You' : ev.victimName;
          const klass = ev.killerIsPlayer
            ? 'kill-feed-self-kill'
            : (ev.victimIsPlayer ? 'kill-feed-self-death' : '');
          const html = `<li class="${klass}">`
            + `<span class="k">${escapeHtml(killer)}</span>`
            + `<span class="sep">▸</span>`
            + `<span class="v">${escapeHtml(victim)}</span>`
            + `</li>`;
          this._killFeed.unshift({ html, expiresAt: now + 4.5 });
          if (this._killFeed.length > 5) this._killFeed.length = 5;
          this._renderKillFeed();
        } else if (ev.type === 'go') {
          this._goShownUntil = now + 0.7;
        } else if (ev.type === 'pickup' && ev.consumerIsPlayer) {
          // Briefly show a positive marker via the kill feed for feedback.
          const html = `<li class="kill-feed-pickup">`
            + `<span class="k">+${ev.healed} HP</span>`
            + `</li>`;
          this._killFeed.unshift({ html, expiresAt: now + 2.5 });
          if (this._killFeed.length > 5) this._killFeed.length = 5;
          this._renderKillFeed();
        }
      }
    }

    _renderKillFeed() {
      if (!this.killFeedEl) return;
      this.killFeedEl.innerHTML = this._killFeed.map(e => e.html).join('');
    }
  }

  // =============================================================================
  // WebAudioAdapter — procedural SFX via Web Audio API (no asset files)
  // =============================================================================

  class WebAudioAdapter extends IAudioPresenter {
    constructor() {
      super();
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this._lastFireAt = 0;
      this._lastBotFireAt = 0;
    }

    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume?.();
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Quiet ambient drone for atmosphere.
      this._startAmbient();
    }

    _now() { return this.ctx ? this.ctx.currentTime : 0; }

    _startAmbient() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const drone = ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 70;
      const detune = ctx.createOscillator();
      detune.type = 'sine';
      detune.frequency.value = 71.5;
      const gain = ctx.createGain();
      gain.gain.value = 0.018;
      drone.connect(gain); detune.connect(gain); gain.connect(this.master);
      drone.start(); detune.start();
      this._ambient = { drone, detune, gain };
    }

    handleEvents(events, _match) {
      if (!this.ctx) return;
      const t = this._now();
      for (const ev of events) {
        if (ev.type === 'fire') {
          if (ev.ownerTeam === E.constants.TEAM_PLAYER) {
            if (t - this._lastFireAt > 0.05) {
              this._playShot({ baseFreq: 520, type: 'square', dur: 0.09, gain: 0.18 });
              this._lastFireAt = t;
            }
          } else {
            // Bots: lower-pitched, slightly quieter.
            if (t - this._lastBotFireAt > 0.04) {
              this._playShot({ baseFreq: 230, type: 'sawtooth', dur: 0.11, gain: 0.10 });
              this._lastBotFireAt = t;
            }
          }
        } else if (ev.type === 'hit') {
          if (ev.shooterIsPlayer) {
            // Hit-confirm: bright high ping.
            this._playPing(880, 0.1, 0.12);
          }
          if (ev.victimIsPlayer) {
            // Player got hit: low thud.
            this._playThud(180, 0.18, 0.25);
          }
        } else if (ev.type === 'kill') {
          if (ev.killerIsPlayer) {
            this._playChord([523, 659, 784], 0.32, 0.18);
          }
          if (ev.victimIsPlayer) {
            this._playThud(90, 0.45, 0.30);
          }
        } else if (ev.type === 'pickup' && ev.consumerIsPlayer) {
          this._playChord([660, 880, 1100], 0.22, 0.16);
        } else if (ev.type === 'countdown') {
          this._playPing(880, 0.12, 0.15);
        } else if (ev.type === 'go') {
          this._playChord([880, 1100, 1320], 0.25, 0.20);
        } else if (ev.type === 'dash') {
          this._playSwoosh(0.18, 0.15);
        }
      }
    }

    _playShot({ baseFreq, type, dur, gain }) {
      const ctx = this.ctx; const t = this._now();
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 2500;
      osc.connect(filt); filt.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    _playPing(freq, dur, gain) {
      const ctx = this.ctx; const t = this._now();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    _playThud(freq, dur, gain) {
      const ctx = this.ctx; const t = this._now();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // Add a touch of noise via a short white-noise burst.
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.value = gain * 0.5;
      noise.connect(ng); ng.connect(this.master);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
      noise.start(t); noise.stop(t + dur + 0.02);
    }

    _playChord(freqs, dur, gain) {
      const ctx = this.ctx; const t = this._now();
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain / freqs.length, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(this.master);
        osc.start(t); osc.stop(t + dur + 0.02);
      }
    }

    _playSwoosh(dur, gain) {
      const ctx = this.ctx; const t = this._now();
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const k = i / data.length;
        data[i] = (Math.random() * 2 - 1) * (1 - k);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(800, t);
      filt.frequency.exponentialRampToValueAtTime(2400, t + dur);
      filt.Q.value = 6;
      const g = ctx.createGain();
      g.gain.value = gain;
      noise.connect(filt); filt.connect(g); g.connect(this.master);
      noise.start(t); noise.stop(t + dur + 0.02);
    }

    update(_match, _dt) { /* no-op: ambient runs on its own */ }
  }

  CubeClash.adapters = {
    InMemoryMatchRepository, InputAdapter,
    ThreeRendererAdapter, UIAdapter, WebAudioAdapter,
  };
})(window.CubeClash = window.CubeClash || {});
