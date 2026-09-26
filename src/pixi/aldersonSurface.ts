import { createRng } from '../game/galaxyGen';
import {
  cellHash,
  CITY_GREY,
  craterHeight,
  createNoise3,
  DEEP_OCEAN,
  DESERT,
  fbm,
  FOREST,
  ICE,
  JUNGLE,
  mix,
  ROCK,
  scale,
  SCORCH,
  SHALLOW_OCEAN,
  smoothstep,
  STEPPE,
  TAU,
  TUNDRA,
  type Crater,
  type Rgb,
} from './surfaceNoise';

export const DISK_SURFACE_WIDTH = 4096;
export const DISK_SURFACE_HEIGHT = 512;

const DISK_LIP = 0.06;
const DISK_LIP_BLEND = 0.025;
const DISK_COAST = 0.006;
const DISK_PANELS_AROUND = 192;
const DISK_PANEL_ROWS = 48;
const DISK_GIRDER_EVERY = 8;
const DISK_CITIES = 36;
const DISK_CITY_MIN_T = 0.24;
const DISK_CITY_SPAN = 0.56;
const DISK_BLOCK_FREQUENCY = 45;
const PLATING: Rgb = [84, 90, 100];
const GIRDER: Rgb = [24, 28, 34];
const SALT: Rgb = [206, 196, 176];
const RED_ROCK: Rgb = [150, 88, 56];
const SEA_ICE: Rgb = [192, 212, 226];
const RUST: Rgb = [116, 84, 60];
const DUST: Rgb = [138, 120, 98];
const SEABED: Rgb = [58, 50, 42];
const RUBBLE: Rgb = [66, 62, 58];
const ROOF: Rgb = [214, 206, 190];

export type DiskCity = { angle: number; t: number; radius: number };

export type DiskField = {
  cities: DiskCity[];
  landAt: (angle: number, t: number) => boolean;
  fallback: (t: number) => Rgb;
  paintRows: (from: number, to: number, albedo: Uint8ClampedArray, detail: Uint8ClampedArray) => void;
};

function panelAt(angle: number, t: number, seed: number) {
  const panelWidth = DISK_SURFACE_WIDTH / DISK_PANELS_AROUND;
  const panelHeight = DISK_SURFACE_HEIGHT / DISK_PANEL_ROWS;
  const u = angle / TAU * DISK_PANELS_AROUND;
  const v = t * DISK_PANEL_ROWS;
  const column = Math.floor(u);
  const row = Math.floor(v);
  const fu = u - column;
  const fv = v - row;
  const seam = smoothstep(1.2, 0.4, Math.min(Math.min(fu, 1 - fu) * panelWidth, Math.min(fv, 1 - fv) * panelHeight));
  const girderU = column % DISK_GIRDER_EVERY === 0 ? fu : (column + 1) % DISK_GIRDER_EVERY === 0 ? 1 - fu : 1;
  const girderV = row % DISK_GIRDER_EVERY === 0 ? fv : (row + 1) % DISK_GIRDER_EVERY === 0 ? 1 - fv : 1;
  const girder = smoothstep(2.4, 0.8, Math.min(girderU * panelWidth, girderV * panelHeight));
  return { seam: Math.max(seam * 0.4, girder * 0.8), value: cellHash(column, row, 0, seed) };
}

