import { createRng } from './galaxyGen';
import { MILKY_WAY_SEED } from './hardcoded';
import {
  ANOMALY_BEAM_CHANCE,
  ANOMALY_BEAM_RIM_MAX,
  ANOMALY_BEAM_RIM_MIN,
  ANOMALY_BLACK_HOLE_ACTIVE_CHANCE,
  ANOMALY_BLACK_HOLE_CHANCE,
  ANOMALY_BLACK_HOLE_REACH,
  ANOMALY_BRAIN_CHANCE,
  ANOMALY_BRAIN_MIN_DYSON_SPHERES,
  ANOMALY_CIVILIZATION_CHANCE,
  ANOMALY_DYSON_EDGE_WEIGHT,
  ANOMALY_DYSON_MAX,
  ANOMALY_DYSON_MIN,
  ANOMALY_HOME_OUTER_ARM_FRACTION,
  ANOMALY_HOME_RADIUS,
  ANOMALY_INTEGRITY,
  ANOMALY_SHKADOV_CHANCE,
  ANOMALY_SHKADOV_HEIGHT_FRACTION,
  GALAXY_RADIUS,
  POPULATION_SCALE_HEIGHT,
} from './constants';
import type { Galaxy, Rng, StarSystem, StarType } from './types';

export type AnomalyKind = 'blackHole' | 'dysonSphere' | 'matrioshkaBrain' | 'nicollDysonBeam' | 'shkadovThruster';

export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'blackHole',
  'dysonSphere',
  'shkadovThruster',
  'nicollDysonBeam',
  'matrioshkaBrain',
];

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Anomaly {
  kind: AnomalyKind;
  hostId: number;
  seed: number;
  integrity: number;
  direction: Vector3 | null;
  active: boolean;
}

export interface Civilization {
  x: number;
  y: number;
  radius: number;
}

export interface GalaxyAnomalies {
  civilization: Civilization | null;
  byHost: ReadonlyMap<number, Anomaly>;
}

interface PlanePoint {
  x: number;
  y: number;
}

const CIVILIZATION_SALT = 0x6c8e9cf5;
const BLACK_HOLE_SALT = 0x3c6ef372;
const HOST_SEED_MIX = 0x165667b1;

const RELIC_CLASSES: ReadonlySet<StarType> = new Set(['F', 'G', 'K']);
const HOME_CLASSES: ReadonlySet<StarType> = new Set(['G', 'K']);

export function planeDistance(a: PlanePoint, b: PlanePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function canHostAnomaly(system: StarSystem): boolean {
  return system.starType !== 'L' && system.starType !== 'N';
}

export function isRelicClass(system: StarSystem): boolean {
  return RELIC_CLASSES.has(system.starType);
}

export function isSettledPopulation(system: StarSystem): boolean {
  return system.population !== 'bulge' && system.population !== 'starburst';
}

export function relativeHeight(system: StarSystem): number {
  return Math.abs(system.z) / (POPULATION_SCALE_HEIGHT[system.population] * GALAXY_RADIUS);
}

export function highStarThreshold(systems: readonly StarSystem[]): number {
  const heights = systems.map(relativeHeight).sort((a, b) => b - a);
  return heights[Math.min(heights.length - 1, Math.floor(heights.length * ANOMALY_SHKADOV_HEIGHT_FRACTION))];
}

export function nearestNeutronStarDistance(system: StarSystem, systems: readonly StarSystem[]): number {
  let nearest = Infinity;
  for (const other of systems) {
    if (other.starType === 'N' && other.id !== system.id) nearest = Math.min(nearest, planeDistance(system, other));
  }
  return nearest;
}

export function anomalySeed(galaxySeed: number, hostId: number): number {
  return (galaxySeed ^ Math.imul(hostId, HOST_SEED_MIX)) >>> 0;
}

export function anomalyVisualRng(anomaly: Anomaly): Rng {
  return createRng((anomaly.seed + 1) >>> 0);
}

function civilizationRng(galaxySeed: number): Rng {
  return createRng((galaxySeed ^ CIVILIZATION_SALT) >>> 0);
}

export function hasCivilization(galaxySeed: number): boolean {
  return galaxySeed !== MILKY_WAY_SEED && civilizationRng(galaxySeed)() < ANOMALY_CIVILIZATION_CHANCE;
}

function normalize(x: number, y: number, z: number): Vector3 {
  const length = Math.hypot(x, y, z);
  return length === 0 ? { x: 1, y: 0, z: 0 } : { x: x / length, y: y / length, z: z / length };
}

function createAnomaly(kind: AnomalyKind, galaxySeed: number, hostId: number, direction: Vector3 | null = null): Anomaly {
  const seed = anomalySeed(galaxySeed, hostId);
  const rng = createRng(seed);
  const [min, max] = ANOMALY_INTEGRITY[kind];
  const integrity = min + (max - min) * rng();
  const active = kind === 'blackHole' && rng() < ANOMALY_BLACK_HOLE_ACTIVE_CHANCE;
  return { kind, hostId, seed, integrity, direction, active };
}

function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | null {
  if (items.length === 0) return null;
  let roll = rng() * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

function pickManyWeighted<T>(rng: Rng, items: readonly T[], count: number, weight: (item: T) => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count) {
    const item = pickWeighted(rng, pool, weight);
    if (item === null) break;
    picked.push(item);
    pool.splice(pool.indexOf(item), 1);
  }
  return picked;
}

function nearestTo(systems: readonly StarSystem[], point: PlanePoint): StarSystem | null {
  let nearest: StarSystem | null = null;
  let nearestDistance = Infinity;
  for (const system of systems) {
    const distance = planeDistance(system, point);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = system;
    }
  }
  return nearest;
}

