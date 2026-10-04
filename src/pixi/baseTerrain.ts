import { blockerGrid, type BlockerKind, type SurfaceWorld } from '../game/baseSurface';
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
const TAIGA: Rgb = [40, 62, 42];
const SAVANNA: Rgb = [150, 136, 76];
const RIVER: Rgb = [36, 84, 120];
const LAKE: Rgb = [26, 70, 112];
const RIVER_MIN_FLOW = 5;
const LIGHT = normalize([-0.55, -0.65, 0.52]);
const RELIEF_PER_CELL_PX = 0.625;
const SHADOW_X = 0.125;
const SHADOW_Y = 0.156;
const BROAD = 16 / BASE_SURFACE_ROWS;
const BLOCKER_FALLOFF = 1.1;

export type TerrainRegion = { col: number; row: number; cols: number; rows: number };

export const WHOLE_MAP: TerrainRegion = { col: 0, row: 0, cols: BASE_SURFACE_COLS, rows: BASE_SURFACE_ROWS };

export type TerrainJob = {
  image: ImageData;
  step: (deadline: number) => boolean;
};

function cellField(values: Float32Array, gx: number, gy: number): number {
  const x = Math.min(BASE_SURFACE_COLS - 1, Math.max(0, gx - 0.5));
  const y = Math.min(BASE_SURFACE_ROWS - 1, Math.max(0, gy - 0.5));
  const ix = Math.min(BASE_SURFACE_COLS - 2, Math.floor(x));
  const iy = Math.min(BASE_SURFACE_ROWS - 2, Math.floor(y));
  const fx = x - ix;
  const fy = y - iy;
  const at = iy * BASE_SURFACE_COLS + ix;
  const top = values[at] + (values[at + 1] - values[at]) * fx;
  const bottom = values[at + BASE_SURFACE_COLS] + (values[at + BASE_SURFACE_COLS + 1] - values[at + BASE_SURFACE_COLS]) * fx;
  return top + (bottom - top) * fy;
}

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const length = Math.sqrt(x * x + y * y + z * z);
  return [x / length, y / length, z / length];
}

type Fields = Record<BlockerKind, number>;

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const ex = px - ax - dx * t;
  const ey = py - ay - dy * t;
  return Math.sqrt(ex * ex + ey * ey);
}

