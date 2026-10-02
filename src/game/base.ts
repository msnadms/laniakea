import {
  BASE_POPULATION_GROWTH_PER_HOUR,
  BASE_START_ALLOYS,
  BASE_START_POPULATION,
  BASE_WORLD_POPULATION_MIN,
  BASE_WORLD_POPULATION_PER_MOON,
  BASE_WORLD_POPULATION_PER_RADIUS,
  BASE_WORLD_SIPHON_BASE,
  BASE_WORLD_SIPHON_PER_MOON,
} from './constants';
import {
  alloyCapacity,
  builderSlots,
  BUILDING_KINDS,
  buildingCost,
  buildingCrew,
  BUILDINGS,
  condensateCapacity,
  habitatCapacity,
  hangarCapacity,
  platformLimit,
  shipyardQueueLength,
  STARTING_BUILDINGS,
  type BuildingKind,
  type LevelCost,
} from './baseBuildings';
import { defenceCost, defenceCrew, DEFENCES, isSlot, platformAt, type DefenceKind, type Platform, type SlotRef } from './defences';
import { fleetCrew, hullUnits, NO_SHIPS, SHIPS, type ShipClass, type ShipCounts } from './ships';
import type { PlanetLayout } from './planetGen';
import type { StarType } from './types';

export interface WorldQuality {
  populationCap: number;
  alloyRate: number;
  siphonRate: number;
}

export interface Construction {
  level: number;
  readyAt: number | null;
}

export interface QueuedShip {
  shipClass: ShipClass;
  readyAt: number;
}

export interface BaseAddress {
  superclusterSeed: number;
  galaxySeed: number;
  systemId: number;
  ring: number;
}

export interface Base extends BaseAddress {
  planetName: string;
  systemName: string;
  galaxyName: string;
  superclusterName: string;
  quality: WorldQuality;
  foundedAt: number;
  settledAt: number;
  population: number;
  alloys: number;
  condensate: number;
  buildings: Record<BuildingKind, Construction>;
  defences: Platform[];
  fleet: ShipCounts;
  shipQueue: QueuedShip[];
}

export interface Refusal {
  status: 402 | 409;
  message: string;
}

export type Outcome = { ok: true; base: Base; technology: number } | { ok: false; refusal: Refusal };

const HOUR_MS = 3_600_000;

const ALLOY_RATE_BY_STAR: Record<StarType, number> = { G: 12, K: 10, F: 9, A: 7, M: 6, L: 4, N: 4 };

export function isSettleableWorld(layout: PlanetLayout | undefined): boolean {
  return layout?.zone === 'habitable';
}

export function worldQuality(layout: PlanetLayout, starType: StarType): WorldQuality {
  const moons = layout.moons.length;
  return {
    populationCap: BASE_WORLD_POPULATION_MIN + Math.max(0, layout.radius - 24) * BASE_WORLD_POPULATION_PER_RADIUS + moons * BASE_WORLD_POPULATION_PER_MOON,
    alloyRate: ALLOY_RATE_BY_STAR[starType],
    siphonRate: BASE_WORLD_SIPHON_BASE + moons * BASE_WORLD_SIPHON_PER_MOON,
  };
}

export function baseKey({ superclusterSeed, galaxySeed, systemId, ring }: BaseAddress): string {
  return `${superclusterSeed}-${galaxySeed}-${systemId}-${ring}`;
}

export interface FoundingSite extends BaseAddress {
  planetName: string;
  systemName: string;
  galaxyName: string;
  superclusterName: string;
  quality: WorldQuality;
}

export function foundBase(site: FoundingSite, now: number): Base {
  const buildings = Object.fromEntries(BUILDING_KINDS.map((kind) => [kind, { level: STARTING_BUILDINGS[kind], readyAt: null }])) as Record<BuildingKind, Construction>;
  return {
    ...site,
    foundedAt: now,
    settledAt: now,
    population: BASE_START_POPULATION,
    alloys: BASE_START_ALLOYS,
    condensate: 0,
    buildings,
    defences: [],
    fleet: { ...NO_SHIPS },
    shipQueue: [],
  };
}

function level(base: Base, kind: BuildingKind): number {
  return base.buildings[kind].level;
}

export function populationCapacity(base: Base): number {
  return Math.min(base.quality.populationCap, habitatCapacity(level(base, 'habitat')));
}

export function alloyRate(base: Base): number {
  return base.quality.alloyRate * level(base, 'refinery');
}

export function siphonRate(base: Base): number {
  return base.quality.siphonRate * level(base, 'siphon');
}

export function baseAlloyCapacity(base: Base): number {
  return alloyCapacity(level(base, 'vault'));
}

export function baseCondensateCapacity(base: Base): number {
  return condensateCapacity(level(base, 'vault'));
}

export function queuedShips(base: Base): ShipCounts {
  const counts = { ...NO_SHIPS };
  for (const queued of base.shipQueue) counts[queued.shipClass]++;
  return counts;
}

