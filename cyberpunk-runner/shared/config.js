import { OBSTACLE_TYPES, COLLECTIBLE_TYPES } from './constants.js';

// Obstacle definitions with avoidance actions
export const OBSTACLE_DEFS = {
  [OBSTACLE_TYPES.LASER_LOW]: {
    height: 0.5,
    width: 3.0,
    action: 'jump',
    color: 0xff0044,
    minDistance: 100,
  },
  [OBSTACLE_TYPES.LASER_HIGH]: {
    height: 1.6,
    yOffset: 1.0,
    width: 3.0,
    action: 'slide',
    color: 0xff0044,
    minDistance: 80,
  },
  [OBSTACLE_TYPES.BLADE]: {
    height: 2.0,
    width: 1.5,
    action: 'jump_or_slide',
    color: 0xff4400,
    rotates: true,
    minDistance: 120,
  },
  [OBSTACLE_TYPES.DRONE]: {
    height: 1.0,
    width: 1.0,
    action: 'lane_change',
    color: 0xaa00ff,
    flies: true,
    minDistance: 60,
  },
  [OBSTACLE_TYPES.PANEL]: {
    height: 2.5,
    width: 2.8,
    action: 'lane_change',
    color: 0x666688,
    minDistance: 0,
  },
  [OBSTACLE_TYPES.PLATFORM_COLLAPSE]: {
    height: 0,
    width: 3.0,
    action: 'jump',
    color: 0x884400,
    collapses: true,
    minDistance: 200,
  },
  [OBSTACLE_TYPES.VIRUS_DRONE]: {
    height: 1.0,
    width: 1.0,
    action: 'lane_change',
    color: 0x00ff44,
    disables: true,
    disableDuration: 2000,
    minDistance: 300,
  },
};

// Collectible spawn weights
export const COLLECTIBLE_WEIGHTS = {
  [COLLECTIBLE_TYPES.CREDIT]: 0.7,
  [COLLECTIBLE_TYPES.BATTERY]: 0.25,
  [COLLECTIBLE_TYPES.KEY_FRAGMENT]: 0.05,
};

// Difficulty curve
export const DIFFICULTY = {
  baseObstaclesPerSegment: 1,
  maxObstaclesPerSegment: 4,
  rampDistance: 5000,
  collectiblesPerSegment: { min: 2, max: 6 },
};

// Implant definitions
export const IMPLANTS = {
  double_jump: { name: 'Двойной прыжок', level: 3, cost: 500 },
  credit_magnet: { name: 'Магнит кредитов', level: 5, cost: 800 },
  slow_death: { name: 'Замедление смерти', level: 8, cost: 1200 },
  overdrive_extend: { name: 'Овердрайв+', level: 10, cost: 1500 },
  shield: { name: 'Наноброня', level: 15, cost: 3000 },
};
