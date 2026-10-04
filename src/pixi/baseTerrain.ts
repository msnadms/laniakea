import { blockerGrid, type BlockerKind, type SurfaceBlocker } from '../game/baseSurface';
import { BASE_SURFACE_COLS, BASE_SURFACE_ROWS } from '../game/constants';
import { createRng } from '../game/galaxyGen';
import {
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
  SHALLOW_OCEAN,
  smoothstep,
  STEPPE,
  TUNDRA,
  type Rgb,
} from './surfaceNoise';


const SAND: Rgb = [184, 164, 116];
const LIGHT = normalize([-0.55, -0.65, 0.52]);
const RELIEF_PER_CELL_PX = 0.625;
const SHADOW_X = 0.125;
const SHADOW_Y = 0.156;
const BROAD = 16 / BASE_SURFACE_ROWS;

export type TerrainRegion = { col: number; row: number; cols: number; rows: number };

export const WHOLE_MAP: TerrainRegion = { col: 0, row: 0, cols: BASE_SURFACE_COLS, rows: BASE_SURFACE_ROWS };

export type TerrainJob = {
  image: ImageData;
  step: (deadline: number) => boolean;
};

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const length = Math.sqrt(x * x + y * y + z * z);
  return [x / length, y / length, z / length];
}

type Fields = Record<BlockerKind, number>;