export function crewUsed(base: Base): number {
  const buildings = BUILDING_KINDS.reduce((sum, kind) => {
    const { level: current, readyAt } = base.buildings[kind];
    return sum + buildingCrew(kind, current + (readyAt === null ? 0 : 1));
  }, 0);
  return buildings + defenceCrew(base.defences) + fleetCrew(base.fleet) + fleetCrew(queuedShips(base));
}

export function freeCrew(base: Base): number {
  return Math.floor(base.population) - crewUsed(base);
}

export function buildersBusy(base: Base): number {
  const buildings = BUILDING_KINDS.filter((kind) => base.buildings[kind].readyAt !== null).length;
  return buildings + base.defences.filter((platform) => platform.readyAt !== null).length;
}

export function buildersFree(base: Base): number {
  return builderSlots(level(base, 'command')) - buildersBusy(base);
}

export function hangarUsed(base: Base): number {
  return hullUnits(base.fleet) + hullUnits(queuedShips(base));
}

function nextEvent(base: Base, now: number): number | null {
  let next = Infinity;
  for (const kind of BUILDING_KINDS) {
    const readyAt = base.buildings[kind].readyAt;
    if (readyAt !== null) next = Math.min(next, readyAt);
  }
  for (const platform of base.defences) if (platform.readyAt !== null) next = Math.min(next, platform.readyAt);
  if (base.shipQueue.length > 0) next = Math.min(next, base.shipQueue[0].readyAt);
  return next <= now ? next : null;
}

function complete(base: Base, at: number) {
  for (const kind of BUILDING_KINDS) {
    const construction = base.buildings[kind];
    if (construction.readyAt !== null && construction.readyAt <= at) base.buildings[kind] = { level: construction.level + 1, readyAt: null };
  }
  base.defences = base.defences.map((platform) =>
    platform.readyAt !== null && platform.readyAt <= at ? { ...platform, level: platform.level + 1, readyAt: null } : platform);
  while (base.shipQueue.length > 0 && base.shipQueue[0].readyAt <= at) {
    const [done, ...rest] = base.shipQueue;
    base.fleet = { ...base.fleet, [done.shipClass]: base.fleet[done.shipClass] + 1 };
    base.shipQueue = rest;
  }
}

function fill(amount: number, rate: number, hours: number, capacity: number): number {
  if (amount >= capacity) return amount;
  return Math.min(capacity, amount + rate * hours);
}

function grow(population: number, capacity: number, hours: number): number {
  if (population >= capacity || population <= 0) return population;
  return capacity / (1 + (capacity / population - 1) * Math.exp(-BASE_POPULATION_GROWTH_PER_HOUR * hours));
}

function accrue(base: Base, from: number, to: number) {
  const hours = (to - from) / HOUR_MS;
  if (hours <= 0) return;
  base.alloys = fill(base.alloys, alloyRate(base), hours, baseAlloyCapacity(base));
  base.condensate = fill(base.condensate, siphonRate(base), hours, baseCondensateCapacity(base));
  base.population = grow(base.population, populationCapacity(base), hours);
}

export function cloneBase(base: Base): Base {
  return {
    ...base,
    quality: { ...base.quality },
    buildings: Object.fromEntries(BUILDING_KINDS.map((kind) => [kind, { ...base.buildings[kind] }])) as Record<BuildingKind, Construction>,
    defences: base.defences.map((platform) => ({ ...platform })),
    fleet: { ...base.fleet },
    shipQueue: base.shipQueue.map((queued) => ({ ...queued })),
  };
}

export function settleBase(base: Base, now: number): Base {
  const next = cloneBase(base);
  let at = base.settledAt;
  for (let event = nextEvent(next, now); event !== null; event = nextEvent(next, now)) {
    accrue(next, at, event);
    at = Math.max(at, event);
    complete(next, event);
  }
  accrue(next, at, now);
  next.settledAt = Math.max(at, now);
  return next;
}

function refuse(status: 402 | 409, message: string): Outcome {
  return { ok: false, refusal: { status, message } };
}

function affordRefusal(base: Base, cost: LevelCost, technology: number): Outcome | null {
  if (base.alloys < cost.alloys) return refuse(402, 'Not enough alloys');
  if (technology < cost.technology) return refuse(402, 'Not enough advanced technology');
  if (freeCrew(base) < cost.crew) return refuse(409, 'Not enough people to crew it');
  return null;
}

function spend(base: Base, cost: LevelCost): Base {
  return { ...base, alloys: base.alloys - cost.alloys };
}

