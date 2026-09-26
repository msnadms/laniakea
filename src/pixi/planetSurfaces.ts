import { createRng } from '../game/galaxyGen';
import { createDiskField, DISK_SURFACE_HEIGHT, DISK_SURFACE_WIDTH, type DiskCity } from './aldersonSurface';
import type { DiskPaintRequest, DiskPaintResult } from './aldersonSurface.worker';
import type { Rng } from '../game/types';
import { cityDistricts, districtDensity } from './ecumenopolis';
import {
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
  randomUnitVector,
  ROCK,
  scale,
  SCORCH,
  SHALLOW_OCEAN,
  smoothstep,
  STEPPE,
  toRgb,
  TUNDRA,
  cellHash,
  type Crater,
  type Rgb,
  type SurfaceSample,
  type Vec3,
} from './surfaceNoise';

export const PLANET_SURFACE_SIZE = 256;
export const MOON_SURFACE_SIZE = 128;

export type BodySurface = {
  albedo: HTMLCanvasElement;
  detail: HTMLCanvasElement;
};

export type SurfaceJob = {
  surface: BodySurface;
  step: (deadline: number) => boolean;
};








function rgbStyle(color: Rgb) {
  return `rgb(${color.map(Math.round).join(',')})`;
}

function paintRows(width: number, height: number, fallback: (row: number) => Rgb, sample: (px: number, py: number) => SurfaceSample): SurfaceJob {
  const albedo = document.createElement('canvas');
  const detail = document.createElement('canvas');
  albedo.width = detail.width = width;
  albedo.height = detail.height = height;
  const albedoContext = albedo.getContext('2d')!;
  const detailContext = detail.getContext('2d')!;
  for (let py = 0; py < height; py++) {
    albedoContext.fillStyle = rgbStyle(fallback(py));
    albedoContext.fillRect(0, py, width, 1);
  }
  detailContext.fillStyle = 'rgb(128,0,0)';
  detailContext.fillRect(0, 0, width, height);
  const albedoImage = albedoContext.createImageData(width, height);
  const detailImage = detailContext.createImageData(width, height);
  let row = 0;

  function paintRow(py: number) {
    for (let px = 0; px < width; px++) {
      const result = sample(px, py);
      const index = (py * width + px) * 4;
      albedoImage.data[index] = result.albedo[0];
      albedoImage.data[index + 1] = result.albedo[1];
      albedoImage.data[index + 2] = result.albedo[2];
      albedoImage.data[index + 3] = 255;
      detailImage.data[index] = result.height * 255;
      detailImage.data[index + 1] = result.cloud * 255;
      detailImage.data[index + 2] = result.ocean * 255;
      detailImage.data[index + 3] = 255;
    }
  }

  return {
    surface: { albedo, detail },
    step(deadline) {
      while (row < height) {
        paintRow(row++);
        if (row % 8 === 0 && performance.now() >= deadline) break;
      }
      if (row < height) return false;
      albedoContext.putImageData(albedoImage, 0, 0);
      detailContext.putImageData(detailImage, 0, 0);
      return true;
    },
  };
}

function paintSphere(size: number, rng: Rng, fallback: Rgb, sample: (point: Vec3, discX: number, discY: number) => SurfaceSample): SurfaceJob {
  const roll = (rng() - 0.5) * 0.7;
  const pitch = (rng() - 0.5) * 0.8;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const point: Vec3 = [0, 0, 0];

  return paintRows(size, size, () => fallback, (px, py) => {
    let dx = (px + 0.5) / size * 2 - 1;
    let dy = (py + 0.5) / size * 2 - 1;
    const radiusSquared = dx * dx + dy * dy;
    if (radiusSquared > 1) {
      const radius = Math.sqrt(radiusSquared);
      dx /= radius;
      dy /= radius;
    }
    const vy = -dy;
    const vz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
    const ry = dx * sinRoll + vy * cosRoll;
    point[0] = dx * cosRoll - vy * sinRoll;
    point[1] = ry * cosPitch - vz * sinPitch;
    point[2] = ry * sinPitch + vz * cosPitch;
    return sample(point, dx, dy);
  });
}


