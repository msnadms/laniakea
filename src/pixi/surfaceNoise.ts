import type { Rng } from '../game/types';

export const TAU = Math.PI * 2;

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];
export type SurfaceSample = { albedo: Rgb; height: number; cloud: number; ocean: number };
export type Noise3 = (x: number, y: number, z: number) => number;

export function createNoise3(rng: Rng): Noise3 {
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  for (let index = 0; index < 256; index++) {
    perm[index] = index;
    values[index] = rng();
  }
  for (let index = 255; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    const held = perm[index];
    perm[index] = perm[swap];
    perm[swap] = held;
  }
  for (let index = 0; index < 256; index++) perm[index + 256] = perm[index];

  return (x, y, z) => {
    const px = x + 1024;
    const py = y + 1024;
    const pz = z + 1024;
    const ix = px | 0;
    const iy = py | 0;
    const iz = pz | 0;
    const fx = px - ix;
    const fy = py - iy;
    const fz = pz - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const x0 = ix & 255;
    const x1 = (ix + 1) & 255;
    const y0 = iy & 255;
    const y1 = (iy + 1) & 255;
    const z0 = iz & 255;
    const z1 = (iz + 1) & 255;
    const p0 = perm[x0];
    const p1 = perm[x1];
    const p00 = perm[p0 + y0];
    const p01 = perm[p0 + y1];
    const p10 = perm[p1 + y0];
    const p11 = perm[p1 + y1];
    const a = values[perm[p00 + z0]] + (values[perm[p10 + z0]] - values[perm[p00 + z0]]) * sx;
    const b = values[perm[p01 + z0]] + (values[perm[p11 + z0]] - values[perm[p01 + z0]]) * sx;
    const c = values[perm[p00 + z1]] + (values[perm[p10 + z1]] - values[perm[p00 + z1]]) * sx;
    const d = values[perm[p01 + z1]] + (values[perm[p11 + z1]] - values[perm[p01 + z1]]) * sx;
    const near = a + (b - a) * sy;
    const far = c + (d - c) * sy;
    return near + (far - near) * sz;
  };
}

export function fbm(noise: Noise3, x: number, y: number, z: number, octaves: number) {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(color: Rgb, amount: number): Rgb {
  return [color[0] * amount, color[1] * amount, color[2] * amount];
}

export function toRgb(color: number): Rgb {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

export function randomUnitVector(rng: Rng): Vec3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return [Math.cos(angle) * ring, z, Math.sin(angle) * ring];
}

export type Crater = { center: Vec3; radius: number; depth: number };

export function craterHeight(point: Vec3, craters: Crater[]) {
  let height = 0;
  let floor = 0;
  for (const crater of craters) {
    const dx = point[0] - crater.center[0];
    const dy = point[1] - crater.center[1];
    const dz = point[2] - crater.center[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    const reach = crater.radius * 1.4;
    if (distanceSquared > reach * reach) continue;
    const distance = Math.sqrt(distanceSquared) / crater.radius;
    if (distance < 1) {
      height -= crater.depth * (1 - distance * distance);
      floor = Math.max(floor, 1 - distance);
    }
    const rim = 1 - Math.abs(distance - 1) / 0.4;
    if (rim > 0) height += crater.depth * 0.45 * rim * rim;
  }
  return { height, floor };
}

export function cellHash(x: number, y: number, z: number, seed: number) {
  let hash = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 13), 0x5bd1e995);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

export const DEEP_OCEAN: Rgb = [10, 30, 72];
export const SHALLOW_OCEAN: Rgb = [34, 92, 136];
export const DESERT: Rgb = [176, 148, 98];
export const STEPPE: Rgb = [124, 120, 70];
export const FOREST: Rgb = [42, 80, 36];
export const JUNGLE: Rgb = [28, 70, 30];
export const TUNDRA: Rgb = [112, 116, 92];
export const ROCK: Rgb = [110, 100, 84];
export const ICE: Rgb = [226, 236, 244];
export const CITY_GREY: Rgb = [132, 130, 128];
export const SCORCH: Rgb = [30, 24, 18];