export function upgradeBuilding(base: Base, kind: BuildingKind, technology: number, now: number): Outcome {
  const construction = base.buildings[kind];
  const cost = buildingCost(kind, construction.level);
  if (!cost) return refuse(409, `The ${BUILDINGS[kind].name} is fully built`);
  if (construction.readyAt !== null) return refuse(409, `The ${BUILDINGS[kind].name} is already being built`);
  if (kind !== 'command' && construction.level + 1 > level(base, 'command')) return refuse(409, 'Upgrade the Command Nexus first');
  if (buildersFree(base) <= 0) return refuse(409, 'Every construction crew is busy');
  const unaffordable = affordRefusal(base, cost, technology);
  if (unaffordable) return unaffordable;
  const next = spend(base, cost);
  next.buildings = { ...base.buildings, [kind]: { level: construction.level, readyAt: now + cost.seconds * 1000 } };
  return { ok: true, base: next, technology: cost.technology };
}

export function placeDefence(base: Base, slot: SlotRef, kind: DefenceKind, technology: number, now: number): Outcome {
  if (!isSlot(slot)) return refuse(409, 'No such orbital slot');
  if (platformAt(base.defences, slot)) return refuse(409, 'That slot is taken');
  if (level(base, 'command') < DEFENCES[kind].commandLevel) return refuse(409, `Needs Command Nexus ${DEFENCES[kind].commandLevel}`);
  if (base.defences.length >= platformLimit(level(base, 'command'))) return refuse(409, 'The Command Nexus cannot hold another platform');
  if (buildersFree(base) <= 0) return refuse(409, 'Every construction crew is busy');
  const cost = defenceCost(kind, 0)!;
  const unaffordable = affordRefusal(base, cost, technology);
  if (unaffordable) return unaffordable;
  const next = spend(base, cost);
  next.defences = [...base.defences, { orbit: slot.orbit, slot: slot.slot, kind, level: 0, readyAt: now + cost.seconds * 1000 }];
  return { ok: true, base: next, technology: cost.technology };
}

export function upgradeDefence(base: Base, slot: SlotRef, technology: number, now: number): Outcome {
  const platform = platformAt(base.defences, slot);
  if (!platform) return refuse(409, 'No platform in that slot');
  if (platform.readyAt !== null) return refuse(409, 'That platform is already being built');
  const cost = defenceCost(platform.kind, platform.level);
  if (!cost) return refuse(409, 'That platform is fully upgraded');
  if (platform.level + 1 > level(base, 'command')) return refuse(409, 'Upgrade the Command Nexus first');
  if (buildersFree(base) <= 0) return refuse(409, 'Every construction crew is busy');
  const unaffordable = affordRefusal(base, cost, technology);
  if (unaffordable) return unaffordable;
  const next = spend(base, cost);
  next.defences = base.defences.map((p) => (p === platform ? { ...p, readyAt: now + cost.seconds * 1000 } : p));
  return { ok: true, base: next, technology: cost.technology };
}

export function moveDefence(base: Base, from: SlotRef, to: SlotRef): Outcome {
  const platform = platformAt(base.defences, from);
  if (!platform) return refuse(409, 'No platform in that slot');
  if (platform.readyAt !== null) return refuse(409, 'A platform cannot be moved while it is being built');
  if (!isSlot(to)) return refuse(409, 'No such orbital slot');
  if (platformAt(base.defences, to)) return refuse(409, 'That slot is taken');
  const next = cloneBase(base);
  next.defences = base.defences.map((p) => (p === platform ? { ...p, orbit: to.orbit, slot: to.slot } : { ...p }));
  return { ok: true, base: next, technology: 0 };
}

export function shipCost(shipClass: ShipClass): LevelCost {
  const spec = SHIPS[shipClass];
  return { alloys: spec.alloys, technology: spec.technology, crew: spec.crew, seconds: spec.buildSeconds };
}

export function queueShip(base: Base, shipClass: ShipClass, technology: number, now: number): Outcome {
  const spec = SHIPS[shipClass];
  if (level(base, 'shipyard') < spec.shipyardLevel) return refuse(409, `Needs Shipyard ${spec.shipyardLevel}`);
  if (base.shipQueue.length >= shipyardQueueLength(level(base, 'shipyard'))) return refuse(409, 'The shipyard queue is full');
  if (hangarUsed(base) + spec.hullUnits > hangarCapacity(level(base, 'hangar'))) return refuse(409, 'The hangar has no room for it');
  const cost = shipCost(shipClass);
  const unaffordable = affordRefusal(base, cost, technology);
  if (unaffordable) return unaffordable;
  const next = spend(base, cost);
  const start = Math.max(now, base.shipQueue.at(-1)?.readyAt ?? now);
  next.shipQueue = [...base.shipQueue, { shipClass, readyAt: start + cost.seconds * 1000 }];
  return { ok: true, base: next, technology: cost.technology };
}

export function baseOf(data: object): Base {
  const base = data as unknown as Base;
  return cloneBase({
    ...base,
    defences: base.defences ?? [],
    fleet: { ...NO_SHIPS, ...base.fleet },
    shipQueue: base.shipQueue ?? [],
  });
}