function scatterCraters(rng: Rng, count: number, minRadius: number, maxRadius: number): Crater[] {
  return Array.from({ length: count }, () => {
    const radius = minRadius + Math.pow(rng(), 2.2) * (maxRadius - minRadius);
    return { center: randomUnitVector(rng), radius, depth: 0.18 + rng() * 0.14 };
  });
}


type RockyOptions = { craters: number; maria: number; grey: number };

function paintRocky(color: number, seed: number, size: number, options: RockyOptions): SurfaceJob {
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const craters = scatterCraters(rng, options.craters, 0.03, 0.24);
  const base = mix(toRgb(color), [150, 146, 140], options.grey);
  const dark = mix(scale(base, 0.45), [60, 52, 46], 0.3);
  const warm = mix(base, [196, 150, 104], 0.35);

  return paintSphere(size, rng, base, ([x, y, z]) => {
    const terrain = fbm(noise, x * 2.2 + 11, y * 2.2, z * 2.2, 5);
    const ridge = 1 - Math.abs(fbm(noise, x * 4.1, y * 4.1 + 31, z * 4.1, 4) * 2 - 1);
    const { height: craterRelief, floor } = craterHeight([x, y, z], craters);
    const mare = smoothstep(0.5, 0.64, fbm(noise, x * 1.3 + 57, y * 1.3, z * 1.3 + 9, 3)) * options.maria;
    const tone = 0.72 + fbm(noise, x * 5.3, y * 5.3, z * 5.3 + 73, 4) * 0.5;
    let albedo = mix(base, warm, smoothstep(0.35, 0.7, fbm(noise, x * 1.7 + 91, y * 1.7, z * 1.7, 3)));
    albedo = mix(scale(albedo, tone), dark, mare * 0.75);
    albedo = scale(albedo, 1 + floor * 0.12);
    const height = Math.min(1, Math.max(0, 0.45 + terrain * 0.3 + ridge * 0.12 + craterRelief - mare * 0.06));
    return { albedo, height, cloud: 0, ocean: 0 };
  });
}

export function paintRockyPlanet(color: number, seed: number): SurfaceJob {
  return paintRocky(color, seed, PLANET_SURFACE_SIZE, { craters: 26, maria: 0.55, grey: 0.15 });
}

export function paintMoon(color: number, seed: number): SurfaceJob {
  return paintRocky(color, seed, MOON_SURFACE_SIZE, { craters: 40, maria: 0.9, grey: 0.4 });
}