export function createDiskField(seed: number, innerRatio: number, living: boolean): DiskField {
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const seaLevel = 0.47 + rng() * 0.04;
  const panelSeed = Math.floor(rng() * 0x7fffffff);
  const blockSeed = Math.floor(rng() * 0x7fffffff);

  const terrainAt = (x: number, z: number) => {
    const wx = x + (fbm(noise, x * 1.4 + 5, 1.7, z * 1.4, 3) - 0.5) * 0.6;
    const wz = z + (fbm(noise, x * 1.4, 9.3, z * 1.4 + 17, 3) - 0.5) * 0.6;
    return fbm(noise, wx * 2.6, 0.5, wz * 2.6, 3) * 0.88 + fbm(noise, x * 21, 40.5, z * 21, 4) * 0.12;
  };
  const landAt = (angle: number, t: number) => {
    const radius = innerRatio + t;
    return t > DISK_LIP && terrainAt(Math.cos(angle) * radius, Math.sin(angle) * radius) > seaLevel;
  };

  const cities: (DiskCity & { x: number; z: number })[] = [];
  for (let tries = 0; cities.length < DISK_CITIES && tries < DISK_CITIES * 20; tries++) {
    const angle = rng() * TAU;
    const t = DISK_CITY_MIN_T + rng() * DISK_CITY_SPAN;
    const radius = 0.04 + rng() * 0.06;
    const r = innerRatio + t;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (terrainAt(x, z) <= seaLevel + 0.02) continue;
    cities.push({ angle, t, radius, x, z });
  }
  const scars: Crater[] = living ? [] : Array.from({ length: 18 + Math.floor(rng() * 12) }, () => {
    const angle = rng() * TAU;
    const r = innerRatio + DISK_LIP + rng() * (1 - DISK_LIP);
    return { center: [Math.cos(angle) * r, 0, Math.sin(angle) * r], radius: 0.015 + Math.pow(rng(), 2) * 0.07, depth: 0.2 + rng() * 0.15 };
  });

  const cityDensity = (x: number, z: number) => {
    let density = 0;
    for (const city of cities) {
      const dx = x - city.x;
      const dz = z - city.z;
      if (Math.abs(dx) > city.radius || Math.abs(dz) > city.radius) continue;
      const sprawl = (fbm(noise, x * 24 + 5, 12.2, z * 24, 3) - 0.5) * city.radius * 0.9;
      density = Math.max(density, smoothstep(city.radius, city.radius * 0.2, Math.sqrt(dx * dx + dz * dz) + sprawl));
    }
    return density;
  };

  const fallback = (t: number): Rgb => {
    if (t < DISK_LIP) return PLATING;
    if (!living) return mix(DUST, RUST, smoothstep(0.2, 0.7, t));
    if (t < 0.22) return DESERT;
    if (t < 0.8) return mix(SHALLOW_OCEAN, FOREST, 0.4);
    return ICE;
  };

  let rowScars: Crater[] = [];
  const sample = (angle: number, t: number) => {
    const r = innerRatio + t;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const temperature = 1 - t * 1.1 + (fbm(noise, x * 2.2 + 7, 3.1, z * 2.2, 3) - 0.5) * 0.3;
    const continent = terrainAt(x, z);
    const grain = 0.9 + fbm(noise, x * 14, 2.2, z * 14 + 3, 4) * 0.2;
    const coast = smoothstep(seaLevel - DISK_COAST, seaLevel + DISK_COAST, continent);
    const erosion = living ? 0 : fbm(noise, x * 3.3 + 41, 8.8, z * 3.3, 5);
    let albedo: Rgb = SEABED;
    let height = 0.5;
    let ocean = 0;

    if (coast < 1) {
      const depth = Math.max(0, seaLevel - continent) / seaLevel;
      if (!living) {
        height = 0.5 - depth * 0.3;
        albedo = mix(SEABED, SALT, smoothstep(0.6, 0.75, fbm(noise, x * 9 + 13, 6.6, z * 9, 4)) * 0.4);
      } else if (temperature < 0.12) {
        albedo = scale(SEA_ICE, grain);
      } else {
        const evaporated = smoothstep(0.84, 0.92, temperature);
        albedo = mix(mix(SHALLOW_OCEAN, DEEP_OCEAN, smoothstep(0, 0.22, depth)), mix(SALT, DESERT, smoothstep(0.02, 0.1, depth) * 0.6), evaporated);
        height = 0.5 - depth * 0.08 * evaporated;
        ocean = 1 - evaporated;
      }
    }

    if (coast > 0) {
      const elevation = Math.max(0, continent - seaLevel) / (1 - seaLevel);
      const ridge = 1 - Math.abs(fbm(noise, x * 5, 7.7, z * 5, 5) * 2 - 1);
      const wetness = fbm(noise, x * 2.6 + 83, 5.5, z * 2.6, 5);
      let land = mix(DESERT, STEPPE, smoothstep(0.32, 0.45, wetness));
      land = mix(land, FOREST, smoothstep(0.45, 0.58, wetness));
      land = mix(land, JUNGLE, smoothstep(0.62, 0.78, temperature) * smoothstep(0.5, 0.62, wetness));
      land = mix(land, DESERT, smoothstep(0.72, 0.86, temperature));
      land = mix(land, RED_ROCK, smoothstep(0.9, 1, temperature) * 0.8);
      land = mix(land, TUNDRA, smoothstep(0.32, 0.18, temperature));
      land = mix(land, ROCK, smoothstep(0.4, 0.7, elevation + ridge * 0.2));
      const dunes = smoothstep(0.72, 0.9, temperature) * (1 - Math.abs(fbm(noise, x * 16 + 21, 4.4, z * 16, 3) * 2 - 1)) ** 2;
      land = scale(land, grain * (0.94 + dunes * 0.1));
      const snowy = temperature < 0.1 || (elevation > 0.7 && temperature < 0.45);
      if (snowy) land = scale(ICE, 0.94 + grain * 0.06);
      let landHeight = 0.5 + elevation * 0.35 + ridge * elevation * 0.25 + dunes * 0.03;

      const density = cityDensity(x, z);
      if (density > 0) {
        const gx = x * DISK_BLOCK_FREQUENCY + 4096;
        const gz = z * DISK_BLOCK_FREQUENCY + 4096;
        const bx = Math.floor(gx);
        const bz = Math.floor(gz);
        const block = cellHash(bx, bz, 0, blockSeed);
        const street = smoothstep(0.14, 0.05, Math.min(gx - bx, 1 - gx + bx, gz - bz, 1 - gz + bz));
        const fabric = mix(mix(CITY_GREY, ROOF, block * 0.3), scale(CITY_GREY, 0.8), street * 0.4);
        land = mix(land, living ? fabric : mix(RUBBLE, fabric, 0.3), density * 0.8);
        landHeight += density * block * 0.03 * (1 - street);
      }
      if (!living) land = mix(land, mix(RUST, DUST, smoothstep(0.35, 0.65, erosion)), temperature < 0.1 ? 0.35 : 0.75);

      albedo = mix(albedo, land, coast);
      height += (landHeight - height) * coast;
      ocean *= 1 - coast;
    }

    let cloud: number;
    const cloudField = fbm(noise, x * 3.2 + 61, t * 10, z * 3.2, 6);
    if (living) {
      cloud = smoothstep(0.52, 0.72, cloudField) * 0.9;
    } else {
      albedo = scale(albedo, 0.82);
      const { height: impact, floor } = craterHeight([x, 0, z], rowScars);
      const burn = smoothstep(0.58, 0.76, fbm(noise, x * 2.8 + 47, 1.1, z * 2.8, 4));
      albedo = mix(albedo, SCORCH, Math.min(1, burn * 0.55 + floor * 0.9));
      height = height * (1 - floor) + impact + floor * 0.45;
      const exposed = smoothstep(0.6, 0.7, erosion);
      if (exposed > 0) {
        const panel = panelAt(angle, t, panelSeed);
        const plating = mix(scale(PLATING, 0.55 + panel.value * 0.2), GIRDER, panel.seam);
        albedo = mix(albedo, plating, exposed);
        height = height * (1 - exposed) + (0.44 - panel.seam * 0.06) * exposed;
      }
      cloud = smoothstep(0.66, 0.82, cloudField) * 0.5;
    }

    const lip = smoothstep(DISK_LIP, DISK_LIP - DISK_LIP_BLEND, t);
    if (lip > 0) {
      const wear = fbm(noise, x * 6 + 31, 2.9, z * 6, 4);
      const scuff = fbm(noise, x * 40, 14.1, z * 40 + 11, 3);
      let plating = scale(PLATING, 0.9 + wear * 0.14 + scuff * 0.06);
      if (!living) plating = mix(scale(plating, 0.7), RUST, smoothstep(0.45, 0.7, wear) * 0.45);
      albedo = mix(albedo, plating, lip);
      height = height * (1 - lip) + 0.5 * lip;
      ocean *= 1 - lip;
      cloud *= 1 - lip;
    }

    return { albedo, height: Math.min(1, Math.max(0, height)), cloud, ocean };
  };

  const paintRows = (from: number, to: number, albedo: Uint8ClampedArray, detail: Uint8ClampedArray) => {
    for (let py = from; py < to; py++) {
      const t = (py + 0.5) / DISK_SURFACE_HEIGHT;
      rowScars = scars.filter(({ center, radius }) => Math.abs(Math.hypot(center[0], center[2]) - innerRatio - t) < radius * 1.4);
      for (let px = 0; px < DISK_SURFACE_WIDTH; px++) {
        const result = sample((px + 0.5) / DISK_SURFACE_WIDTH * TAU, t);
        const index = ((py - from) * DISK_SURFACE_WIDTH + px) * 4;
        albedo[index] = result.albedo[0];
        albedo[index + 1] = result.albedo[1];
        albedo[index + 2] = result.albedo[2];
        albedo[index + 3] = 255;
        detail[index] = result.height * 255;
        detail[index + 1] = result.cloud * 255;
        detail[index + 2] = result.ocean * 255;
        detail[index + 3] = 255;
      }
    }
  };

  return { cities: cities.map(({ angle, t, radius }) => ({ angle, t, radius })), landAt, fallback, paintRows };
}
