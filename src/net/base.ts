import { baseOf, type Base, type BaseAddress } from '../game/base';
import type { SurfaceCell } from '../game/baseSurface';
import type { DefenceKind, SlotRef } from '../game/defences';
import { systemKey, useBaseStore } from '../store/baseStore';
import { api, withRetry } from './api';
import { galaxyEntered } from './discoveries';

async function order(path: string, body: object): Promise<void> {
  const { base } = await api<{ base: Base }>(path, body);
  useBaseStore.getState().setBase(baseOf(base));
}

export function foundBase(address: BaseAddress): Promise<void> {
  return order('/base/found', address);
}

export function placeDefence(slot: SlotRef, kind: DefenceKind): Promise<void> {
  return order('/base/defence', { ...slot, kind });
}

export function moveDefence(from: SlotRef, to: SlotRef): Promise<void> {
  return order('/base/defence/move', { from, to });
}

export function removeDefence(slot: SlotRef): Promise<void> {
  return order('/base/defence/remove', slot);
}

export function placeExtractor({ col, row }: SurfaceCell): Promise<void> {
  return order('/base/extractor', { col, row });
}

export function removeExtractor({ col, row }: SurfaceCell): Promise<void> {
  return order('/base/extractor/remove', { col, row });
}

export async function fetchClaimed(superclusterSeed: number, galaxySeed: number, systemId: number): Promise<void> {
  await galaxyEntered(superclusterSeed, galaxySeed);
  const { rings } = await withRetry(() => api<{ rings: number[] }>(`/base/claimed/${superclusterSeed}/${galaxySeed}/${systemId}`));
  useBaseStore.getState().setClaimed(systemKey(superclusterSeed, galaxySeed, systemId), rings);
}