export function paintHabitablePlanet(color: number, seed: number): SurfaceJob {
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const seaLevel = 0.44 + rng() * 0.06;
  const capLatitude = 0.93 + rng() * 0.04;
  const tint = toRgb(color);

  return paintSphere(PLANET_SURFACE_SIZE, rng, mix(DEEP_OCEAN, tint, 0.4), ([x, y, z]) => {
    const wx = x + (fbm(noise, x * 1.5 + 5, y * 1.5, z * 1.5, 3) - 0.5) * 0.7;
    const wy = y + (fbm(noise, x * 1.5, y * 1.5 + 17, z * 1.5, 3) - 0.5) * 0.7;
    const wz = z + (fbm(noise, x * 1.5, y * 1.5, z * 1.5 + 29, 3) - 0.5) * 0.7;
    const continent = fbm(noise, wx * 1.8, wy * 1.8, wz * 1.8, 6);
    const latitude = Math.abs(y);
    const capNoise = (fbm(noise, x * 4, y * 4 + 41, z * 4, 3) - 0.5) * 0.12;
    const isCap = latitude > capLatitude + capNoise;

    const cloudField = fbm(noise, wx * 3.4 + 61, wy * 5.2, wz * 3.4, 5);
    const cloudBands = 0.08 * Math.cos(latitude * Math.PI * 3.2);
    const cloud = smoothstep(0.5, 0.72, cloudField + cloudBands) * 0.95;

    if (continent <= seaLevel) {
      const depth = (seaLevel - continent) / seaLevel;
      const water = mix(SHALLOW_OCEAN, DEEP_OCEAN, smoothstep(0, 0.22, depth));
      return {
        albedo: isCap ? ICE : water,
        height: 0.5,
        cloud,
        ocean: isCap ? 0 : 1,
      };
    }

    const elevation = (continent - seaLevel) / (1 - seaLevel);
    const moisture = fbm(noise, x * 2.6 + 83, y * 2.6, z * 2.6, 4);
    const temperature = 1 - latitude * 1.05 - elevation * 0.7 + (fbm(noise, x * 3 + 7, y * 3, z * 3 + 97, 3) - 0.5) * 0.25;
    const subtropics = 1 - Math.abs(latitude - 0.42) / 0.2;
    const wetness = moisture - Math.max(0, subtropics) * 0.18;
    let land = mix(DESERT, STEPPE, smoothstep(0.32, 0.45, wetness));
    land = mix(land, FOREST, smoothstep(0.45, 0.58, wetness));
    land = mix(land, JUNGLE, smoothstep(0.7, 0.9, temperature) * smoothstep(0.5, 0.62, wetness));
    land = mix(land, TUNDRA, smoothstep(0.32, 0.18, temperature));
    land = mix(land, ROCK, smoothstep(0.35, 0.6, elevation));
    land = mix(land, tint, 0.12);
    land = scale(land, 0.9 + fbm(noise, x * 9, y * 9, z * 9 + 3, 3) * 0.2);
    if (land[1] < land[2] + 6) land[1] = land[2] + 6;
    const snowy = isCap || temperature < 0.12 || (elevation > 0.72 && temperature < 0.5);
    return {
      albedo: snowy ? ICE : land,
      height: 0.5 + elevation * 0.5,
      cloud,
      ocean: 0,
    };
  });
}

type Storm = { longitude: number; latitude: number; width: number; height: number; color: Rgb };

export function paintGiantPlanet(color: number, seed: number, isIce: boolean): SurfaceJob {
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const base = toRgb(color);
  const light = mix(base, isIce ? [220, 240, 255] : [240, 226, 200], isIce ? 0.25 : 0.4);
  const dark = isIce ? scale(base, 0.78) : mix(scale(base, 0.62), [120, 70, 44], 0.3);
  const frequency = isIce ? 3 + rng() * 2 : 5 + rng() * 4;
  const turbulence = isIce ? 0.35 : 1.1 + rng() * 0.5;
  const phase = rng() * Math.PI * 2;
  const secondPhase = rng() * Math.PI * 2;
  const storms: Storm[] = Array.from({ length: isIce ? Math.floor(rng() * 2) : 1 + Math.floor(rng() * 3) }, (_, index) => ({
    longitude: rng() * Math.PI * 2,
    latitude: (rng() - 0.5) * 1.1,
    width: index === 0 ? 0.28 + rng() * 0.12 : 0.1 + rng() * 0.08,
    height: index === 0 ? 0.12 + rng() * 0.05 : 0.05 + rng() * 0.03,
    color: isIce ? scale(base, 0.5) : index === 0 ? [200, 116, 82] : [236, 228, 214],
  }));

  return paintSphere(PLANET_SURFACE_SIZE, rng, mix(dark, light, 0.5), ([x, y, z]) => {
    const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
    const longitude = Math.atan2(z, x);
    const swirl = (fbm(noise, x * 2.4, y * 7, z * 2.4, 5) - 0.5) * turbulence;
    const band = y * frequency + swirl;
    const value = 0.5
      + 0.32 * Math.sin(band * Math.PI + phase)
      + 0.18 * Math.sin(band * Math.PI * 2.3 + secondPhase);
    const streaks = fbm(noise, x * 3, y * 42 + swirl * 6, z * 3, 3);
    let albedo = mix(dark, light, Math.min(1, Math.max(0, value)));
    albedo = scale(albedo, 0.9 + streaks * 0.2);

    for (const storm of storms) {
      let dLongitude = longitude - storm.longitude;
      dLongitude -= Math.round(dLongitude / (Math.PI * 2)) * Math.PI * 2;
      const u = dLongitude * Math.cos(latitude) / storm.width;
      const v = (latitude - storm.latitude) / storm.height;
      const distance = u * u + v * v;
      if (distance >= 1.6) continue;
      const core = smoothstep(1, 0.2, distance);
      const collar = smoothstep(1.6, 1, distance) * (1 - core);
      albedo = mix(albedo, storm.color, core * 0.85);
      albedo = mix(albedo, light, collar * 0.35);
    }

    albedo = scale(albedo, 1 - smoothstep(0.75, 1, Math.abs(y)) * 0.25);
    return { albedo, height: 0.5, cloud: 0, ocean: 0 };
  });
}


