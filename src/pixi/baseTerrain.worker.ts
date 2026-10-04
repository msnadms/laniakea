import type { BaseAddress } from '../game/base';
import { surfaceBlockers, surfaceSeed, type SurfaceBlocker } from '../game/baseSurface';
import { paintBaseTerrain, type TerrainRegion } from './baseTerrain';

export type TerrainTileRequest = { key: string; address: BaseAddress; region: TerrainRegion; cellPx: number };
export type TerrainTileResult = { key: string; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> };

let world: { seed: number; blockers: SurfaceBlocker[] } | null = null;

self.onmessage = (event: MessageEvent<TerrainTileRequest>) => {
  const { key, address, region, cellPx } = event.data;
  const seed = surfaceSeed(address);
  if (world?.seed !== seed) world = { seed, blockers: surfaceBlockers(address) };
  const job = paintBaseTerrain(seed, world.blockers, region, cellPx);
  while (!job.step(Infinity));
  const result: TerrainTileResult = { key, width: job.image.width, height: job.image.height, pixels: job.image.data };
  self.postMessage(result, { transfer: [job.image.data.buffer] });
};
