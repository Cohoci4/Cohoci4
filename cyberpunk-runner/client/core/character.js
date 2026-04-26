import * as THREE from 'three';
import {
  LANE_POSITIONS,
  LANE_COUNT,
  JUMP_FORCE,
  GRAVITY,
  SLIDE_DURATION,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PLAYER_DEPTH,
  PLAYER_SLIDE_HEIGHT,
  COLORS,
} from '../../shared/constants.js';

export class Character {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.lane = 1;
    this.targetLane = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.isJumping = false;
    this.isSliding = false;
    this.slideTimer = 0;
    this.laneTransition = 0;
    this.mesh = null;
    this.neonLines = [];
    this.trailParticles = null;
    this.canDoubleJump = false;
    this.hasDoubleJumped = false;
  }

  init() {
    this._createModel();
    this._createTrail();
  }

  _createModel() {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT * 0.6, PLAYER_DEPTH);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.4,
      metalness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = PLAYER_HEIGHT * 0.5;
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a4e,
      roughness: 0.3,
      metalness: 0.7,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = PLAYER_HEIGHT * 0.9;
    head.castShadow = true;
    group.add(head);

    // Legs
    for (let i = -1; i <= 1; i += 2) {
      const legGeo = new THREE.BoxGeometry(0.18, PLAYER_HEIGHT * 0.4, PLAYER_DEPTH * 0.8);
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(i * 0.15, PLAYER_HEIGHT * 0.15, 0);
      leg.castShadow = true;
      group.add(leg);
    }

    // Neon accents
    const neonMat = new THREE.MeshBasicMaterial({
      color: COLORS.NEON_CYAN,
      transparent: true,
      opacity: 0.9,
    });

    // Chest neon line
    const neonGeo1 = new THREE.BoxGeometry(PLAYER_WIDTH * 0.8, 0.03, PLAYER_DEPTH + 0.02);
    const neon1 = new THREE.Mesh(neonGeo1, neonMat);
    neon1.position.y = PLAYER_HEIGHT * 0.55;
    group.add(neon1);
    this.neonLines.push(neon1);

    // Arm neon lines
    for (let i = -1; i <= 1; i += 2) {
      const neonGeo2 = new THREE.BoxGeometry(0.03, PLAYER_HEIGHT * 0.5, 0.03);
      const neon2 = new THREE.Mesh(neonGeo2, neonMat.clone());
      neon2.position.set(i * (PLAYER_WIDTH * 0.5 + 0.02), PLAYER_HEIGHT * 0.5, 0);
      group.add(neon2);
      this.neonLines.push(neon2);
    }

    // Visor glow
    const visorGeo = new THREE.BoxGeometry(0.25, 0.05, 0.2);
    const visorMat = new THREE.MeshBasicMaterial({
      color: COLORS.NEON_MAGENTA,
      transparent: true,
      opacity: 0.8,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, PLAYER_HEIGHT * 0.92, 0.1);
    group.add(visor);
    this.neonLines.push(visor);

    group.position.set(LANE_POSITIONS[1], 0, 0);
    this.mesh = group;
    this.sceneManager.addToScene(group);
  }

  _createTrail() {
    const count = 30;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0.1;
      positions[i * 3 + 2] = i * -0.3;
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 0.94;
      colors[i * 3 + 2] = 1;
      sizes[i] = Math.max(0.05, 0.2 - i * 0.006);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.trailParticles = new THREE.Points(geo, mat);
    this.sceneManager.addToScene(this.trailParticles);
  }

  reset() {
    this.lane = 1;
    this.targetLane = 1;
    this.x = LANE_POSITIONS[1];
    this.y = 0;
    this.vy = 0;
    this.isJumping = false;
    this.isSliding = false;
    this.slideTimer = 0;
    this.hasDoubleJumped = false;
    if (this.mesh) {
      this.mesh.position.set(LANE_POSITIONS[1], 0, 0);
      this.mesh.scale.set(1, 1, 1);
      this.mesh.rotation.set(0, 0, 0);
    }
  }

  moveLeft() {
    if (this.targetLane > 0) {
      this.targetLane--;
      this.laneTransition = 0;
    }
  }

  moveRight() {
    if (this.targetLane < LANE_COUNT - 1) {
      this.targetLane++;
      this.laneTransition = 0;
    }
  }

  jump() {
    if (!this.isJumping) {
      this.isJumping = true;
      this.vy = JUMP_FORCE;
      this.isSliding = false;
      this.hasDoubleJumped = false;
    } else if (this.canDoubleJump && !this.hasDoubleJumped) {
      this.vy = JUMP_FORCE * 0.8;
      this.hasDoubleJumped = true;
    }
  }

  slide() {
    if (!this.isJumping) {
      this.isSliding = true;
      this.slideTimer = SLIDE_DURATION;
    }
  }

  update(dt, speed) {
    // Gravity
    if (this.isJumping) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.isJumping = false;
        this.hasDoubleJumped = false;
      }
    }

    // Slide
    if (this.isSliding) {
      this.slideTimer -= dt * 1000;
      if (this.slideTimer <= 0) {
        this.isSliding = false;
      }
    }

    // Lane transition (smooth)
    const targetX = LANE_POSITIONS[this.targetLane];
    this.x += (targetX - this.x) * Math.min(1, dt * 12);
    this.lane = this.targetLane;

    // Update mesh
    if (this.mesh) {
      this.mesh.position.x = this.x;
      this.mesh.position.y = this.y;

      // Slide animation: squash
      if (this.isSliding) {
        const t = 1 - this.slideTimer / SLIDE_DURATION;
        const squash = t < 0.1 ? t / 0.1 : (t > 0.9 ? (1 - t) / 0.1 : 1);
        this.mesh.scale.y = 1 - squash * 0.6;
        this.mesh.scale.x = 1 + squash * 0.2;
      } else {
        this.mesh.scale.y += (1 - this.mesh.scale.y) * dt * 10;
        this.mesh.scale.x += (1 - this.mesh.scale.x) * dt * 10;
      }

      // Run bob
      if (!this.isJumping && !this.isSliding) {
        const bobFreq = speed * 0.5;
        const bob = Math.sin(performance.now() * 0.01 * bobFreq) * 0.05;
        this.mesh.position.y += bob;
        this.mesh.rotation.z = Math.sin(performance.now() * 0.005 * bobFreq) * 0.03;
      }

      // Neon pulse
      const pulse = 0.7 + Math.sin(performance.now() * 0.005) * 0.3;
      for (const neon of this.neonLines) {
        if (neon.material.opacity !== undefined) {
          neon.material.opacity = pulse;
        }
      }
    }

    // Trail
    if (this.trailParticles) {
      const positions = this.trailParticles.geometry.attributes.position.array;
      for (let i = positions.length / 3 - 1; i > 0; i--) {
        positions[i * 3] = positions[(i - 1) * 3];
        positions[i * 3 + 1] = positions[(i - 1) * 3 + 1];
        positions[i * 3 + 2] = positions[(i - 1) * 3 + 2];
      }
      positions[0] = this.x;
      positions[1] = 0.1 + this.y;
      positions[2] = 0;
      this.trailParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  getBoundingBox(distance) {
    const h = this.isSliding ? PLAYER_SLIDE_HEIGHT : PLAYER_HEIGHT;
    return {
      minX: this.x - PLAYER_WIDTH / 2,
      maxX: this.x + PLAYER_WIDTH / 2,
      minY: this.y,
      maxY: this.y + h,
      minZ: -PLAYER_DEPTH / 2,
      maxZ: PLAYER_DEPTH / 2,
    };
  }
}