function gridCell(point: Vec3, frequency: number, seed: number) {
  const ax = Math.abs(point[0]);
  const ay = Math.abs(point[1]);
  const az = Math.abs(point[2]);
  const normalAxis = ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
  let edge = 1;
  const cell = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const scaled = point[axis] * frequency + 64;
    cell[axis] = Math.floor(scaled);
    if (axis === normalAxis) continue;
    const fraction = scaled - cell[axis];
    edge = Math.min(edge, fraction, 1 - fraction);
  }
  return { edge, value: cellHash(cell[0], cell[1], cell[2], seed) };
}

const CITY_WATER: Rgb = [18, 26, 36];
const RUIN_WATER: Rgb = [16, 14, 11];
const LIVING_ARTERY: Rgb = [236, 214, 170];

export function paintEcumenopolis(color: number, seed: number, living: boolean): SurfaceJob {
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const districts = cityDistricts(seed);
  const tone = living ? 1 : 0.62;
  const concrete = scale(mix(toRgb(color), CITY_GREY, 0.45), tone);
  const roof = scale(mix(concrete, [226, 220, 208], 0.3), 1);
  const street = scale(concrete, 0.42);
  const blockSeed = Math.floor(rng() * 0x7fffffff);
  const arteries = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({ normal: randomUnitVector(rng), width: 0.006 + rng() * 0.008 }));
  const scars = living ? [] : scatterCraters(rng, 10 + Math.floor(rng() * 8), 0.05, 0.22);

  return paintSphere(PLANET_SURFACE_SIZE, rng, scale(concrete, 0.7), ([x, y, z], discX, discY) => {
    const point: Vec3 = [x, y, z];
    const density = Math.max(0, districtDensity(districts, discX, discY));
    const sea = smoothstep(0.34, 0.3, fbm(noise, x * 1.6 + 3, y * 1.6, z * 1.6 + 19, 4)) * (1 - density);
    const warped: Vec3 = [
      x + (fbm(noise, x * 3 + 13, y * 3, z * 3, 2) - 0.5) * 0.09,
      y + (fbm(noise, x * 3, y * 3 + 37, z * 3, 2) - 0.5) * 0.09,
      z + (fbm(noise, x * 3, y * 3, z * 3 + 59, 2) - 0.5) * 0.09,
    ];
    const superblock = gridCell(warped, 9, blockSeed);
    const block = gridCell(warped, 34, blockSeed ^ 0x5bd1e995);
    const avenue = smoothstep(0.035, 0.015, superblock.edge);
    const lane = smoothstep(0.1, 0.04, block.edge) * (0.55 + density * 0.45);

    const towers = block.value * (0.35 + density * 0.65);
    let albedo = mix(concrete, roof, block.value * 0.5 + density * 0.4);
    albedo = scale(albedo, 0.82 + superblock.value * 0.3);
    albedo = mix(albedo, street, Math.max(avenue, lane));
    let height = 0.45 + towers * 0.4 * (1 - Math.max(avenue, lane));

    for (const artery of arteries) {
      const offset = Math.abs(x * artery.normal[0] + y * artery.normal[1] + z * artery.normal[2]);
      const trench = smoothstep(artery.width * 1.6, artery.width * 0.6, offset);
      if (trench <= 0) continue;
      albedo = mix(albedo, living ? LIVING_ARTERY : SCORCH, trench * (living ? 0.55 : 0.7));
      height -= trench * 0.2;
    }

    if (scars.length > 0) {
      const { height: impact, floor } = craterHeight(point, scars);
      const burn = smoothstep(0.55, 0.75, fbm(noise, x * 2.8 + 47, y * 2.8, z * 2.8, 4));
      albedo = mix(albedo, SCORCH, Math.min(1, burn * 0.7 + floor * 0.9));
      height = height * (1 - floor) + impact;
    }

    const water = living ? CITY_WATER : RUIN_WATER;
    albedo = mix(albedo, water, sea);
    height = height * (1 - sea) + 0.4 * sea;
    const smoke = living ? 0 : smoothstep(0.62, 0.8, fbm(noise, x * 3.4 + 71, y * 3.4, z * 3.4, 4)) * 0.55;
    return {
      albedo,
      height: Math.min(1, Math.max(0, height)),
      cloud: smoke,
      ocean: Math.max(sea, living ? density * 0.25 * block.value : 0),
    };
  });
}