export function paintBaseTerrain(seed: number, world: SurfaceWorld, region: TerrainRegion, cellPx: number): TerrainJob {
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
  const grid = blockerGrid(world.blockers);
  const { elevation, moisture, flow, downstream } = world;
  const tint: Rgb = [90 + rng() * 60, 110 + rng() * 40, 70 + rng() * 40];
  const dryness = (rng() - 0.5) * 0.12;
  const heights = new Float32Array(mapWidth * mapHeight);
  const albedos = new Float32Array(mapWidth * mapHeight * 3);
  const water = new Uint8Array(mapWidth * mapHeight);
  const clouds = new Float32Array(mapWidth * mapHeight);
  const image = new ImageData(outWidth, outHeight);
  const fields: Fields = { ocean: 0, ridge: 0, lake: 0 };
  const relief = RELIEF_PER_CELL_PX * cellPx;
  let row = 0;

  function blockerFields(gx: number, gy: number, wx: number, wy: number) {
    fields.ridge = fields.lake = fields.ocean = 0;
    const c0 = Math.max(0, Math.ceil(Math.min(gx, wx) - 0.5 - BLOCKER_FALLOFF));
    const c1 = Math.min(BASE_SURFACE_COLS - 1, Math.floor(Math.max(gx, wx) - 0.5 + BLOCKER_FALLOFF));
    const r0 = Math.max(0, Math.ceil(Math.min(gy, wy) - 0.5 - BLOCKER_FALLOFF));
    const r1 = Math.min(BASE_SURFACE_ROWS - 1, Math.floor(Math.max(gy, wy) - 0.5 + BLOCKER_FALLOFF));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const kind = grid[r * BASE_SURFACE_COLS + c];
        if (kind === null) continue;
        const reach = kind === 'ocean' ? 0.55 : 1;
        const dx = gx + (wx - gx) * reach - c - 0.5;
        const dy = gy + (wy - gy) * reach - r - 0.5;
        const value = 1 - smoothstep(0.15, BLOCKER_FALLOFF, Math.sqrt(dx * dx + dy * dy));
        fields[kind] = 1 - (1 - fields[kind]) * (1 - value);
      }
    }
  }

  function riverAt(wx: number, wy: number): number {
    const col = Math.floor(wx);
    const cellRow = Math.floor(wy);
    let river = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const r = cellRow + dr;
      if (r < 0 || r >= BASE_SURFACE_ROWS) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        if (c < 0 || c >= BASE_SURFACE_COLS) continue;
        const from = r * BASE_SURFACE_COLS + c;
        const to = downstream[from];
        if (to < 0 || flow[from] < RIVER_MIN_FLOW || grid[from] === 'ocean') continue;
        const toCol = to % BASE_SURFACE_COLS;
        const width = 0.035 + Math.min(0.11, Math.sqrt(flow[from] - RIVER_MIN_FLOW) * 0.012);
        const distance = segmentDistance(wx, wy, c + 0.5, r + 0.5, toCol + 0.5, (to - toCol) / BASE_SURFACE_COLS + 0.5);
        river = Math.max(river, 1 - smoothstep(width * 0.6, width, distance));
      }
    }
    return river;
  }

  function sample(px: number, py: number) {
    const index = py * mapWidth + px;
    const gx = (originX + px + 0.5) / cellPx;
    const gy = (originY + py + 0.5) / cellPx;
    const wx = gx + (fbm(noise, gx * 0.8, gy * 0.8, 13, 3) - 0.5) * 0.8 + (fbm(noise, gx * 3.6, gy * 3.6, 23, 4) - 0.5) * 0.4;
    const wy = gy + (fbm(noise, gx * 0.8, gy * 0.8, 47, 3) - 0.5) * 0.8 + (fbm(noise, gx * 3.6, gy * 3.6, 53, 4) - 0.5) * 0.4;
    blockerFields(gx, gy, wx, wy);
    const latitude = Math.abs(gy / BASE_SURFACE_ROWS - 0.5) * 2;
    const warpX = gx + (fbm(noise, gx * 0.4, gy * 0.4, 5, 4) - 0.5) * 2.4;
    const warpY = gy + (fbm(noise, gx * 0.4, gy * 0.4, 17, 4) - 0.5) * 2.4;
    const broadX = gx * BROAD + (fbm(noise, gx * 0.4 * BROAD, gy * 0.4 * BROAD, 71, 4) - 0.5) * 2.4;
    const broadY = gy * BROAD + (fbm(noise, gx * 0.4 * BROAD, gy * 0.4 * BROAD, 79, 4) - 0.5) * 2.4;
    const hills = fbm(noise, warpX * 1.3, warpY * 1.3, 29, 7);
    const detail = fbm(noise, gx * 5, gy * 5, 61, 3);
    const wrinkles = 1 - Math.abs(fbm(noise, warpX * 1.7, warpY * 1.7, 37, 5) * 2 - 1);
    const ridged = 1 - Math.abs(fbm(noise, gx * 2.4, gy * 2.4, 89, 6) * 2 - 1);
    const ground = cellField(elevation, (gx + wx) * 0.5, (gy + wy) * 0.5);
    const upland = smoothstep(0.15, 0.75, ground);
    const river = riverAt(wx, wy);

    const coast = fields.ocean + (detail - 0.5) * 0.12 + (fbm(noise, gx * 7, gy * 7, 167, 3) - 0.5) * 0.12;
    const seaEdge = Math.max(fields.lake + (detail - 0.5) * 0.12, coast);
    const range = Math.max(smoothstep(0.1, 0.7, fields.ridge), smoothstep(0.55, 0.95, ground) * 0.6);
    const plains = 1 - range;
    const rugged = 0.35 + upland * 0.65;
    const elevationTerm = Math.max(0, ground) * 0.22
      + hills * 0.16 * plains * rugged
      + wrinkles * wrinkles * wrinkles * 0.05 * plains * rugged
      + range * (0.1 + Math.pow(ridged, 3) * 0.3);
    let height = 0.3 + elevationTerm - river * 0.025;
    height -= Math.max(fields.lake, fields.ocean) * 0.16;
    heights[index] = height;

    const wet = cellField(moisture, wx, wy) + (fbm(noise, broadX * 0.9, broadY * 0.9, 83, 4) - 0.5) * 0.16 + dryness + river * 0.2;
    const temperature = 1 - latitude * 1.05 - Math.max(0, ground) * 0.4 + (fbm(noise, broadX * 0.6, broadY * 0.6, 97, 3) - 0.5) * 0.2;
    const hot = smoothstep(0.55, 0.75, temperature);
    let land = mix(DESERT, mix(STEPPE, SAVANNA, hot), smoothstep(0.1, 0.22, wet));
    land = mix(land, FOREST, smoothstep(0.28, 0.44, wet));
    land = mix(land, JUNGLE, hot * smoothstep(0.45, 0.6, wet));
    land = mix(land, TAIGA, smoothstep(0.42, 0.3, temperature) * smoothstep(0.2, 0.34, wet));
    land = mix(land, TUNDRA, smoothstep(0.26, 0.14, temperature));
    land = mix(land, tint, 0.1);
    land = scale(land, 0.84 + fbm(noise, gx * 9, gy * 9, 3, 3) * 0.3);
    land = mix(land, SAND, smoothstep(0.3, 0.42, seaEdge) * (1 - smoothstep(0.42, 0.46, seaEdge)) * 0.7 * (1 - fields.lake));
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
    const isRiver = !isWater && river > 0.5 && snow < 0.5;
    water[index] = isWater && packIce < 0.5 ? 1 : isRiver ? 2 : 0;
    const depth = Math.max(0, -ground);
    const shelf = smoothstep(0.02, 0.3, depth + (fields.ocean - 0.5) * 0.1);
    const abyss = smoothstep(0.5, 1, depth) * (0.7 + fbm(noise, broadX * 0.8, broadY * 0.8, 173, 4) * 0.6);
    const sea = fields.lake > fields.ocean
      ? mix(SHALLOW_OCEAN, LAKE, smoothstep(0.5, 0.9, fields.lake))
      : mix(mix(SHALLOW_OCEAN, DEEP_OCEAN, shelf), scale(DEEP_OCEAN, 0.7), Math.min(1, abyss));
    const albedo = isWater ? mix(sea, scale(ICE, 0.94), packIce) : isRiver ? RIVER : land;
    albedos[index * 3] = albedo[0];
    albedos[index * 3 + 1] = albedo[1];
    albedos[index * 3 + 2] = albedo[2];
    const swirl = (fbm(noise, broadX * 0.5, broadY * 0.5, 151, 3) - 0.5) * 3;
    const weather = fbm(noise, broadX * 0.6 + swirl, broadY * 1.6 + swirl * 0.4, 7, 6) + 0.07 * Math.cos(latitude * Math.PI * 3.2) + (cellField(moisture, gx, gy) - 0.5) * 0.12;
    clouds[index] = smoothstep(0.6, 0.8, weather);
  }

  function heightAt(px: number, py: number) {
    const x = Math.min(mapWidth - 1, Math.max(0, px));
    const y = Math.min(mapHeight - 1, Math.max(0, py));
    return water[y * mapWidth + x] === 1 ? 0.3 : heights[y * mapWidth + x];
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
    light *= 1 - clouds[(py - shadowY) * mapWidth + px - shadowX] * 0.35;
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