function isHomeCandidate(system: StarSystem): boolean {
  if (!HOME_CLASSES.has(system.starType)) return false;
  if (system.population === 'disk' || system.population === 'bar') return true;
  return system.population === 'arm' && Math.hypot(system.x, system.y) >= GALAXY_RADIUS * ANOMALY_HOME_OUTER_ARM_FRACTION;
}

function pickHome(rng: Rng, hosts: readonly StarSystem[]): StarSystem {
  const tiers = [
    hosts.filter(isHomeCandidate),
    hosts.filter((system) => HOME_CLASSES.has(system.starType) && isSettledPopulation(system)),
  ];
  const pool = tiers.find((tier) => tier.length > 0) ?? hosts;
  return pool[Math.floor(rng() * pool.length)];
}

export function isInCivilization(system: PlanePoint, civilization: Civilization): boolean {
  return planeDistance(system, civilization) <= civilization.radius;
}

function placeCivilization(galaxy: Galaxy, hosts: readonly StarSystem[], byHost: Map<number, Anomaly>): Civilization | null {
  const rng = civilizationRng(galaxy.seed);
  // The civilisation roll must stay the first draw so hasCivilization can answer from the seed alone.
  if (rng() >= ANOMALY_CIVILIZATION_CHANCE) return null;
  const dysonCount = ANOMALY_DYSON_MIN + Math.floor(rng() * (ANOMALY_DYSON_MAX - ANOMALY_DYSON_MIN + 1));
  const wantsBrain = rng() < ANOMALY_BRAIN_CHANCE && dysonCount >= ANOMALY_BRAIN_MIN_DYSON_SPHERES;
  const wantsShkadov = rng() < ANOMALY_SHKADOV_CHANCE;
  const wantsBeam = rng() < ANOMALY_BEAM_CHANCE;

  const home = pickHome(rng, hosts);
  const civilization: Civilization = { x: home.x, y: home.y, radius: ANOMALY_HOME_RADIUS };
  const inRegion = (system: StarSystem) => isInCivilization(system, civilization);

  const brainCandidate = wantsBrain
    ? nearestTo(hosts.filter((system) => system.starType === 'K' && isSettledPopulation(system) && inRegion(system)), civilization)
    : null;

  const dysonHosts = pickManyWeighted(
    rng,
    hosts.filter((system) => isRelicClass(system) && isSettledPopulation(system) && inRegion(system) && system !== brainCandidate),
    dysonCount,
    (system) => 1 - planeDistance(system, civilization) / civilization.radius + ANOMALY_DYSON_EDGE_WEIGHT,
  );
  for (const host of dysonHosts) byHost.set(host.id, createAnomaly('dysonSphere', galaxy.seed, host.id));

  const brain = brainCandidate && dysonHosts.length >= ANOMALY_BRAIN_MIN_DYSON_SPHERES ? brainCandidate : null;
  if (brain) byHost.set(brain.id, createAnomaly('matrioshkaBrain', galaxy.seed, brain.id));

  if (wantsShkadov) {
    const threshold = highStarThreshold(galaxy.systems);
    const host = nearestTo(
      hosts.filter((system) => isRelicClass(system) && !inRegion(system) && !byHost.has(system.id) && relativeHeight(system) >= threshold),
      civilization,
    );
    if (host) {
      const heading = normalize(host.x - civilization.x, host.y - civilization.y, host.z);
      byHost.set(host.id, createAnomaly('shkadovThruster', galaxy.seed, host.id, heading));
    }
  }

  if (wantsBeam) {
    const rim = hosts.filter((system) => {
      const reach = planeDistance(system, civilization) / civilization.radius;
      return isRelicClass(system) && !byHost.has(system.id) && reach >= ANOMALY_BEAM_RIM_MIN && reach <= ANOMALY_BEAM_RIM_MAX;
    });
    const host = rim.length > 0 ? rim[Math.floor(rng() * rim.length)] : null;
    if (host) {
      const target = brain ?? civilization;
      byHost.set(host.id, createAnomaly('nicollDysonBeam', galaxy.seed, host.id, normalize(target.x - host.x, target.y - host.y, 0)));
    }
  }

  return civilization;
}

function placeBlackHoles(galaxy: Galaxy, hosts: readonly StarSystem[], byHost: Map<number, Anomaly>) {
  const neutronStars = galaxy.systems.filter((system) => system.starType === 'N');
  if (neutronStars.length === 0) return;
  const rng = createRng((galaxy.seed ^ BLACK_HOLE_SALT) >>> 0);
  for (const system of hosts) {
    if (!neutronStars.some((neutronStar) => planeDistance(system, neutronStar) <= ANOMALY_BLACK_HOLE_REACH)) continue;
    if (rng() < ANOMALY_BLACK_HOLE_CHANCE && !byHost.has(system.id)) {
      byHost.set(system.id, createAnomaly('blackHole', galaxy.seed, system.id));
    }
  }
}

export const NO_ANOMALIES: GalaxyAnomalies = { civilization: null, byHost: new Map() };

export function generateAnomalies(galaxy: Galaxy): GalaxyAnomalies {
  if (galaxy.seed === MILKY_WAY_SEED) return NO_ANOMALIES;
  const hosts = galaxy.systems.filter(canHostAnomaly);
  const byHost = new Map<number, Anomaly>();
  const civilization = placeCivilization(galaxy, hosts, byHost);
  placeBlackHoles(galaxy, hosts, byHost);
  return { civilization, byHost };
}