const DISK_PAINT_WORKERS = 4;

export type DiskSurfaceJob = SurfaceJob & {
  cities: DiskCity[];
  landAt: (angle: number, t: number) => boolean;
  cancel: () => void;
};

export function paintAldersonDisk(seed: number, innerRatio: number, living: boolean): DiskSurfaceJob {
  const field = createDiskField(seed, innerRatio, living);
  const albedo = document.createElement('canvas');
  const detail = document.createElement('canvas');
  albedo.width = detail.width = DISK_SURFACE_WIDTH;
  albedo.height = detail.height = DISK_SURFACE_HEIGHT;
  const albedoContext = albedo.getContext('2d')!;
  const detailContext = detail.getContext('2d')!;
  for (let py = 0; py < DISK_SURFACE_HEIGHT; py++) {
    albedoContext.fillStyle = rgbStyle(field.fallback((py + 0.5) / DISK_SURFACE_HEIGHT));
    albedoContext.fillRect(0, py, DISK_SURFACE_WIDTH, 1);
  }
  detailContext.fillStyle = 'rgb(128,0,0)';
  detailContext.fillRect(0, 0, DISK_SURFACE_WIDTH, DISK_SURFACE_HEIGHT);

  const bands = Math.max(1, Math.min(DISK_PAINT_WORKERS, navigator.hardwareConcurrency || 2));
  const workers = Array.from({ length: bands }, (_, band) => {
    const worker = new Worker(new URL('./aldersonSurface.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DiskPaintResult>) => {
      const { from, to, albedo: albedoRows, detail: detailRows } = event.data;
      albedoContext.putImageData(new ImageData(albedoRows, DISK_SURFACE_WIDTH, to - from), 0, from);
      detailContext.putImageData(new ImageData(detailRows, DISK_SURFACE_WIDTH, to - from), 0, from);
      worker.terminate();
      workers.splice(workers.indexOf(worker), 1);
    };
    const request: DiskPaintRequest = {
      seed,
      innerRatio,
      living,
      from: Math.floor(DISK_SURFACE_HEIGHT * band / bands),
      to: Math.floor(DISK_SURFACE_HEIGHT * (band + 1) / bands),
    };
    worker.postMessage(request);
    return worker;
  });

  return {
    surface: { albedo, detail },
    step: () => workers.length === 0,
    cities: field.cities,
    landAt: field.landAt,
    cancel() {
      for (const worker of workers) worker.terminate();
      workers.length = 0;
    },
  };
}
