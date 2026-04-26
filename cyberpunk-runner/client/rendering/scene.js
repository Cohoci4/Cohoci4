import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { COLORS, LANE_POSITIONS } from '../../shared/constants.js';

// Chromatic Aberration shader
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.003 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 offset = amount * (vUv - 0.5);
      vec4 cr = texture2D(tDiffuse, vUv + offset);
      vec4 cg = texture2D(tDiffuse, vUv);
      vec4 cb = texture2D(tDiffuse, vUv - offset);
      gl_FragColor = vec4(cr.r, cg.g, cb.b, cg.a);
    }
  `,
};

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 1.2 },
    offset: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vig = clamp(1.0 - dot(uv, uv), 0.0, 1.0);
      texel.rgb *= mix(1.0 - darkness, 1.0, vig);
      gl_FragColor = texel;
    }
  `,
};

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.bloomPass = null;
    this.chromaPass = null;
    this.vignettePass = null;
    this.overdriveActive = false;
    this.ghostMeshes = new Map();
    this.envObjects = [];
    this.rainParticles = null;
    this.fogParticles = null;
    this.droneCamera = false;
    this.droneCamTarget = null;
  }

  async init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.DARK_BLUE);
    this.scene.fog = new THREE.FogExp2(COLORS.DARK_BLUE, 0.012);

    // Camera (third person)
    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 5, 8);
    this.camera.lookAt(0, 1, -10);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;

    // Lights
    const ambient = new THREE.AmbientLight(0x222244, 0.5);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x4444ff, 0.3);
    dirLight.position.set(5, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    this.scene.add(dirLight);

    // Neon point lights
    const neonColors = [COLORS.NEON_CYAN, COLORS.NEON_MAGENTA, COLORS.NEON_PURPLE];
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(neonColors[i % 3], 2, 30);
      light.position.set(
        (i % 2 === 0 ? -1 : 1) * 6,
        4,
        -i * 15
      );
      this.scene.add(light);
      this.envObjects.push({ type: 'light', obj: light, baseZ: -i * 15 });
    }

    // Post-processing
    this._setupPostProcessing();

    // Rain
    this._createRain();

    // Sky/atmosphere
    this._createSkybox();

    // Resize handler
    window.addEventListener('resize', () => this._onResize());
  }

  _setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8,   // strength
      0.4,   // radius
      0.85   // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.chromaPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaPass.uniforms.amount.value = 0.002;
    this.composer.addPass(this.chromaPass);

    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.darkness.value = 1.0;
    this.vignettePass.uniforms.offset.value = 1.0;
    this.composer.addPass(this.vignettePass);
  }

  _createRain() {
    const count = 3000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80 - 20;
      velocities[i] = 15 + Math.random() * 10;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x8888cc,
      size: 0.05,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.rainParticles = new THREE.Points(geo, mat);
    this.rainParticles.userData.velocities = velocities;
    this.scene.add(this.rainParticles);
  }

  _createSkybox() {
    // Gradient sky dome
    const skyGeo = new THREE.SphereGeometry(200, 16, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0a0a2e) },
        bottomColor: { value: new THREE.Color(0x1a0033) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(h, 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  resetCamera() {
    this.droneCamera = false;
    this.camera.position.set(0, 5, 8);
    this.camera.lookAt(0, 1, -10);
  }

  enableDroneCamera() {
    this.droneCamera = true;
    this.camera.position.set(0, 10, 5);
  }

  updateDroneCamera(dt, ghosts) {
    // Slowly orbit around the action
    const t = performance.now() * 0.0001;
    this.camera.position.x = Math.sin(t) * 15;
    this.camera.position.z = Math.cos(t) * 15;
    this.camera.position.y = 8 + Math.sin(t * 2) * 2;
    this.camera.lookAt(0, 1, -10);
  }

  addToScene(obj) {
    this.scene.add(obj);
  }

  removeFromScene(obj) {
    this.scene.remove(obj);
    // Dispose geometry/materials
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  setOverdriveEffect(active) {
    this.overdriveActive = active;
  }

  updateEnvironment(distance, speed, dt) {
    // Rain animation
    if (this.rainParticles) {
      const positions = this.rainParticles.geometry.attributes.position.array;
      const velocities = this.rainParticles.userData.velocities;
      for (let i = 0; i < velocities.length; i++) {
        positions[i * 3 + 1] -= velocities[i] * dt;
        if (positions[i * 3 + 1] < -1) {
          positions[i * 3 + 1] = 25 + Math.random() * 5;
          positions[i * 3] = (Math.random() - 0.5) * 60;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 80 - 20;
        }
      }
      this.rainParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Overdrive effects
    if (this.overdriveActive) {
      this.chromaPass.uniforms.amount.value = 0.008 + Math.sin(performance.now() * 0.01) * 0.003;
      this.bloomPass.strength = 1.5;
      this.camera.fov = 65 + Math.sin(performance.now() * 0.005) * 3;
      this.camera.updateProjectionMatrix();
    } else {
      this.chromaPass.uniforms.amount.value += (0.002 - this.chromaPass.uniforms.amount.value) * dt * 5;
      this.bloomPass.strength += (0.8 - this.bloomPass.strength) * dt * 5;
      if (this.camera.fov !== 65) {
        this.camera.fov += (65 - this.camera.fov) * dt * 5;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  updateGhosts(ghosts, playerDistance, dt) {
    // Remove ghosts that no longer exist
    for (const [id, mesh] of this.ghostMeshes) {
      if (!ghosts.has(id)) {
        this.removeFromScene(mesh);
        this.ghostMeshes.delete(id);
      }
    }

    // Update/create ghost meshes
    for (const [id, ghost] of ghosts) {
      if (!ghost.alive) {
        if (this.ghostMeshes.has(id)) {
          this.removeFromScene(this.ghostMeshes.get(id));
          this.ghostMeshes.delete(id);
        }
        continue;
      }

      let mesh = this.ghostMeshes.get(id);
      if (!mesh) {
        mesh = this._createGhostMesh(ghost);
        this.ghostMeshes.set(id, mesh);
        this.scene.add(mesh);
      }

      // Position ghost
      const x = LANE_POSITIONS[ghost.lane] || 0;
      const relZ = -(ghost.distance - playerDistance);
      mesh.position.set(x, ghost.y || 0, relZ);

      // Update ghost label
      if (mesh.userData.label) {
        mesh.userData.label.position.copy(mesh.position);
        mesh.userData.label.position.y += 2.5;
      }
    }
  }

  _createGhostMesh(ghost) {
    const group = new THREE.Group();

    // Ghost body (semi-transparent)
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
    const bodyMat = new THREE.MeshBasicMaterial({
      color: COLORS.NEON_CYAN,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);

    // Nickname sprite
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ghost.nickname || 'Runner', 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.8,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.y = 2.5;
    group.add(sprite);
    group.userData.label = sprite;

    return group;
  }

  clearGhosts() {
    for (const [, mesh] of this.ghostMeshes) {
      this.removeFromScene(mesh);
    }
    this.ghostMeshes.clear();
  }

  playDeathEffect() {
    // Flash screen red briefly via vignette
    this.vignettePass.uniforms.darkness.value = 3.0;
    this.chromaPass.uniforms.amount.value = 0.02;
    setTimeout(() => {
      this.vignettePass.uniforms.darkness.value = 1.0;
      this.chromaPass.uniforms.amount.value = 0.002;
    }, 300);
  }

  render(dt) {
    this.composer.render(dt);
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
