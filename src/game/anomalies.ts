import { createRng, firstRandom, generateGalaxy } from './galaxyGen';
import { MILKY_WAY_SEED } from './hardcoded';
import {
  ANOMALY_BEAM_RIM_MAX,
  ANOMALY_BEAM_RIM_MIN,
  ANOMALY_BLACK_HOLE_ACTIVE_CHANCE,
  ANOMALY_BLACK_HOLE_CHANCE,
  ANOMALY_BLACK_HOLE_REACH,
  ANOMALY_BRAIN_MIN_DYSON_SPHERES,
  ANOMALY_CIVILIZATION_CHANCE,
  SC_DOT_SEED_MIX,
  SC_MAX_GALAXY_DOTS,
  ANOMALY_DYSON_EDGE_WEIGHT,
  ANOMALY_DYSON_MAX,
  ANOMALY_DYSON_MIN,
  ANOMALY_HOME_OUTER_ARM_FRACTION,
  ANOMALY_HOME_RADIUS,
  ANOMALY_INTEGRITY,
  ANOMALY_INTEGRITY_LIVING,
  ANOMALY_LIVING_CHANCE,
  ANOMALY_MEGASTRUCTURES_SOME_MAX,
  ANOMALY_MEGASTRUCTURES_SOME_MIN,
  ANOMALY_RUINED_MIN_STAGE,
  ANOMALY_STAGE_POPULATED,
  ANOMALY_THRUSTER_HEIGHT_FRACTION,
  ANOMALY_STAGE_WEIGHTS,
  GALAXY_RADIUS,
  POPULATION_SCALE_HEIGHT,
} from './constants';
import type { Galaxy, Rng, StarSystem, StarType } from './types';

export type AnomalyKind =
  | 'alcubierreCannon'
  | 'aldersonDisk'
  | 'blackHole'
  | 'caplanThruster'
  | 'dysonSphere'
  | 'homeworld'
  | 'matrioshkaBrain'
  | 'nicollDysonBeam';

export type HomeKind = Extract<AnomalyKind, 'aldersonDisk' | 'homeworld'>;

export type MegastructureKind = Extract<AnomalyKind, 'caplanThruster' | 'matrioshkaBrain' | 'nicollDysonBeam'>;

export type CivilizationStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface StagePlan {
  home: HomeKind | null;
  homeSwarm: boolean;
  dysonSpheres: boolean;
  megastructures: 'none' | 'some' | 'all';
  cannon: boolean;
}

export const CIVILIZATION_STAGES: readonly CivilizationStage[] = [1, 2, 3, 4, 5, 6];

export const CIVILIZATION_STAGE_PLANS: Record<CivilizationStage, StagePlan> = {
  1: { home: null, homeSwarm: false, dysonSpheres: false, megastructures: 'none', cannon: false },
  2: { home: 'homeworld', homeSwarm: false, dysonSpheres: false, megastructures: 'none', cannon: false },
  3: { home: 'homeworld', homeSwarm: true, dysonSpheres: false, megastructures: 'none', cannon: false },
  4: { home: 'homeworld', homeSwarm: true, dysonSpheres: true, megastructures: 'none', cannon: false },
  5: { home: 'homeworld', homeSwarm: true, dysonSpheres: true, megastructures: 'some', cannon: false },
  6: { home: 'aldersonDisk', homeSwarm: false, dysonSpheres: true, megastructures: 'all', cannon: true },
};

export const MEGASTRUCTURE_KINDS: readonly MegastructureKind[] = ['matrioshkaBrain', 'nicollDysonBeam', 'caplanThruster'];

export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'blackHole',
  'dysonSphere',
  'caplanThruster',
  'nicollDysonBeam',
  'homeworld',
  'matrioshkaBrain',
  'aldersonDisk',
  'alcubierreCannon',
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
  living: boolean;
  swarm: boolean;
}

export interface Civilization {
  x: number;
  y: number;
  radius: number;
  living: boolean;
  stage: CivilizationStage;
}

export interface GalaxyAnomalies {
  civilization: Civilization | null;
  byHost: ReadonlyMap<number, Anomaly>;
  populated: ReadonlySet<number>;
}

