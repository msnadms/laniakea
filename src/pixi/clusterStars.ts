import { createRng } from '../game/galaxyGen';
import {
  UNIVERSE_CLUSTER_MAX_STARS,
  UNIVERSE_CLUSTER_MIN_STARS,
  UNIVERSE_CLUSTER_RADIUS,
  UNIVERSE_CLUSTER_TEMPLATES,
} from '../game/constants';

const TEMPLATE_SEED = 0x2c1b3c6d;
const FIELD_STAR_CHANCE = 0.15;
export const CLUSTER_MAX_OFFSET = 1.2;

export const CLUSTER_X = new Float32Array(UNIVERSE_CLUSTER_TEMPLATES * UNIVERSE_CLUSTER_MAX_STARS);
export const CLUSTER_Y = new Float32Array(UNIVERSE_CLUSTER_TEMPLATES * UNIVERSE_CLUSTER_MAX_STARS);
export const CLUSTER_Z = new Float32Array(UNIVERSE_CLUSTER_TEMPLATES * UNIVERSE_CLUSTER_MAX_STARS);
export const CLUSTER_SIZE = new Float32Array(UNIVERSE_CLUSTER_TEMPLATES * UNIVERSE_CLUSTER_MAX_STARS);
export const CLUSTER_TINT = new Int8Array(UNIVERSE_CLUSTER_TEMPLATES * UNIVERSE_CLUSTER_MAX_STARS);

interface Clump {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

function buildTemplates() {
  const rng = createRng(TEMPLATE_SEED);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const clumps: Clump[] = [];
  const stars: { x: number; y: number; z: number; size: number; tint: number }[] = [];
  for (let t = 0; t < UNIVERSE_CLUSTER_TEMPLATES; t++) {
    clumps.length = 0;
    const clumpCount = 1 + Math.floor(rng() * 4);
    for (let c = 0; c < clumpCount; c++) {
      const spread = c === 0 ? 0.15 : 0.45;
      const sigma = 0.12 + rng() * 0.18;
      clumps.push({
        x: gauss() * spread,
        y: gauss() * spread * 0.7,
        z: gauss() * spread,
        sx: sigma * (0.5 + rng() * 1.1),
        sy: sigma * (0.5 + rng() * 1.1),
        sz: sigma * (0.5 + rng() * 1.1),
      });
    }
    stars.length = 0;
    for (let k = 0; k < UNIVERSE_CLUSTER_MAX_STARS; k++) {
      let x: number;
      let y: number;
      let z: number;
      if (rng() < FIELD_STAR_CHANCE) {
        x = gauss() * 0.5;
        y = gauss() * 0.35;
        z = gauss() * 0.5;
      } else {
        const clump = clumps[Math.floor(rng() * rng() * clumps.length)];
        x = clump.x + gauss() * clump.sx;
        y = clump.y + gauss() * clump.sy;
        z = clump.z + gauss() * clump.sz;
      }
      const length = Math.hypot(x, y, z);
      if (length > CLUSTER_MAX_OFFSET) {
        x *= CLUSTER_MAX_OFFSET / length;
        y *= CLUSTER_MAX_OFFSET / length;
        z *= CLUSTER_MAX_OFFSET / length;
      }
      const roll = rng();
      stars.push({ x, y, z, size: 0.5 + 1.5 * roll ** 4, tint: roll < 0.2 ? -1 : roll > 0.8 ? 1 : 0 });
    }
    let brightest = 0;
    for (let k = 1; k < stars.length; k++) if (stars[k].size > stars[brightest].size) brightest = k;
    const core = stars[brightest];
    stars[brightest] = stars[0];
    stars[0] = { ...core, x: clumps[0].x * 0.3, y: clumps[0].y * 0.3, z: clumps[0].z * 0.3, size: 2, tint: -1 };
    const base = t * UNIVERSE_CLUSTER_MAX_STARS;
    for (let k = 0; k < stars.length; k++) {
      CLUSTER_X[base + k] = stars[k].x;
      CLUSTER_Y[base + k] = stars[k].y;
      CLUSTER_Z[base + k] = stars[k].z;
      CLUSTER_SIZE[base + k] = stars[k].size;
      CLUSTER_TINT[base + k] = stars[k].tint;
    }
  }
}

buildTemplates();

export function clusterTemplate(seed: number): number {
  return (Math.imul(seed, 0x9e3779b1) >>> 0) % UNIVERSE_CLUSTER_TEMPLATES;
}

export function clusterRadius(brightness: number): number {
  return UNIVERSE_CLUSTER_RADIUS * (0.55 + 0.75 * brightness);
}

export function clusterStarCount(brightness: number): number {
  const span = UNIVERSE_CLUSTER_MAX_STARS - UNIVERSE_CLUSTER_MIN_STARS;
  return Math.round(UNIVERSE_CLUSTER_MIN_STARS + span * Math.min(1, brightness));
}
