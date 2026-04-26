// ── Game Constants ──────────────────────────────────────────────
export const LANE_COUNT = 3;
export const LANE_WIDTH = 3.0;
export const LANE_POSITIONS = [-LANE_WIDTH, 0, LANE_WIDTH];

export const SEGMENT_LENGTH = 20.0;
export const SEGMENTS_AHEAD = 5;
export const SEGMENTS_BEHIND = 2;

export const BASE_SPEED = 12.0;
export const MAX_SPEED = 35.0;
export const SPEED_INCREMENT = 0.0008;
export const OVERDRIVE_MULTIPLIER = 1.8;
export const OVERDRIVE_DURATION = 5000;
export const OVERDRIVE_CHARGE_MAX = 100;

export const JUMP_FORCE = 14.0;
export const GRAVITY = -35.0;
export const SLIDE_DURATION = 600;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_WIDTH = 0.8;
export const PLAYER_DEPTH = 0.6;
export const PLAYER_SLIDE_HEIGHT = 0.6;

// ── Network ────────────────────────────────────────────────────
export const SERVER_TICK_RATE = 20;
export const INTERPOLATION_DELAY = 100;
export const MAX_PLAYERS_PER_ROOM = 50;

// ── Collectibles ───────────────────────────────────────────────
export const CREDIT_VALUE = 10;
export const BATTERY_CHARGE = 25;
export const KEY_FRAGMENT_CHANCE = 0.05;

// ── Swarm bonus ────────────────────────────────────────────────
export const SWARM_RADIUS = 30;
export const SWARM_MIN_PLAYERS = 3;
export const SWARM_SPEED_BONUS = 1.15;
export const SWARM_CREDIT_BONUS = 1.5;

// ── Events ─────────────────────────────────────────────────────
export const CONTRACT_INTERVAL = 10 * 60 * 1000;
export const MEGA_EVENT_INTERVAL = 3 * 60 * 60 * 1000;
export const SEED_ROTATION_HOURS = 24;

// ── Obstacles ──────────────────────────────────────────────────
export const OBSTACLE_TYPES = {
  LASER_LOW: 'laser_low',
  LASER_HIGH: 'laser_high',
  BLADE: 'blade',
  DRONE: 'drone',
  PANEL: 'panel',
  PLATFORM_COLLAPSE: 'platform_collapse',
  VIRUS_DRONE: 'virus_drone',
};

export const COLLECTIBLE_TYPES = {
  CREDIT: 'credit',
  BATTERY: 'battery',
  KEY_FRAGMENT: 'key_fragment',
};

// ── Visuals ────────────────────────────────────────────────────
export const COLORS = {
  NEON_CYAN: 0x00f0ff,
  NEON_MAGENTA: 0xff00ff,
  NEON_YELLOW: 0xffff00,
  NEON_PURPLE: 0xaa00ff,
  DARK_BLUE: 0x0a0a2e,
  DEEP_PURPLE: 0x1a0033,
  ROAD_SURFACE: 0x111122,
  BUILDING_DARK: 0x0d0d1a,
  BUILDING_ACCENT: 0x1a1a3e,
};
