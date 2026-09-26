import { createDiskField, DISK_SURFACE_WIDTH } from './aldersonSurface';

export type DiskPaintRequest = { seed: number; innerRatio: number; living: boolean; from: number; to: number };
export type DiskPaintResult = { from: number; to: number; albedo: Uint8ClampedArray<ArrayBuffer>; detail: Uint8ClampedArray<ArrayBuffer> };

self.onmessage = (event: MessageEvent<DiskPaintRequest>) => {
  const { seed, innerRatio, living, from, to } = event.data;
  const albedo = new Uint8ClampedArray((to - from) * DISK_SURFACE_WIDTH * 4);
  const detail = new Uint8ClampedArray(albedo.length);
  createDiskField(seed, innerRatio, living).paintRows(from, to, albedo, detail);
  const result: DiskPaintResult = { from, to, albedo, detail };
  self.postMessage(result, { transfer: [albedo.buffer, detail.buffer] });
};
