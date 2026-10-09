import { blockerGrid, depositGrid, type BlockerKind, type SurfaceWorld } from '../game/baseSurface';
import { BASE_SURFACE_COLS, BASE_SURFACE_ROWS } from '../game/constants';
import { createRng } from '../game/galaxyGen';
import { gradeRichness, RESOURCE_KINDS, type ResourceKind } from '../game/resources';
import {
  bandLimitedFbm,
  createNoise3,
  DEEP_OCEAN,
  DESERT,
  fbm,
  FOREST,
  ICE,
  JUNGLE,
  mix,
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
const DARK_ROCK: Rgb = [62, 63, 68];
const PALE_ROCK: Rgb = [132, 132, 136];
const SNOW: Rgb = [240, 244, 250];
const RIVER_MIN_FLOW = 5;
const LIGHT = normalize([-0.55, -0.65, 0.52]);
const RELIEF_PER_CELL_PX = 0.625;
const SHADOW_X = 0.125;
const SHADOW_Y = 0.156;
const BROAD = 16 / BASE_SURFACE_ROWS;
const BLOCKER_RADIUS = 1.5;
const BLOCKER_FULL = 1.6;
const RIVER_CURVE_STEPS = 6;
const NOISE_BAND = 0.25;
const RIVER_MIN_PX = 1.4;
const ORE_RADIUS = 1.25;
const ORE_GRAIN = 4;
const ORE_LOOKS: Record<ResourceKind, { stain: Rgb; ore: Rgb; glint: Rgb; relief: number }> = {
  iron: { stain: [118, 80, 62], ore: [74, 88, 110], glint: [168, 184, 206], relief: 0.035 },
  copper: { stain: [84, 120, 98], ore: [184, 100, 50], glint: [238, 166, 104], relief: 0.035 },
  oil: { stain: [44, 38, 34], ore: [14, 12, 16], glint: [78, 80, 96], relief: -0.012 },
  silica: { stain: [198, 190, 164], ore: [232, 216, 192], glint: [255, 250, 240], relief: 0.025 },
};

export type TerrainRegion = { col: number; row: number; cols: number; rows: number };

export const WHOLE_MAP: TerrainRegion = { col: 0, row: 0, cols: BASE_SURFACE_COLS, rows: BASE_SURFACE_ROWS };

export type TerrainJob = {
  image: ImageData;
  step: (deadline: number) => boolean;
};

const weightsX = new Float64Array(4);
const weightsY = new Float64Array(4);

function bspline(t: number, weights: Float64Array) {
  const u = 1 - t;
  weights[0] = (u * u * u) / 6;
  weights[1] = (3 * t * t * t - 6 * t * t + 4) / 6;
  weights[2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
  weights[3] = (t * t * t) / 6;
}

function cellField(values: Float32Array, gx: number, gy: number): number {
  const x = Math.min(BASE_SURFACE_COLS - 1, Math.max(0, gx - 0.5));
  const y = Math.min(BASE_SURFACE_ROWS - 1, Math.max(0, gy - 0.5));
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  bspline(x - ix, weightsX);
  bspline(y - iy, weightsY);
  let total = 0;
  for (let j = 0; j < 4; j++) {
    const r = Math.min(BASE_SURFACE_ROWS - 1, Math.max(0, iy + j - 1)) * BASE_SURFACE_COLS;
    let line = 0;
    for (let i = 0; i < 4; i++) line += values[r + Math.min(BASE_SURFACE_COLS - 1, Math.max(0, ix + i - 1))] * weightsX[i];
    total += line * weightsY[j];
  }
  return total;
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
  const deposits = world.deposits;
  const depositCells = depositGrid(deposits);
  const oreWeights = new Float64Array(deposits.length);
  const relief = RELIEF_PER_CELL_PX * cellPx;
  const fed = new Uint8Array(BASE_SURFACE_COLS * BASE_SURFACE_ROWS);
  for (let index = 0; index < fed.length; index++) {
    if (isRiverCell(index)) fed[downstream[index]] = 1;
  }
  let row = 0;

  function isRiverCell(index: number) {
    return downstream[index] >= 0 && flow[index] >= RIVER_MIN_FLOW && grid[index] !== 'ocean';
  }

  function fine(x: number, y: number, z: number, octaves: number, perCell: number) {
    return bandLimitedFbm(noise, x, y, z, octaves, (cellPx * NOISE_BAND) / perCell);
  }

  function riverWidth(index: number) {
    return Math.max(RIVER_MIN_PX / cellPx, 0.035 + Math.min(0.11, Math.sqrt(Math.max(0, flow[index] - RIVER_MIN_FLOW)) * 0.012));
  }

  function blockerFields(gx: number, gy: number, wx: number, wy: number) {
    fields.ridge = fields.lake = fields.ocean = 0;
    const c0 = Math.max(0, Math.ceil(Math.min(gx, wx) - 0.5 - BLOCKER_RADIUS));
    const c1 = Math.min(BASE_SURFACE_COLS - 1, Math.floor(Math.max(gx, wx) - 0.5 + BLOCKER_RADIUS));
    const r0 = Math.max(0, Math.ceil(Math.min(gy, wy) - 0.5 - BLOCKER_RADIUS));
    const r1 = Math.min(BASE_SURFACE_ROWS - 1, Math.floor(Math.max(gy, wy) - 0.5 + BLOCKER_RADIUS));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const kind = grid[r * BASE_SURFACE_COLS + c];
        if (kind === null) continue;
        const reach = kind === 'ocean' ? 0.55 : 1;
        const dx = gx + (wx - gx) * reach - c - 0.5;
        const dy = gy + (wy - gy) * reach - r - 0.5;
        const falloff = 1 - (dx * dx + dy * dy) / (BLOCKER_RADIUS * BLOCKER_RADIUS);
        if (falloff > 0) fields[kind] += falloff * falloff;
      }
    }
    fields.ridge = Math.min(1, fields.ridge / BLOCKER_FULL);
    fields.lake = Math.min(1, fields.lake / BLOCKER_FULL);
    fields.ocean = Math.min(1, fields.ocean / BLOCKER_FULL);
  }

  function depositAt(wx: number, wy: number): { id: number; field: number } {
    const c0 = Math.max(0, Math.ceil(wx - 0.5 - ORE_RADIUS));
    const c1 = Math.min(BASE_SURFACE_COLS - 1, Math.floor(wx - 0.5 + ORE_RADIUS));
    const r0 = Math.max(0, Math.ceil(wy - 0.5 - ORE_RADIUS));
    const r1 = Math.min(BASE_SURFACE_ROWS - 1, Math.floor(wy - 0.5 + ORE_RADIUS));
    let id = -1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const owner = depositCells[r * BASE_SURFACE_COLS + c];
        if (owner < 0) continue;
        const dx = wx - c - 0.5;
        const dy = wy - r - 0.5;
        const falloff = 1 - (dx * dx + dy * dy) / (ORE_RADIUS * ORE_RADIUS);
        if (falloff <= 0) continue;
        oreWeights[owner] += falloff * falloff;
        if (id < 0 || oreWeights[owner] > oreWeights[id]) id = owner;
      }
    }
    if (id < 0) return { id, field: 0 };
    const field = smoothstep(0.25, 0.8, oreWeights[id]);
    oreWeights.fill(0);
    return { id, field };
  }

  function stroke(wx: number, wy: number, ax: number, ay: number, bx: number, by: number, width: number) {
    return 1 - smoothstep(width * 0.6, width, segmentDistance(wx, wy, ax, ay, bx, by));
  }

  function riverAt(wx: number, wy: number): number {
    const col = Math.floor(wx);
    const cellRow = Math.floor(wy);
    let river = 0;
    for (let dr = -2; dr <= 2; dr++) {
      const r = cellRow + dr;
      if (r < 0 || r >= BASE_SURFACE_ROWS) continue;
      for (let dc = -2; dc <= 2; dc++) {
        const c = col + dc;
        if (c < 0 || c >= BASE_SURFACE_COLS) continue;
        const from = r * BASE_SURFACE_COLS + c;
        if (!isRiverCell(from)) continue;
        const to = downstream[from];
        const tx = (to % BASE_SURFACE_COLS) + 0.5;
        const ty = Math.floor(to / BASE_SURFACE_COLS) + 0.5;
        const fx = c + 0.5;
        const fy = r + 0.5;
        const mx = (fx + tx) * 0.5;
        const my = (fy + ty) * 0.5;
        const width = riverWidth(from);
        if (!fed[from] && Math.abs(wx - fx) < 1.2 && Math.abs(wy - fy) < 1.2) {
          river = Math.max(river, stroke(wx, wy, fx, fy, mx, my, width));
        }
        if (Math.abs(wx - tx) > 1.2 || Math.abs(wy - ty) > 1.2) continue;
        if (!isRiverCell(to)) {
          river = Math.max(river, stroke(wx, wy, mx, my, tx, ty, width));
          continue;
        }
        const next = downstream[to];
        const ex = ((next % BASE_SURFACE_COLS) + 0.5 + tx) * 0.5;
        const ey = (Math.floor(next / BASE_SURFACE_COLS) + 0.5 + ty) * 0.5;
        const toWidth = riverWidth(to);
        let px = mx;
        let py = my;
        for (let step = 1; step <= RIVER_CURVE_STEPS; step++) {
          const t = step / RIVER_CURVE_STEPS;
          const u = 1 - t;
          const qx = u * u * mx + 2 * u * t * tx + t * t * ex;
          const qy = u * u * my + 2 * u * t * ty + t * t * ey;
          const along = (step - 0.5) / RIVER_CURVE_STEPS;
          river = Math.max(river, stroke(wx, wy, px, py, qx, qy, width + (toWidth - width) * along));
          px = qx;
          py = qy;
        }
      }
    }
    return river;
  }

  function sample(px: number, py: number) {
    const index = py * mapWidth + px;
    const gx = (originX + px + 0.5) / cellPx;
    const gy = (originY + py + 0.5) / cellPx;
    const wx = gx + (fine(gx * 0.8, gy * 0.8, 13, 3, 0.8) - 0.5) * 0.8 + (fine(gx * 3.6, gy * 3.6, 23, 4, 3.6) - 0.5) * 0.4;
    const wy = gy + (fine(gx * 0.8, gy * 0.8, 47, 3, 0.8) - 0.5) * 0.8 + (fine(gx * 3.6, gy * 3.6, 53, 4, 3.6) - 0.5) * 0.4;
    blockerFields(gx, gy, wx, wy);
    const latitude = Math.abs(gy / BASE_SURFACE_ROWS - 0.5) * 2;
    const warpX = gx + (fine(gx * 0.4, gy * 0.4, 5, 4, 0.4) - 0.5) * 2.4;
    const warpY = gy + (fine(gx * 0.4, gy * 0.4, 17, 4, 0.4) - 0.5) * 2.4;
    const broadX = gx * BROAD + (fine(gx * 0.4 * BROAD, gy * 0.4 * BROAD, 71, 4, 0.4 * BROAD) - 0.5) * 2.4;
    const broadY = gy * BROAD + (fine(gx * 0.4 * BROAD, gy * 0.4 * BROAD, 79, 4, 0.4 * BROAD) - 0.5) * 2.4;
    const hills = fine(warpX * 1.3, warpY * 1.3, 29, 7, 1.3);
    const detail = fine(gx * 5, gy * 5, 61, 3, 5);
    const wrinkles = 1 - Math.abs(fine(warpX * 1.7, warpY * 1.7, 37, 5, 1.7) * 2 - 1);
    const ridged = 1 - Math.abs(fine(gx * 2.4, gy * 2.4, 89, 6, 2.4) * 2 - 1);
    const massif = 1 - Math.abs(fine(warpX * 0.7, warpY * 0.7, 191, 5, 0.7) * 2 - 1);
    const ground = cellField(elevation, (gx + wx) * 0.5, (gy + wy) * 0.5);
    const upland = smoothstep(0.15, 0.75, ground);
    const river = riverAt(wx, wy);

    const coast = fields.ocean + (detail - 0.5) * 0.12 + (fine(gx * 7, gy * 7, 167, 3, 7) - 0.5) * 0.12;
    const seaEdge = Math.max(fields.lake + (detail - 0.5) * 0.12, coast);
    const range = Math.max(smoothstep(0.1, 0.7, fields.ridge), smoothstep(0.55, 0.95, ground) * 0.6);
    const core = smoothstep(0.55, 0.95, fields.ridge);
    const peak = range * (0.3 + core * 0.15 + massif * massif * 0.4 + ridged * ridged * 0.15);
    const plains = 1 - range;
    const rugged = 0.35 + upland * 0.65;
    const elevationTerm = Math.max(0, ground) * 0.22
      + hills * 0.16 * plains * rugged
      + wrinkles * wrinkles * wrinkles * 0.05 * plains * rugged
      + range * (0.06 + core * 0.1 + massif * massif * 0.2 + Math.pow(ridged, 3) * 0.16);
    let height = 0.3 + elevationTerm - river * 0.025;
    height -= Math.max(fields.lake, fields.ocean) * 0.16;
    heights[index] = height;

    const wet = cellField(moisture, wx, wy) + (fine(broadX * 0.9, broadY * 0.9, 83, 4, 0.9 * BROAD) - 0.5) * 0.16 + dryness + river * 0.2;
    const temperature = 1 - latitude * 1.05 - Math.max(0, ground) * 0.4 + (fine(broadX * 0.6, broadY * 0.6, 97, 3, 0.6 * BROAD) - 0.5) * 0.2;
    const hot = smoothstep(0.55, 0.75, temperature);
    let land = mix(DESERT, mix(STEPPE, SAVANNA, hot), smoothstep(0.1, 0.22, wet));
    land = mix(land, FOREST, smoothstep(0.28, 0.44, wet));
    land = mix(land, JUNGLE, hot * smoothstep(0.45, 0.6, wet));
    land = mix(land, TAIGA, smoothstep(0.42, 0.3, temperature) * smoothstep(0.2, 0.34, wet));
    land = mix(land, TUNDRA, smoothstep(0.26, 0.14, temperature));
    land = mix(land, tint, 0.1);
    land = scale(land, 0.84 + fine(gx * 9, gy * 9, 3, 3, 9) * 0.3);
    land = mix(land, SAND, smoothstep(0.3, 0.42, seaEdge) * (1 - smoothstep(0.42, 0.46, seaEdge)) * 0.7 * (1 - fields.lake));
    if (land[1] < land[2] + 4) land[1] = land[2] + 4;
    const rock = mix(DARK_ROCK, PALE_ROCK, smoothstep(0.25, 0.85, ridged * 0.6 + massif * 0.4 + (detail - 0.5) * 0.3));
    land = mix(land, mix(land, rock, 0.55), smoothstep(0.08, 0.25, range));
    land = mix(land, rock, smoothstep(0.2, 0.5, range));
    const polar = latitude + (fine(broadX * 1.5, broadY * 1.5, 41, 4, 1.5 * BROAD) - 0.5) * 0.12;
    const packIce = smoothstep(0.82, 0.9, polar + (fine(gx * 6, gy * 6, 179, 3, 6) - 0.5) * 0.08);
    const snowline = Math.min(0.94, Math.max(0.6, 0.78 + (temperature - 0.3) * 0.35));
    const drift = (fine(gx * 3, gy * 3, 199, 4, 3) - 0.5) * 0.1 + ridged * ridged * 0.06;
    const polarSnow = smoothstep(0.84, 0.9, polar);
    const snow = Math.max(polarSnow, smoothstep(snowline, snowline + 0.06, peak + drift) * smoothstep(0.2, 0.4, range));
    land = mix(land, mix(SNOW, ICE, polarSnow), snow * 0.95);

    const ore = depositAt(wx, wy);
    if (ore.field > 0) {
      const deposit = deposits[ore.id];
      const look = ORE_LOOKS[deposit.resource];
      const rich = gradeRichness(deposit.grade);
      const grain = ORE_GRAIN * (deposit.resource === 'oil' ? 0.5 : 1);
      const resolved = Math.min(1, Math.max(0, 2 - grain / (cellPx * NOISE_BAND)));
      const speck = fine(gx * grain, gy * grain, 211 + RESOURCE_KINDS.indexOf(deposit.resource) * 7, 3, grain);
      const threshold = 0.66 - rich * 0.12 - ore.field * 0.08;
      const sharp = smoothstep(threshold, threshold + 0.05, speck);
      const nugget = (sharp * resolved + (0.2 + rich * 0.3) * (1 - resolved)) * ore.field;
      const shine = smoothstep(threshold + 0.06, threshold + 0.18, speck) * resolved;
      land = mix(land, look.stain, ore.field * (0.35 + rich * 0.25));
      land = mix(land, mix(look.ore, look.glint, shine * 0.6), nugget);
      height += nugget * look.relief;
      heights[index] = height;
    }

    const isWater = seaEdge > 0.45;
    const isRiver = !isWater && river > 0.5 && snow < 0.5;
    water[index] = isWater && packIce < 0.5 ? 1 : isRiver ? 2 : 0;
    const depth = Math.max(0, -ground);
    const shelf = smoothstep(0.02, 0.3, depth + (fields.ocean - 0.5) * 0.1);
    const abyss = smoothstep(0.5, 1, depth) * (0.7 + fine(broadX * 0.8, broadY * 0.8, 173, 4, 0.8 * BROAD) * 0.6);
    const sea = fields.lake > fields.ocean
      ? mix(SHALLOW_OCEAN, LAKE, smoothstep(0.5, 0.9, fields.lake))
      : mix(mix(SHALLOW_OCEAN, DEEP_OCEAN, shelf), scale(DEEP_OCEAN, 0.7), Math.min(1, abyss));
    const albedo = isWater ? mix(sea, scale(ICE, 0.94), packIce) : isRiver ? RIVER : land;
    albedos[index * 3] = albedo[0];
    albedos[index * 3 + 1] = albedo[1];
    albedos[index * 3 + 2] = albedo[2];
    const swirl = (fine(broadX * 0.5, broadY * 0.5, 151, 3, 0.5 * BROAD) - 0.5) * 3;
    const weather = fine(broadX * 0.6 + swirl, broadY * 1.6 + swirl * 0.4, 7, 6, 1.6 * BROAD) + 0.07 * Math.cos(latitude * Math.PI * 3.2) + (cellField(moisture, gx, gy) - 0.5) * 0.12;
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
