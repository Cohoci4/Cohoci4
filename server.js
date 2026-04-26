const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 20;
const WORLD = { minX: -120, maxX: 120, minY: 14, maxY: 78, minZ: -120, maxZ: 120 };

// ===================== Domain (Entities) =====================
class Weapon {
  constructor(id, name, damage, cooldownMs, range, explosionRadius = 0, price = 0) {
    this.id = id;
    this.name = name;
    this.damage = damage;
    this.cooldownMs = cooldownMs;
    this.range = range;
    this.explosionRadius = explosionRadius;
    this.price = price;
  }
}

class Skin {
  constructor(id, name, colors, price = 0) {
    this.id = id;
    this.name = name;
    this.colors = colors;
    this.price = price;
  }
}

class ShopItem {
  constructor(id, type, targetId, name, price) {
    this.id = id;
    this.type = type;
    this.targetId = targetId;
    this.name = name;
    this.price = price;
  }
}

class Projectile {
  constructor(id, ownerId, weaponId, from, to, createdAt) {
    this.id = id;
    this.ownerId = ownerId;
    this.weaponId = weaponId;
    this.from = from;
    this.to = to;
    this.createdAt = createdAt;
  }
}

class Player {
  constructor(id, position) {
    this.id = id;
    this.name = `Ranger-${id.slice(0, 4)}`;
    this.position = position;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.aim = { x: 0, y: 0, z: -1 };
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.weaponId = "blaster";
    this.skinId = "neon";
    this.credits = 0;
    this.score = 0;
    this.lastShotAt = 0;
    this.respawnAt = 0;
  }
}

const WEAPONS = {
  blaster: new Weapon("blaster", "Blaster", 15, 500, 110, 0, 0),
  plasma: new Weapon("plasma", "Plasma", 30, 700, 125, 0, 100),
  rocket: new Weapon("rocket", "Rocket launcher", 50, 1200, 105, 9, 200),
};

const SKINS = {
  neon: new Skin("neon", "Neon", { hull: "#00f5ff", wing: "#ff00ff", glow: "#a6ff00" }, 0),
  chrome: new Skin("chrome", "Chrome", { hull: "#d9e7ff", wing: "#8aa0b8", glow: "#00f5ff" }, 75),
  shadow: new Skin("shadow", "Shadow", { hull: "#151522", wing: "#5d2cff", glow: "#ff2bd6" }, 75),
};

const SHOP = [
  new ShopItem("weapon_plasma", "weapon", "plasma", "Plasma rifle", 100),
  new ShopItem("weapon_rocket", "weapon", "rocket", "Rocket launcher", 200),
  new ShopItem("skin_neon", "skin", "neon", "Neon skin", 0),
  new ShopItem("skin_chrome", "skin", "chrome", "Chrome skin", 75),
  new ShopItem("skin_shadow", "skin", "shadow", "Shadow skin", 75),
];

// ===================== Use Cases (Application) =====================
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function length3(v) {
  return Math.hypot(v.x || 0, v.y || 0, v.z || 0);
}

function normalize3(v) {
  const len = length3(v);
  if (!len) return { x: 0, y: 0, z: 0 };
  return { x: (v.x || 0) / len, y: (v.y || 0) / len, z: (v.z || 0) / len };
}

function randomSpawn() {
  return { x: Math.random() * 180 - 90, y: 24 + Math.random() * 28, z: Math.random() * 180 - 90 };
}

function movePlayer(player, input, dt) {
  if (!player.alive) return player;
  const desired = normalize3(input);
  const speed = 34;
  player.velocity = { x: desired.x * speed, y: desired.y * speed, z: desired.z * speed };
  player.position = {
    x: clamp(player.position.x + player.velocity.x * dt, WORLD.minX, WORLD.maxX),
    y: clamp(player.position.y + player.velocity.y * dt, WORLD.minY, WORLD.maxY),
    z: clamp(player.position.z + player.velocity.z * dt, WORLD.minZ, WORLD.maxZ),
  };
  return player;
}

function lineDistance(from, dir, point, range) {
  const px = point.x - from.x;
  const py = point.y - from.y;
  const pz = point.z - from.z;
  const t = clamp(px * dir.x + py * dir.y + pz * dir.z, 0, range);
  const closest = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
  return { distance: length3({ x: point.x - closest.x, y: point.y - closest.y, z: point.z - closest.z }), t, point: closest };
}

function shoot(shooter, aim, players, now) {
  const weapon = WEAPONS[shooter.weaponId];
  if (!shooter.alive) return { ok: false, reason: "dead" };
  if (now - shooter.lastShotAt < weapon.cooldownMs) return { ok: false, reason: "cooldown" };
  shooter.lastShotAt = now;
  const dir = normalize3(aim);
  const from = { ...shooter.position };
  const to = { x: from.x + dir.x * weapon.range, y: from.y + dir.y * weapon.range, z: from.z + dir.z * weapon.range };
  const directRadius = weapon.explosionRadius ? 4 : 3;
  const candidates = players
    .filter((player) => player.alive && player.id !== shooter.id)
    .map((player) => ({ player, hit: lineDistance(from, dir, player.position, weapon.range) }))
    .filter(({ hit }) => hit.distance <= directRadius)
    .sort((a, b) => a.hit.t - b.hit.t);
  const hits = [];
  const impact = candidates[0]?.hit.point || to;
  if (weapon.explosionRadius) {
    for (const target of players) {
      if (!target.alive || target.id === shooter.id) continue;
      const dist = length3({ x: target.position.x - impact.x, y: target.position.y - impact.y, z: target.position.z - impact.z });
      if (dist <= weapon.explosionRadius) hits.push({ target, damage: weapon.damage });
    }
  } else if (candidates[0]) {
    hits.push({ target: candidates[0].player, damage: weapon.damage });
  }
  return { ok: true, projectile: new Projectile(`${shooter.id}-${now}`, shooter.id, weapon.id, from, impact, now), hits };
}