interface PlanePoint {
  x: number;
  y: number;
}

const CIVILIZATION_SALT = 0x6c8e9cf5;
const BLACK_HOLE_SALT = 0x3c6ef372;
const POPULATED_SALT = 0x51ed270b;
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
  return heights[Math.min(heights.length - 1, Math.floor(heights.length * ANOMALY_THRUSTER_HEIGHT_FRACTION))];
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
  return galaxySeed !== MILKY_WAY_SEED && firstRandom((galaxySeed ^ CIVILIZATION_SALT) >>> 0) < ANOMALY_CIVILIZATION_CHANCE;
}

// A sweep rules a supercluster out by hashing every dot index it could hold, so the roll is
// inlined here rather than called tens of thousands of times; an index past its real dot count
// can only add a false pass, which the walk that follows rejects.
export function superclusterMayHoldCivilization(superclusterSeed: number): boolean {
  for (let i = 0; i < SC_MAX_GALAXY_DOTS; i++) {
    const galaxySeed = (superclusterSeed ^ Math.imul(i, SC_DOT_SEED_MIX)) >>> 0;
    if (galaxySeed === MILKY_WAY_SEED) continue;
    const state = (((galaxySeed ^ CIVILIZATION_SALT) | 0) + 0x6D2B79F5) | 0;
    let hash = Math.imul(state ^ (state >>> 15), 1 | state);
    hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
    if (((hash ^ (hash >>> 14)) >>> 0) / 4294967296 < ANOMALY_CIVILIZATION_CHANCE) return true;
  }
  return false;
}

export interface CivilizationProfile {
  living: boolean;
  stage: CivilizationStage;
}

export function civilizationProfile(galaxySeed: number): CivilizationProfile | null {
  if (galaxySeed === MILKY_WAY_SEED) return null;
  const rng = civilizationRng(galaxySeed);
  if (rng() >= ANOMALY_CIVILIZATION_CHANCE) return null;
  const living = rng() < ANOMALY_LIVING_CHANCE;
  return { living, stage: rollStage(rng, living) };
}

function normalize(x: number, y: number, z: number): Vector3 {
  const length = Math.hypot(x, y, z);
  return length === 0 ? { x: 1, y: 0, z: 0 } : { x: x / length, y: y / length, z: z / length };
}

function createAnomaly(
  kind: AnomalyKind,
  galaxySeed: number,
  hostId: number,
  direction: Vector3 | null = null,
  living = false,
  swarm = false,
): Anomaly {
  const seed = anomalySeed(galaxySeed, hostId);
  const rng = createRng(seed);
  const [min, max] = (living ? ANOMALY_INTEGRITY_LIVING[kind] : undefined) ?? ANOMALY_INTEGRITY[kind];
  const integrity = min + (max - min) * rng();
  const active = kind === 'blackHole' && rng() < ANOMALY_BLACK_HOLE_ACTIVE_CHANCE;
  return { kind, hostId, seed, integrity, direction, active, living, swarm };
}

