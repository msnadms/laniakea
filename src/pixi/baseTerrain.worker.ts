import type { BaseAddress } from '../game/base';
import { encodeBlockers, surfaceSeed, surfaceWorld, type SurfaceDeposit, type SurfaceWorld } from '../game/baseSurface';
import { paintBaseTerrain, type TerrainRegion } from './baseTerrain';

export type TerrainTileRequest = { key: string; address: BaseAddress; region: TerrainRegion; cellPx: number; withBlockers: boolean };
export type TerrainTileResult = {
  key: string;
  seed: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  blockers: Uint8Array<ArrayBuffer> | null;
  deposits: SurfaceDeposit[] | null;
};

let world: { seed: number; surface: SurfaceWorld } | null = null;

self.onmessage = (event: MessageEvent<TerrainTileRequest>) => {
  const { key, address, region, cellPx, withBlockers } = event.data;
  const seed = surfaceSeed(address);
  if (world?.seed !== seed) world = { seed, surface: surfaceWorld(address) };
  const blockers = withBlockers ? encodeBlockers(world.surface.blockers) : null;
  const job = paintBaseTerrain(seed, world.surface, region, cellPx);
  while (!job.step(Infinity));
  const deposits = withBlockers ? world.surface.deposits : null;
  const result: TerrainTileResult = { key, seed, width: job.image.width, height: job.image.height, pixels: job.image.data, blockers, deposits };
  const transfer: ArrayBuffer[] = [job.image.data.buffer];
  if (blockers) transfer.push(blockers.buffer);
  self.postMessage(result, { transfer });
};
