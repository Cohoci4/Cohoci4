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

  const { ARENA_RADIUS, PROJECTILE_RADIUS } = E.constants;
  const { IRenderer, IInputProvider, IUiPresenter, IMatchRepository } = I;

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

      this._onKeyDown = (e) => {
        this.keys.add(e.code);
        if (e.code === 'Space') {
          this.jumpQueued = true;
          e.preventDefault();
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
      };
      this._onKeyUp = (e) => { this.keys.delete(e.code); };
      this._onMouseDown = (e) => {
        if (e.button === 0) {
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

      return {
        move: { x: mx, z: mz },
        look: { yawDelta: lookYaw, pitchDelta: lookPitch },
        fire: this.fire && this._isLocked,
        jump,
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
    }

    render(match, _dt) {
      for (const [id, view] of this.combatantViews) {
        const entity = (id === match.player.id) ? match.player : match.bots.get(id);
        if (!entity) continue;
        view.update(entity, this.camera);
      }
      for (const [id, view] of this.projectileViews) {
        const proj = match.projectiles.get(id);
        if (proj) view.update(proj);
      }

      const p = match.player;
      const cy = Math.cos(p.cameraYaw), sy = Math.sin(p.cameraYaw);
      const cp = Math.cos(p.cameraPitch), sp = Math.sin(p.cameraPitch);
      const back = 5;
      const headY = p.position.y + 0.9;
      const camX = p.position.x + (sy * cp) * back;
      const camY = headY - sp * back + 0.6;
      const camZ = p.position.z + (cy * cp) * back;
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
    hideMatchOver() { this.matchOverPanel.classList.add('hidden'); }
    onPlayAgain(cb) { this.playAgainBtn.addEventListener('click', () => cb()); }
  }

  CubeClash.adapters = {
    InMemoryMatchRepository, InputAdapter,
    ThreeRendererAdapter, UIAdapter,
  };
})(window.CubeClash = window.CubeClash || {});