function applyDamage(target, damage, attacker, now) {
  if (!target.alive) return { died: false };
  target.hp = clamp(target.hp - damage, 0, 100);
  if (target.hp > 0) return { died: false };
  target.alive = false;
  target.respawnAt = now + 5000;
  if (attacker && attacker.id !== target.id) {
    attacker.score += 1;
    attacker.credits += 100;
  }
  return { died: true };
}

function purchaseItem(player, itemId) {
  const item = SHOP.find((shopItem) => shopItem.id === itemId);
  if (!item) return { ok: false, message: "Unknown item" };
  if (player.credits < item.price) return { ok: false, message: "Not enough credits" };
  player.credits -= item.price;
  if (item.type === "weapon") player.weaponId = item.targetId;
  if (item.type === "skin") player.skinId = item.targetId;
  return { ok: true, message: `${item.name} equipped` };
}

function respawn(player, now) {
  if (player.alive || now < player.respawnAt) return player;
  player.position = randomSpawn();
  player.velocity = { x: 0, y: 0, z: 0 };
  player.hp = 100;
  player.alive = true;
  player.respawnAt = 0;
  return player;
}

// ===================== Interface Adapters =====================
class GameRepository {
  constructor() {
    this.players = new Map();
    this.inputs = new Map();
  }

  add(player) {
    this.players.set(player.id, player);
    this.inputs.set(player.id, { x: 0, y: 0, z: 0 });
  }

  get(id) {
    return this.players.get(id);
  }

  list() {
    return [...this.players.values()];
  }

  setInput(id, input) {
    this.inputs.set(id, input);
  }

  getInput(id) {
    return this.inputs.get(id) || { x: 0, y: 0, z: 0 };
  }

  remove(id) {
    this.players.delete(id);
    this.inputs.delete(id);
  }
}

const repository = new GameRepository();

function publicState() {
  return {
    players: repository.list().map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      velocity: player.velocity,
      aim: player.aim,
      yaw: player.yaw,
      hp: player.hp,
      alive: player.alive,
      weaponId: player.weaponId,
      skinId: player.skinId,
      credits: player.credits,
      score: player.score,
      respawnIn: player.alive ? 0 : Math.max(0, player.respawnAt - Date.now()),
    })),
    playerCount: repository.players.size,
  };
}

function sanitizeVector(raw) {
  return normalize3({ x: Number(raw?.x) || 0, y: Number(raw?.y) || 0, z: Number(raw?.z) || 0 });
}

// ===================== Frameworks & Drivers =====================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

io.on("connection", (socket) => {
  const player = new Player(socket.id, randomSpawn());
  repository.add(player);
  socket.emit("welcome", { id: player.id, weapons: WEAPONS, skins: SKINS, shop: SHOP });
  io.emit("snapshot", publicState());

  socket.on("input", (payload) => {
    const current = repository.get(socket.id);
    if (!current) return;
    repository.setInput(socket.id, sanitizeVector(payload?.move));
    current.aim = sanitizeVector(payload?.aim);
    current.yaw = Number(payload?.yaw) || 0;
  });

  socket.on("shoot", (payload) => {
    const shooter = repository.get(socket.id);
    if (!shooter) return;
    const result = shoot(shooter, sanitizeVector(payload?.dir || shooter.aim), repository.list(), Date.now());
    if (!result.ok) return;
    const kills = [];
    for (const hit of result.hits) {
      const outcome = applyDamage(hit.target, hit.damage, shooter, Date.now());
      if (outcome.died) kills.push({ killerId: shooter.id, victimId: hit.target.id });
    }
    io.emit("shot", { projectile: result.projectile, kills });
    io.emit("snapshot", publicState());
  });

  socket.on("buy", (itemId) => {
    const playerForPurchase = repository.get(socket.id);
    if (!playerForPurchase) return;
    const result = purchaseItem(playerForPurchase, itemId);
    socket.emit("purchaseResult", result);
    io.emit("snapshot", publicState());
  });

  socket.on("disconnect", () => {
    repository.remove(socket.id);
    io.emit("snapshot", publicState());
  });
});

let lastTick = Date.now();
let lastSnapshot = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.08, (now - lastTick) / 1000);
  lastTick = now;
  for (const player of repository.list()) {
    movePlayer(player, repository.getInput(player.id), dt);
    respawn(player, now);
  }
  if (now - lastSnapshot >= 1000 / SNAPSHOT_RATE) {
    lastSnapshot = now;
    io.emit("snapshot", publicState());
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Cyber Rangers server running on http://localhost:${PORT}`);
});
