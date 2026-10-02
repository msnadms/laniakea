import { baseOf, type Base, type BaseAddress } from '../game/base';
import type { BuildingKind } from '../game/baseBuildings';
import type { DefenceKind, SlotRef } from '../game/defences';
import type { ShipClass } from '../game/ships';
import { systemKey, useBaseStore } from '../store/baseStore';
import { useScanStore } from '../store/scanStore';
import { useTechStore } from '../store/techStore';
import { api, withRetry } from './api';
import { galaxyEntered } from './discoveries';

interface BaseReply {
  base: Base;
  technology: number;
}

function apply(reply: BaseReply) {
  useBaseStore.getState().setBase(baseOf(reply.base));
  const tech = useTechStore.getState();
  tech.setLedger({ technology: reply.technology, tech: tech.levels });
}

export async function foundBase(address: BaseAddress): Promise<void> {
  apply(await api<BaseReply>('/base/found', address));
}

export async function upgradeBuilding(kind: BuildingKind): Promise<void> {
  apply(await api<BaseReply>('/base/build', { kind }));
}

export async function placeDefence(slot: SlotRef, kind: DefenceKind): Promise<void> {
  apply(await api<BaseReply>('/base/defence', { ...slot, kind }));
}

export async function upgradeDefence(slot: SlotRef): Promise<void> {
  apply(await api<BaseReply>('/base/defence/upgrade', slot));
}

export async function moveDefence(from: SlotRef, to: SlotRef): Promise<void> {
  apply(await api<BaseReply>('/base/defence/move', { from, to }));
}

export async function queueShip(shipClass: ShipClass): Promise<void> {
  apply(await api<BaseReply>('/base/ship', { shipClass }));
}

export async function collectCondensate(): Promise<number> {
  const reply = await api<{ base: Base; condensate: number; collected: number }>('/base/collect', {});
  useBaseStore.getState().setBase(baseOf(reply.base));
  useScanStore.getState().setCondensate(reply.condensate);
  return reply.collected;
}

export async function fetchClaimed(superclusterSeed: number, galaxySeed: number, systemId: number): Promise<void> {
  await galaxyEntered(superclusterSeed, galaxySeed);
  const { rings } = await withRetry(() => api<{ rings: number[] }>(`/base/claimed/${superclusterSeed}/${galaxySeed}/${systemId}`));
  useBaseStore.getState().setClaimed(systemKey(superclusterSeed, galaxySeed, systemId), rings);
}

export async function grantAlloys(): Promise<void> {
  const { base } = await api<{ base: Base }>('/debug/grant-alloys', {});
  useBaseStore.getState().setBase(baseOf(base));
}
