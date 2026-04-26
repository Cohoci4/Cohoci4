// Deterministic PRNG (mulberry32) for procedural generation
export function createRNG(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailySeed() {
  const now = new Date();
  const day = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return hashInt(day);
}

export function hashInt(n) {
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = (n >> 16) ^ n;
  return n >>> 0;
}

export function segmentSeed(baseSeed, segmentIndex) {
  return hashInt(baseSeed ^ (segmentIndex * 2654435761));
}
