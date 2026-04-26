import * as THREE from 'three';
import { createRNG, segmentSeed } from '../../shared/seed.js';
import { OBSTACLE_DEFS, COLLECTIBLE_WEIGHTS, DIFFICULTY } from '../../shared/config.js';
import {
  SEGMENT_LENGTH,
  SEGMENTS_AHEAD,
  SEGMENTS_BEHIND,
  LANE_POSITIONS,
  LANE_WIDTH,
  COLORS,
  OBSTACLE_TYPES,
  COLLECTIBLE_TYPES,
} from '../../shared/constants.js';

export class LevelGenerator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.seed = 0;
    this.segments = new Map();
    this.segmentPool = [];
    this.obstaclePool = [];
    this.collectiblePool = [];
    this.activeObstacles = [];
    this.activeCollectibles = [];
    this.lastGenerated = -1;
  }

  setSeed(seed) {
    this.seed = seed;
  }

  reset() {
    this.clearAll();
    this.lastGenerated = -1;
  }

  clearAll() {
    for (const [, seg] of this.segments) {
      this._recycleSegment(seg);
    }
    this.segments.clear();
    this.activeObstacles = [];
    this.activeCollectibles = [];
  }

  generateInitialSegments() {
    for (let i = -1; i <= SEGMENTS_AHEAD; i++) {
      this._generateSegment(i);
    }
    this.lastGenerated = SEGMENTS_AHEAD;
  }

  update(currentSegment, distance) {
    // Generate ahead
    const targetAhead = currentSegment + SEGMENTS_AHEAD;
    while (this.lastGenerated < targetAhead) {
      this.lastGenerated++;
      this._generateSegment(this.lastGenerated);
    }

    // Remove behind
    const removeBefore = currentSegment - SEGMENTS_BEHIND;
    for (const [idx, seg] of this.segments) {
      if (idx < removeBefore) {
        this._recycleSegment(seg);
        this.segments.delete(idx);
      }
    }

    // Update obstacle/collectible positions relative to player
    this._updateActiveItems(distance);
  }

  _generateSegment(index) {
    if (this.segments.has(index)) return;

    const rng = createRNG(segmentSeed(this.seed, index));
    const segZ = -index * SEGMENT_LENGTH;
    const totalDistance = index * SEGMENT_LENGTH;

    // Create road segment
    const segment = this._createRoadSegment(index, segZ, rng);

    // Difficulty scaling
    const difficultyFactor = Math.min(1, totalDistance / DIFFICULTY.rampDistance);
    const obsCount = Math.floor(
      DIFFICULTY.baseObstaclesPerSegment +
        difficultyFactor * (DIFFICULTY.maxObstaclesPerSegment - DIFFICULTY.baseObstaclesPerSegment)
    );

    // Generate obstacles
    const obstacles = [];
    const obstacleTypes = Object.keys(OBSTACLE_DEFS);
    for (let i = 0; i < obsCount; i++) {
      const typeIdx = Math.floor(rng() * obstacleTypes.length);
      const type = obstacleTypes[typeIdx];
      const def = OBSTACLE_DEFS[type];

      if (totalDistance < (def.minDistance || 0)) continue;

      const lane = Math.floor(rng() * 3);
      const zOffset = (rng() * 0.6 + 0.2) * SEGMENT_LENGTH;

      const obs = this._createObstacle(type, def, lane, segZ - zOffset, rng);
      obs.segmentIndex = index;
      obs.distance = totalDistance + zOffset;
      obstacles.push(obs);
    }

    // Generate collectibles
    const colCount =
      DIFFICULTY.collectiblesPerSegment.min +
      Math.floor(rng() * (DIFFICULTY.collectiblesPerSegment.max - DIFFICULTY.collectiblesPerSegment.min + 1));

    const collectibles = [];
    for (let i = 0; i < colCount; i++) {
      const r = rng();
      let type = COLLECTIBLE_TYPES.CREDIT;
      let cum = 0;
      for (const [t, w] of Object.entries(COLLECTIBLE_WEIGHTS)) {
        cum += w;
        if (r < cum) {
          type = t;
          break;
        }
      }

      const lane = Math.floor(rng() * 3);
      const zOffset = (rng() * 0.8 + 0.1) * SEGMENT_LENGTH;
      const yOffset = rng() > 0.7 ? 1.5 : 0.8;

      const col = this._createCollectible(type, lane, segZ - zOffset, yOffset);
      col.segmentIndex = index;
      col.distance = totalDistance + zOffset;
      col.collected = false;
      collectibles.push(col);
    }

    this.segments.set(index, {
      index,
      mesh: segment,
      obstacles,
      collectibles,
      z: segZ,
    });

    this.activeObstacles.push(...obstacles);
    this.activeCollectibles.push(...collectibles);
  }

  _createRoadSegment(index, z, rng) {
    const group = new THREE.Group();

    // Road surface
    const roadGeo = new THREE.PlaneGeometry(LANE_WIDTH * 3.5, SEGMENT_LENGTH);
    const roadMat = new THREE.MeshStandardMaterial({
      color: COLORS.ROAD_SURFACE,
      roughness: 0.8,
      metalness: 0.2,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.01, z - SEGMENT_LENGTH / 2);
    road.receiveShadow = true;
    group.add(road);

    // Lane dividers (neon lines)
    for (let i = 0; i < 2; i++) {
      const lineGeo = new THREE.PlaneGeometry(0.05, SEGMENT_LENGTH);
      const lineMat = new THREE.MeshBasicMaterial({
        color: COLORS.NEON_CYAN,
        transparent: true,
        opacity: 0.4,
      });
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(LANE_POSITIONS[i] + LANE_WIDTH / 2, 0.01, z - SEGMENT_LENGTH / 2);
      group.add(line);
    }

    // Buildings on sides
    this._addBuildings(group, z, rng);

    // Occasional decorations
    if (rng() > 0.5) {
      this._addNeonSign(group, z, rng);
    }
    if (rng() > 0.6) {
      this._addSteamVent(group, z, rng);
    }

    this.sceneManager.addToScene(group);
    return group;
  }

  _addBuildings(group, z, rng) {
    for (let side = -1; side <= 1; side += 2) {
      const count = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const height = 8 + rng() * 40;
        const width = 3 + rng() * 6;
        const depth = 3 + rng() * 8;

        const geo = new THREE.BoxGeometry(width, height, depth);
        const mat = new THREE.MeshStandardMaterial({
          color: rng() > 0.5 ? COLORS.BUILDING_DARK : COLORS.BUILDING_ACCENT,
          roughness: 0.9,
          metalness: 0.1,
        });
        const building = new THREE.Mesh(geo, mat);
        building.position.set(
          side * (8 + rng() * 10),
          height / 2,
          z - rng() * SEGMENT_LENGTH
        );
        building.castShadow = true;
        group.add(building);

        // Window lights
        if (rng() > 0.3) {
          const windowRows = Math.floor(height / 2);
          const windowCols = Math.floor(width / 1.5);
          for (let wy = 0; wy < Math.min(windowRows, 8); wy++) {
            for (let wx = 0; wx < Math.min(windowCols, 4); wx++) {
              if (rng() > 0.5) {
                const winGeo = new THREE.PlaneGeometry(0.5, 0.8);
                const winColor = rng() > 0.7 ? COLORS.NEON_CYAN : rng() > 0.5 ? COLORS.NEON_MAGENTA : 0xffaa44;
                const winMat = new THREE.MeshBasicMaterial({
                  color: winColor,
                  transparent: true,
                  opacity: 0.3 + rng() * 0.5,
                });
                const win = new THREE.Mesh(winGeo, winMat);
                win.position.set(
                  building.position.x + (side > 0 ? -width / 2 - 0.01 : width / 2 + 0.01),
                  2 + wy * 2,
                  building.position.z + (wx - windowCols / 2) * 1.5
                );
                win.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
                group.add(win);
              }
            }
          }
        }

        // Neon strips on buildings
        if (rng() > 0.6) {
          const stripGeo = new THREE.BoxGeometry(0.05, height * 0.8, 0.05);
          const stripColor = [COLORS.NEON_CYAN, COLORS.NEON_MAGENTA, COLORS.NEON_PURPLE][Math.floor(rng() * 3)];
          const stripMat = new THREE.MeshBasicMaterial({
            color: stripColor,
            transparent: true,
            opacity: 0.7,
          });
          const strip = new THREE.Mesh(stripGeo, stripMat);
          strip.position.set(
            building.position.x + (side > 0 ? -width / 2 : width / 2),
            height * 0.4,
            building.position.z
          );
          group.add(strip);
        }
      }
    }
  }

  _addNeonSign(group, z, rng) {
    const side = rng() > 0.5 ? 1 : -1;
    const signGeo = new THREE.PlaneGeometry(3, 1.5);
    const signColor = [COLORS.NEON_CYAN, COLORS.NEON_MAGENTA, COLORS.NEON_YELLOW][Math.floor(rng() * 3)];
    const signMat = new THREE.MeshBasicMaterial({
      color: signColor,
      transparent: true,
      opacity: 0.6 + rng() * 0.3,
      side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(side * 7, 5 + rng() * 4, z - rng() * SEGMENT_LENGTH);
    sign.rotation.y = side > 0 ? -Math.PI / 4 : Math.PI / 4;
    group.add(sign);
  }

  _addSteamVent(group, z, rng) {
    const side = rng() > 0.5 ? 1 : -1;
    const steamGeo = new THREE.ConeGeometry(0.3, 2, 6);
    const steamMat = new THREE.MeshBasicMaterial({
      color: 0xaaaacc,
      transparent: true,
      opacity: 0.15,
    });
    const steam = new THREE.Mesh(steamGeo, steamMat);
    steam.position.set(side * (5 + rng() * 3), 1, z - rng() * SEGMENT_LENGTH);
    group.add(steam);
  }

  _createObstacle(type, def, lane, z, rng) {
    const group = new THREE.Group();
    const x = LANE_POSITIONS[lane];
    const yOffset = def.yOffset || 0;

    let geo, mat, mesh;

    switch (type) {
      case OBSTACLE_TYPES.LASER_LOW:
      case OBSTACLE_TYPES.LASER_HIGH: {
        geo = new THREE.BoxGeometry(def.width, 0.08, 0.08);
        mat = new THREE.MeshBasicMaterial({
          color: def.color,
          transparent: true,
          opacity: 0.9,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = yOffset + def.height / 2;

        // Emitters
        for (let side = -1; side <= 1; side += 2) {
          const emGeo = new THREE.BoxGeometry(0.15, 0.3, 0.15);
          const emMat = new THREE.MeshStandardMaterial({ color: 0x333344 });
          const em = new THREE.Mesh(emGeo, emMat);
          em.position.set(side * def.width / 2, yOffset + def.height / 2, 0);
          group.add(em);
        }

        // Glow plane
        const glowGeo = new THREE.PlaneGeometry(def.width, 0.5);
        const glowMat = new THREE.MeshBasicMaterial({
          color: def.color,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.y = yOffset + def.height / 2;
        group.add(glow);
        break;
      }
      case OBSTACLE_TYPES.BLADE: {
        geo = new THREE.CylinderGeometry(0.6, 0.6, 0.05, 8);
        mat = new THREE.MeshStandardMaterial({
          color: def.color,
          metalness: 0.9,
          roughness: 0.1,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 1;
        mesh.rotation.x = Math.PI / 2;
        mesh.userData.rotates = true;
        break;
      }
      case OBSTACLE_TYPES.DRONE:
      case OBSTACLE_TYPES.VIRUS_DRONE: {
        geo = new THREE.OctahedronGeometry(0.4);
        mat = new THREE.MeshStandardMaterial({
          color: def.color,
          emissive: def.color,
          emissiveIntensity: 0.5,
          metalness: 0.8,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 1.5;
        mesh.userData.floats = true;
        break;
      }
      case OBSTACLE_TYPES.PANEL: {
        geo = new THREE.BoxGeometry(def.width, def.height, 0.3);
        mat = new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: 0.7,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = def.height / 2;
        break;
      }
      case OBSTACLE_TYPES.PLATFORM_COLLAPSE: {
        geo = new THREE.BoxGeometry(LANE_WIDTH, 0.2, 3);
        mat = new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: 0.6,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -0.1;
        mesh.userData.collapses = true;
        break;
      }
      default: {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.5;
      }
    }

    if (mesh) group.add(mesh);
    group.position.set(x, 0, z);
    this.sceneManager.addToScene(group);

    // Compute bounding box
    const hw = (def.width || 1) / 2;
    const hh = (def.height || 1);
    const box = {
      minX: x - hw,
      maxX: x + hw,
      minY: yOffset || 0,
      maxY: (yOffset || 0) + hh,
      minZ: z - 0.5,
      maxZ: z + 0.5,
    };

    return { type, def, lane, group, mesh, box, z, worldZ: z };
  }

  _createCollectible(type, lane, z, yOffset) {
    const x = LANE_POSITIONS[lane];
    let geo, mat;

    switch (type) {
      case COLLECTIBLE_TYPES.CREDIT:
        geo = new THREE.OctahedronGeometry(0.2);
        mat = new THREE.MeshBasicMaterial({
          color: COLORS.NEON_YELLOW,
          transparent: true,
          opacity: 0.9,
        });
        break;
      case COLLECTIBLE_TYPES.BATTERY:
        geo = new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6);
        mat = new THREE.MeshBasicMaterial({
          color: COLORS.NEON_CYAN,
          transparent: true,
          opacity: 0.9,
        });
        break;
      case COLLECTIBLE_TYPES.KEY_FRAGMENT:
        geo = new THREE.TorusGeometry(0.2, 0.06, 6, 6);
        mat = new THREE.MeshBasicMaterial({
          color: COLORS.NEON_MAGENTA,
          transparent: true,
          opacity: 0.9,
        });
        break;
      default:
        geo = new THREE.SphereGeometry(0.2);
        mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, yOffset, z);
    mesh.userData.collectible = true;
    mesh.userData.bobOffset = Math.random() * Math.PI * 2;
    this.sceneManager.addToScene(mesh);

    const box = {
      minX: x - 0.4,
      maxX: x + 0.4,
      minY: yOffset - 0.4,
      maxY: yOffset + 0.4,
      minZ: z - 0.4,
      maxZ: z + 0.4,
    };

    return { type, mesh, box, z, value: type === 'credit' ? 10 : 0 };
  }

  _recycleSegment(seg) {
    if (seg.mesh) {
      this.sceneManager.removeFromScene(seg.mesh);
    }
    for (const obs of seg.obstacles) {
      if (obs.group) this.sceneManager.removeFromScene(obs.group);
    }
    for (const col of seg.collectibles) {
      if (col.mesh) this.sceneManager.removeFromScene(col.mesh);
    }
  }

  _updateActiveItems(distance) {
    const playerZ = 0;
    const viewRange = SEGMENT_LENGTH * (SEGMENTS_AHEAD + 1);

    // Remove far obstacles/collectibles from active lists
    this.activeObstacles = this.activeObstacles.filter((obs) => {
      const relZ = obs.distance - distance;
      return relZ > -SEGMENT_LENGTH && relZ < viewRange;
    });

    this.activeCollectibles = this.activeCollectibles.filter((col) => {
      if (col.collected) return false;
      const relZ = col.distance - distance;
      return relZ > -SEGMENT_LENGTH && relZ < viewRange;
    });

    // Update obstacle positions relative to camera
    for (const obs of this.activeObstacles) {
      const relZ = -(obs.distance - distance);
      if (obs.group) {
        obs.group.position.z = relZ;
      }
      obs.box.minZ = relZ - 0.5;
      obs.box.maxZ = relZ + 0.5;

      // Animations
      if (obs.mesh) {
        if (obs.mesh.userData.rotates) {
          obs.mesh.rotation.z += 0.05;
        }
        if (obs.mesh.userData.floats) {
          obs.mesh.position.y = 1.5 + Math.sin(performance.now() * 0.003) * 0.3;
        }
      }
    }

    for (const col of this.activeCollectibles) {
      const relZ = -(col.distance - distance);
      if (col.mesh) {
        col.mesh.position.z = relZ;
        col.mesh.rotation.y += 0.03;
        col.mesh.position.y += Math.sin(performance.now() * 0.003 + (col.mesh.userData.bobOffset || 0)) * 0.002;
      }
      col.box.minZ = relZ - 0.4;
      col.box.maxZ = relZ + 0.4;
    }

    // Update segment positions
    for (const [idx, seg] of this.segments) {
      const relZ = -(idx * SEGMENT_LENGTH - distance);
      if (seg.mesh) {
        seg.mesh.position.z = relZ;
      }
    }
  }

  getActiveObstacles(distance) {
    return this.activeObstacles.filter((obs) => {
      const relDist = obs.distance - distance;
      return relDist > -2 && relDist < 5;
    });
  }

  getActiveCollectibles(distance) {
    return this.activeCollectibles.filter((col) => {
      if (col.collected) return false;
      const relDist = col.distance - distance;
      return relDist > -2 && relDist < 3;
    });
  }

  removeCollectible(col) {
    if (col.mesh) {
      this.sceneManager.removeFromScene(col.mesh);
    }
  }
}