function rollRange(rng: Rng, [min, max]: readonly [number, number]): number {
  return min + Math.floor(rng() * (max - min + 1));
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

export function isInCivilization(system: PlanePoint, civilization: Pick<Civilization, 'x' | 'y' | 'radius'>): boolean {
  return planeDistance(system, civilization) <= civilization.radius;
}

function rollStage(rng: Rng, living: boolean): CivilizationStage {
  const stages = living ? CIVILIZATION_STAGES : CIVILIZATION_STAGES.filter((stage) => stage >= ANOMALY_RUINED_MIN_STAGE);
  return pickWeighted(rng, stages, (stage) => ANOMALY_STAGE_WEIGHTS[stage])!;
}

function rollMegastructures(rng: Rng, plan: StagePlan): ReadonlySet<MegastructureKind> {
  if (plan.megastructures === 'none') return new Set();
  if (plan.megastructures === 'all') return new Set(MEGASTRUCTURE_KINDS);
  const count = rollRange(rng, [ANOMALY_MEGASTRUCTURES_SOME_MIN, ANOMALY_MEGASTRUCTURES_SOME_MAX]);
  return new Set(pickManyWeighted(rng, MEGASTRUCTURE_KINDS, count, () => 1));
}

function placeCivilization(galaxy: Galaxy, hosts: readonly StarSystem[], byHost: Map<number, Anomaly>): Civilization | null {
  const rng = civilizationRng(galaxy.seed);
  // The civilisation roll must stay the first draw so hasCivilization can answer from the seed alone.
  if (rng() >= ANOMALY_CIVILIZATION_CHANCE) return null;
  const living = rng() < ANOMALY_LIVING_CHANCE;
  const stage = rollStage(rng, living);
  const plan = CIVILIZATION_STAGE_PLANS[stage];
  const megastructures = rollMegastructures(rng, plan);
  const rolledDysonCount = rollRange(rng, [ANOMALY_DYSON_MIN, ANOMALY_DYSON_MAX]);
  const wantsBrain = megastructures.has('matrioshkaBrain');
  const dysonCount = !plan.dysonSpheres ? 0 : wantsBrain ? Math.max(rolledDysonCount, ANOMALY_BRAIN_MIN_DYSON_SPHERES) : rolledDysonCount;

  const home = pickHome(rng, hosts);
  const center = { x: home.x, y: home.y, radius: ANOMALY_HOME_RADIUS };
  const inRegion = (system: StarSystem) => isInCivilization(system, center);
  const occupied = new Set<number>();

  const brainCandidate = wantsBrain
    ? nearestTo(hosts.filter((system) => system.starType === 'K' && isSettledPopulation(system) && inRegion(system)), center)
    : null;

  const dysonHosts = pickManyWeighted(
    rng,
    hosts.filter((system) => isRelicClass(system) && isSettledPopulation(system) && inRegion(system) && system !== brainCandidate),
    dysonCount,
    (system) => 1 - planeDistance(system, center) / center.radius + ANOMALY_DYSON_EDGE_WEIGHT,
  );
  for (const host of dysonHosts) occupied.add(host.id);

  const brainHost = brainCandidate && dysonHosts.length >= ANOMALY_BRAIN_MIN_DYSON_SPHERES ? brainCandidate : null;
  if (brainHost) occupied.add(brainHost.id);

  let thrusterHost: StarSystem | null = null;
  if (megastructures.has('caplanThruster')) {
    const threshold = highStarThreshold(galaxy.systems);
    thrusterHost = nearestTo(
      hosts.filter((system) => isRelicClass(system) && !inRegion(system) && !occupied.has(system.id) && relativeHeight(system) >= threshold),
      center,
    );
    if (thrusterHost) occupied.add(thrusterHost.id);
  }

  let beamHost: StarSystem | null = null;
  if (megastructures.has('nicollDysonBeam')) {
    const rim = hosts.filter((system) => {
      const reach = planeDistance(system, center) / center.radius;
      return isRelicClass(system) && !occupied.has(system.id) && reach >= ANOMALY_BEAM_RIM_MIN && reach <= ANOMALY_BEAM_RIM_MAX;
    });
    beamHost = rim.length > 0 ? rim[Math.floor(rng() * rim.length)] : null;
    if (beamHost) occupied.add(beamHost.id);
  }

  for (const host of dysonHosts) byHost.set(host.id, createAnomaly('dysonSphere', galaxy.seed, host.id, null, living));
  if (brainHost) byHost.set(brainHost.id, createAnomaly('matrioshkaBrain', galaxy.seed, brainHost.id, null, living));
  if (thrusterHost) {
    const heading = normalize(thrusterHost.x - center.x, thrusterHost.y - center.y, thrusterHost.z);
    byHost.set(thrusterHost.id, createAnomaly('caplanThruster', galaxy.seed, thrusterHost.id, heading, living));
  }
  if (beamHost) {
    const target = brainHost ?? center;
    const direction = normalize(target.x - beamHost.x, target.y - beamHost.y, 0);
    byHost.set(beamHost.id, createAnomaly('nicollDysonBeam', galaxy.seed, beamHost.id, direction, living));
  }

  return { x: home.x, y: home.y, radius: ANOMALY_HOME_RADIUS, living, stage };
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

function placeHome(galaxy: Galaxy, hosts: readonly StarSystem[], civilization: Civilization, byHost: Map<number, Anomaly>): StarSystem | null {
  const free = hosts.filter((system) => !byHost.has(system.id));
  const settledHomeClass = free.filter((system) => HOME_CLASSES.has(system.starType) && isSettledPopulation(system));
  const tiers = [
    settledHomeClass.filter((system) => isInCivilization(system, civilization)),
    settledHomeClass,
    free,
  ];
  const host = nearestTo(tiers.find((tier) => tier.length > 0) ?? [], civilization);
  const { home: kind, homeSwarm } = CIVILIZATION_STAGE_PLANS[civilization.stage];
  if (host && kind) byHost.set(host.id, createAnomaly(kind, galaxy.seed, host.id, null, civilization.living, homeSwarm));
  return host;
}

function placePopulatedWorlds(
  galaxy: Galaxy,
  hosts: readonly StarSystem[],
  civilization: Civilization,
  byHost: ReadonlyMap<number, Anomaly>,
  home: StarSystem | null,
): ReadonlySet<number> {
  if (!civilization.living) return NO_ANOMALIES.populated;
  const populated = new Set<number>();
  if (home && !CIVILIZATION_STAGE_PLANS[civilization.stage].home) populated.add(home.id);
  const rng = createRng((galaxy.seed ^ POPULATED_SALT) >>> 0);
  const count = rollRange(rng, ANOMALY_STAGE_POPULATED[civilization.stage]);
  const candidates = hosts.filter((system) =>
    !byHost.has(system.id) && !populated.has(system.id) && isRelicClass(system) && isSettledPopulation(system) && isInCivilization(system, civilization));
  for (const system of pickManyWeighted(rng, candidates, count, () => 1)) populated.add(system.id);
  return populated;
}

function placeCannon(
  galaxy: Galaxy,
  hosts: readonly StarSystem[],
  civilization: Civilization,
  byHost: Map<number, Anomaly>,
  populated: ReadonlySet<number>,
) {
  if (!CIVILIZATION_STAGE_PLANS[civilization.stage].cannon) return;
  const free = hosts.filter((system) =>
    !byHost.has(system.id) && !populated.has(system.id) && isRelicClass(system) && isSettledPopulation(system));
  let host: StarSystem | null = null;
  let farthest = -Infinity;
  for (const system of free) {
    if (!isInCivilization(system, civilization)) continue;
    const distance = planeDistance(system, civilization);
    if (distance > farthest) {
      farthest = distance;
      host = system;
    }
  }
  host ??= nearestTo(free, civilization);
  if (!host) return;
  const direction = normalize(host.x - civilization.x, host.y - civilization.y, 0);
  byHost.set(host.id, createAnomaly('alcubierreCannon', galaxy.seed, host.id, direction, civilization.living));
}

export const NO_ANOMALIES: GalaxyAnomalies = { civilization: null, byHost: new Map(), populated: new Set() };

export function generateAnomalies(galaxy: Galaxy): GalaxyAnomalies {
  if (galaxy.seed === MILKY_WAY_SEED) return NO_ANOMALIES;
  const hosts = galaxy.systems.filter(canHostAnomaly);
  const byHost = new Map<number, Anomaly>();
  const civilization = placeCivilization(galaxy, hosts, byHost);
  placeBlackHoles(galaxy, hosts, byHost);
  if (!civilization) return { civilization, byHost, populated: NO_ANOMALIES.populated };
  const home = placeHome(galaxy, hosts, civilization, byHost);
  const populated = placePopulatedWorlds(galaxy, hosts, civilization, byHost, home);
  placeCannon(galaxy, hosts, civilization, byHost, populated);
  return { civilization, byHost, populated };
}

export function populatedWorldIds(galaxySeed: number): ReadonlySet<number> {
  return hasCivilization(galaxySeed) ? generateAnomalies(generateGalaxy(galaxySeed)).populated : NO_ANOMALIES.populated;
}