export function paintBaseTerrain(seed: number, blockers: readonly SurfaceBlocker[], region: TerrainRegion, cellPx: number): TerrainJob {
  const outWidth = region.cols * cellPx;
  const outHeight = region.rows * cellPx;
  const shadowX = Math.round(cellPx * SHADOW_X);
  const shadowY = Math.round(cellPx * SHADOW_Y);
  const margin = Math.max(shadowX, shadowY) + 1;
  const mapWidth = outWidth + margin * 2;
  const mapHeight = outHeight + margin * 2;
  const originX = region.col * cellPx - margin;
  const originY = region.row * cellPx - margin;
  const rng = createRng(seed);
  const noise = createNoise3(rng);
  const grid = blockerGrid(blockers);
  const tint: Rgb = [90 + rng() * 60, 110 + rng() * 40, 70 + rng() * 40];
  const dryness = (rng() - 0.5) * 0.16;
  const heights = new Float32Array(mapWidth * mapHeight);
  const albedos = new Float32Array(mapWidth * mapHeight * 3);
  const water = new Uint8Array(mapWidth * mapHeight);
  const clouds = new Float32Array(mapWidth * mapHeight);
  const image = new ImageData(outWidth, outHeight);
  const fields: Fields = { ocean: 0, ridge: 0, lake: 0 };
  const relief = RELIEF_PER_CELL_PX * cellPx;
  let row = 0;

  function blockerFields(gx: number, gy: number) {
    fields.ridge = fields.lake = fields.ocean = 0;
    const wx = gx + (fbm(noise, gx * 0.8, gy * 0.8, 13, 3) - 0.5) * 0.8 + (fbm(noise, gx * 3.6, gy * 3.6, 23, 4) - 0.5) * 0.4;
    const wy = gy + (fbm(noise, gx * 0.8, gy * 0.8, 47, 3) - 0.5) * 0.8 + (fbm(noise, gx * 3.6, gy * 3.6, 53, 4) - 0.5) * 0.4;
    const col = Math.floor(gx);
    const cellRow = Math.floor(gy);
    for (let dr = -1; dr <= 1; dr++) {
      const r = cellRow + dr;
      if (r < 0 || r >= BASE_SURFACE_ROWS) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        if (c < 0 || c >= BASE_SURFACE_COLS) continue;
        const kind = grid[r * BASE_SURFACE_COLS + c];
        if (kind === null) continue;
        const reach = kind === 'ocean' ? 0.55 : 1;
        const dx = gx + (wx - gx) * reach - c - 0.5;
        const dy = gy + (wy - gy) * reach - r - 0.5;
        const value = 1 - smoothstep(0.15, 1.1, Math.sqrt(dx * dx + dy * dy));
        fields[kind] = 1 - (1 - fields[kind]) * (1 - value);
      }
    }
  }

  function sample(px: number, py: number) {
    const index = py * mapWidth + px;
    const gx = (originX + px + 0.5) / cellPx;
    const gy = (originY + py + 0.5) / cellPx;
    blockerFields(gx, gy);
    const latitude = Math.abs(gy / BASE_SURFACE_ROWS - 0.5) * 2;
    const warpX = gx + (fbm(noise, gx * 0.4, gy * 0.4, 5, 4) - 0.5) * 2.4;
    const warpY = gy + (fbm(noise, gx * 0.4, gy * 0.4, 17, 4) - 0.5) * 2.4;
    const broadX = gx * BROAD + (fbm(noise, gx * 0.4 * BROAD, gy * 0.4 * BROAD, 71, 4) - 0.5) * 2.4;
    const broadY = gy * BROAD + (fbm(noise, gx * 0.4 * BROAD, gy * 0.4 * BROAD, 79, 4) - 0.5) * 2.4;
    const hills = fbm(noise, warpX * 1.3, warpY * 1.3, 29, 7);
    const detail = fbm(noise, gx * 5, gy * 5, 61, 3);
    const wrinkles = 1 - Math.abs(fbm(noise, warpX * 1.7, warpY * 1.7, 37, 5) * 2 - 1);
    const ridged = 1 - Math.abs(fbm(noise, gx * 2.4, gy * 2.4, 89, 6) * 2 - 1);

    const coast = fields.ocean + (detail - 0.5) * 0.12 + (fbm(noise, gx * 7, gy * 7, 167, 3) - 0.5) * 0.12;
    const seaEdge = Math.max(fields.lake + (detail - 0.5) * 0.12, coast);
    const range = smoothstep(0.1, 0.7, fields.ridge);
    const plains = 1 - range;
    const elevation = hills * 0.18 * plains + wrinkles * wrinkles * wrinkles * 0.05 * plains + range * (0.1 + Math.pow(ridged, 3) * 0.3);
    let height = 0.3 + elevation;
    height -= Math.max(fields.lake, fields.ocean) * 0.16;
    heights[index] = height;

    const moisture = fbm(noise, broadX * 0.35, broadY * 0.35, 83, 5) + dryness - Math.max(0, 1 - Math.abs(latitude - 0.4) / 0.18) * 0.12;
    const temperature = 1 - latitude * 1.05 - range * 0.35 + (fbm(noise, broadX * 0.6, broadY * 0.6, 97, 3) - 0.5) * 0.25;
    let land = mix(DESERT, STEPPE, smoothstep(0.34, 0.46, moisture));
    land = mix(land, FOREST, smoothstep(0.47, 0.58, moisture));
    land = mix(land, JUNGLE, smoothstep(0.62, 0.85, temperature) * smoothstep(0.5, 0.62, moisture));
    land = mix(land, TUNDRA, smoothstep(0.3, 0.16, temperature));
    land = mix(land, tint, 0.1);
    land = scale(land, 0.84 + fbm(noise, gx * 9, gy * 9, 3, 3) * 0.3);
    land = mix(land, SAND, smoothstep(0.3, 0.42, seaEdge) * (1 - smoothstep(0.42, 0.46, seaEdge)) * 0.7);
    land = mix(land, scale(ROCK, 0.8 + ridged * 0.3), smoothstep(0.15, 0.5, range));
    if (land[1] < land[2] + 4) land[1] = land[2] + 4;
    const polar = latitude + (fbm(noise, broadX * 1.5, broadY * 1.5, 41, 4) - 0.5) * 0.12;
    const packIce = smoothstep(0.82, 0.9, polar + (fbm(noise, gx * 6, gy * 6, 179, 3) - 0.5) * 0.08);
    const snow = Math.max(
      smoothstep(0.84, 0.9, polar),
      smoothstep(0.85, 0.95, range * Math.pow(ridged, 3) + (0.45 - temperature) * 0.5),
    );
    land = mix(land, ICE, snow * 0.92);

    const isWater = seaEdge > 0.45;
    water[index] = isWater && packIce < 0.5 ? 1 : 0;
    const shelf = smoothstep(0.46, 0.62, seaEdge);
    const abyss = smoothstep(0.75, 1, fields.ocean) * (0.7 + fbm(noise, broadX * 0.8, broadY * 0.8, 173, 4) * 0.6);
    const sea = mix(mix(SHALLOW_OCEAN, DEEP_OCEAN, shelf), scale(DEEP_OCEAN, 0.7), Math.min(1, abyss));
    const albedo = isWater ? mix(sea, scale(ICE, 0.94), packIce) : land;
    albedos[index * 3] = albedo[0];
    albedos[index * 3 + 1] = albedo[1];
    albedos[index * 3 + 2] = albedo[2];
    const swirl = (fbm(noise, broadX * 0.5, broadY * 0.5, 151, 3) - 0.5) * 3;
    const weather = fbm(noise, broadX * 0.6 + swirl, broadY * 1.6 + swirl * 0.4, 7, 6) + 0.07 * Math.cos(latitude * Math.PI * 3.2);
    clouds[index] = smoothstep(0.6, 0.8, weather);
  }

  function heightAt(px: number, py: number) {
    const x = Math.min(mapWidth - 1, Math.max(0, px));
    const y = Math.min(mapHeight - 1, Math.max(0, py));
    return water[y * mapWidth + x] ? 0.3 : heights[y * mapWidth + x];
  }

  function shade(px: number, py: number) {
    const index = py * mapWidth + px;
    const dx = (heightAt(px + 1, py) - heightAt(px - 1, py)) * relief;
    const dy = (heightAt(px, py + 1) - heightAt(px, py - 1)) * relief;
    const [nx, ny, nz] = normalize([-dx, -dy, 1]);
    const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    let light = 0.32 + lambert * 0.82;
    if (water[index]) {
      const glint = Math.pow(Math.max(0, 1 - Math.abs(fbm(noise, ((originX + px) / cellPx) * 1.9, ((originY + py) / cellPx) * 1.9, 113, 2) - 0.5) * 6), 6);
      light = 0.85 + glint * 0.35;
    }
    light *= 1 - clouds[(py + shadowY) * mapWidth + px + shadowX] * 0.35;
    const cloud = clouds[index] * 0.5;
    const grain = 0.96 + ((((originX + px) * 73856093) ^ ((originY + py) * 19349663) ^ seed) & 255) / 255 * 0.08;
    const out = ((py - margin) * outWidth + px - margin) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const lit = albedos[index * 3 + channel] * light * grain;
      image.data[out + channel] = Math.min(255, lit + (232 - lit) * cloud);
    }
    image.data[out + 3] = 255;
  }

  return {
    image,
    step(deadline) {
      const rows = mapHeight + outHeight;
      while (row < rows) {
        if (row < mapHeight) {
          for (let px = 0; px < mapWidth; px++) sample(px, row);
        } else {
          for (let px = margin; px < margin + outWidth; px++) shade(px, row - mapHeight + margin);
        }
        row++;
        if (row % 4 === 0 && performance.now() >= deadline) break;
      }
      return row >= rows;
    },
  };
}
