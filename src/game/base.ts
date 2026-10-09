import type { SurfaceCell, SurfaceDeposit } from './baseSurface';
import { BASE_EXTRACTOR_LIMIT, BASE_PLATFORM_LIMIT } from './constants';
import { isDefenceKind, isSlot, platformAt, type DefenceKind, type Platform, type SlotRef } from './defences';
import { extractorAt, isExtractor, isSurfaceCell, type Extractor } from './extractors';
import type { PlanetLayout } from './planetGen';

export interface BaseAddress {
  superclusterSeed: number;
  galaxySeed: number;
  systemId: number;
  ring: number;
}

export interface FoundingSite extends BaseAddress {
  planetName: string;
  systemName: string;
  galaxyName: string;
  superclusterName: string;
}

export interface Base extends FoundingSite {
  foundedAt: number;
  defences: Platform[];
  extractors: Extractor[];
}

export interface Refusal {
  status: 409;
  message: string;
}

export type Outcome = { ok: true; base: Base } | { ok: false; refusal: Refusal };

export function isSettleableWorld(layout: PlanetLayout | undefined): boolean {
  return layout?.zone === 'habitable';
}

export function baseKey({ superclusterSeed, galaxySeed, systemId, ring }: BaseAddress): string {
  return `${superclusterSeed}-${galaxySeed}-${systemId}-${ring}`;
}

export function foundBase(site: FoundingSite, now: number): Base {
  return { ...site, foundedAt: now, defences: [], extractors: [] };
}

function refuse(message: string): Outcome {
  return { ok: false, refusal: { status: 409, message } };
}

function withDefences(base: Base, defences: Platform[]): Outcome {
  return { ok: true, base: { ...base, defences } };
}

export function placeDefence(base: Base, slot: SlotRef, kind: DefenceKind): Outcome {
  if (!isSlot(slot)) return refuse('No such orbital slot');
  if (platformAt(base.defences, slot)) return refuse('That slot is taken');
  if (base.defences.length >= BASE_PLATFORM_LIMIT) return refuse(`No more than ${BASE_PLATFORM_LIMIT} platforms`);
  return withDefences(base, [...base.defences, { orbit: slot.orbit, slot: slot.slot, kind }]);
}

export function moveDefence(base: Base, from: SlotRef, to: SlotRef): Outcome {
  const platform = platformAt(base.defences, from);
  if (!platform) return refuse('No platform in that slot');
  if (!isSlot(to)) return refuse('No such orbital slot');
  if (platformAt(base.defences, to)) return refuse('That slot is taken');
  return withDefences(base, base.defences.map((p) => (p === platform ? { ...p, orbit: to.orbit, slot: to.slot } : p)));
}

export function removeDefence(base: Base, slot: SlotRef): Outcome {
  const platform = platformAt(base.defences, slot);
  if (!platform) return refuse('No platform in that slot');
  return withDefences(base, base.defences.filter((p) => p !== platform));
}

export function placeExtractor(base: Base, cell: SurfaceCell, deposit: SurfaceDeposit | null, now: number): Outcome {
  if (!isSurfaceCell(cell)) return refuse('No such sector');
  if (!deposit) return refuse('An extractor must stand on a deposit');
  if (extractorAt(base.extractors, cell)) return refuse('That sector is taken');
  if (base.extractors.length >= BASE_EXTRACTOR_LIMIT) return refuse(`No more than ${BASE_EXTRACTOR_LIMIT} extractors`);
  const extractor: Extractor = { col: cell.col, row: cell.row, resource: deposit.resource, grade: deposit.grade, stored: 0, settledAt: now };
  return { ok: true, base: { ...base, extractors: [...base.extractors, extractor] } };
}

export function removeExtractor(base: Base, cell: SurfaceCell): Outcome {
  const extractor = extractorAt(base.extractors, cell);
  if (!extractor) return refuse('No extractor in that sector');
  return { ok: true, base: { ...base, extractors: base.extractors.filter((e) => e !== extractor) } };
}

export function baseOf(data: object): Base {
  const base = data as unknown as Base;
  return {
    superclusterSeed: base.superclusterSeed,
    galaxySeed: base.galaxySeed,
    systemId: base.systemId,
    ring: base.ring,
    planetName: base.planetName,
    systemName: base.systemName,
    galaxyName: base.galaxyName,
    superclusterName: base.superclusterName,
    foundedAt: base.foundedAt,
    defences: (base.defences ?? []).filter((p) => isDefenceKind(p.kind)).map(({ orbit, slot, kind }) => ({ orbit, slot, kind })),
    extractors: (base.extractors ?? []).filter(isExtractor)
      .map(({ col, row, resource, grade, stored, settledAt }) => ({ col, row, resource, grade, stored, settledAt })),
  };
}
