import { create } from 'zustand';
import type { Colony, DistrictId, Fabricator, JobType, LegacyColony, MaterialCost, Resource, StarType } from '../game/types';
import { RARE_RESOURCES } from '../data/rareResources';
import { materialName } from '../data/materials';
import { ANCHOR_DISTRICT, DEFAULT_JOB_PRIORITY, DISTRICTS, DISTRICT_BY_ID, LEGACY_DISTRICT_ID } from '../data/districts';
import { generateGalaxy } from '../game/galaxyGen';
import { generatePlanets, generateSystemLayout } from '../game/planetGen';
import { useUIStore, FIRE_COOLDOWN_MS, WRECK_HEAT_PER_KILL, probeEscapes, probeEscapeThreshold, detectionFloor, LOGISTICS_B_RATE, EXTRACTOR_HOLD_CAPS, computeLogisticsCap } from './uiStore';
import { useFabricatorStore } from './fabricatorStore';
import { useGameStore } from './gameStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers, ACCUMULATION_RATE_PER_MS } from './extractorStore';
import { useQuestStore } from './questStore';
import { useStockpileStore } from './stockpileStore';
import { useResearchStore } from './researchStore';
import { districtBuildCost, trySpendTravelCost } from './travelCosts';
import { researchThreshold } from '../data/research';

export const HOUR = 3_600_000;
export const CHARTER_LINES = 2;
export const CHARTER_ASSEMBLIES: MaterialCost = {
  closed_ecology_column: 1, zero_point_capacitor: 1,
  frame_dragging_gyro: 1, antihydrogen_reservoir: 1, ectogenesis_bank: 1,
};
const rareAssemblyIds = new Set(RARE_RESOURCES.map(resource => resource.id));
export const isRareAssembly = (id: string) => rareAssemblyIds.has(id);

/**
 * Charter assemblies may arrive on a route or be carried aboard the Peregrine.
 * Route deliveries are spent first so a completed local staging buffer is never
 * needlessly stranded when the ship provides the final missing piece.
 */
export function charterAssemblyAvailability(colony: Colony): MaterialCost {
  const stockpile = useStockpileStore.getState();
  return Object.fromEntries(Object.entries(CHARTER_ASSEMBLIES).map(([id, required]) => [id,
    Math.min(required, (colony.assemblies[id] ?? 0) + (rareAssemblyIds.has(id) ? stockpile.rares[id] ?? 0 : stockpile.materials[id] ?? 0)),
  ]));
}

export function canCharterWithAvailableAssemblies(colony: Colony): boolean {
  const available = charterAssemblyAvailability(colony);
  return Object.entries(CHARTER_ASSEMBLIES).every(([id, required]) => (available[id] ?? 0) >= required);
}
export const DYSON_COST: MaterialCost = { statite_mirror: 60, tpv_film: 60, momentum_tether: 30 };
export const PROBE_COST: MaterialCost = { replicator_probe: 30 };
export const DYSON_LABOR = 100;
export const PROBE_LABOR = 50;
// Extraction currently runs in real seconds: a mature 1000-person colony draws 5/s.
export const NUTRIENTS_PER_PERSON_HOUR = 18;
export const JOB_WEIGHT_MAX = 10;
export const DEFAULT_JOB_WEIGHT = 5;
export const MATURITY_POPULATION = 500;
export const MATURITY_INTERVAL = 6 * HOUR;
// Nothing simulates a closed tab, so an unattended gap is capped at the food a colony can hold.
export const MAX_UNATTENDED_MS = 2 * HOUR;
export const MAX_UNATTENDED_ESCAPES = 4;
export const COLONY_HEAT_PER_INDUSTRY_HOUR = 4;
export const COLONY_HEAT_DECAY_PER_HOUR = 2;
export const COLONY_SUPPLY_WINDOW_MS = 15 * 60_000;
// Arrivals are frequent, so one is worth well under an hour of one industry's signature.
export const COLONY_ARRIVAL_HEAT = 0.01;
export const COLONY_MIN_FOOD_STORE = 2000;
// Housing and entertainment. Residents need it directly, and every working district adds an off-shift load.
export const AMENITIES_PER_PERSON = 1.5;
export const AMENITIES_PER_WORKING_DISTRICT = 200;
export const AMENITY_GROWTH_FLOOR = 0.8;
export const COLONY_FUEL_CAP = 2000;
export const PROJECT_LABOR_PER_PERSON_HOUR = 0.01;

type LegacyFields = Pick<LegacyColony, 'installed' | 'exportedLines' | 'labor' | 'populationTier' | 'selfSufficientMs' | 'lastShipmentAt'>;

function legacyFields(colony: Colony | LegacyColony): Partial<LegacyFields> {
  return colony as Colony & Partial<LegacyFields>;
}

export function usesDistrictModel(colony: Colony | LegacyColony): boolean {
  return !!('districtModel' in colony && colony.districtModel) || (!!('districts' in colony && colony.districts) && !Object.keys(legacyFields(colony).installed ?? {}).length);
}

function stat(colony: Colony | LegacyColony, name: NonNullable<(typeof RARE_RESOURCES)[number]['effect']>['stat']) {
  const legacy = legacyFields(colony);
  return RARE_RESOURCES.reduce((total, assembly) => total + (assembly.effect?.stat === name
    ? (legacy.installed?.[assembly.id] ?? 0) * assembly.effect.value : 0), 0);
}
export const ECTOGENESIS_TIER_SIZE = RARE_RESOURCES.find(r => r.effect?.stat === 'ectogenesis')?.effect?.value ?? 1000;
export const colonyPopCap = (c: Colony) => usesDistrictModel(c)
  ? DISTRICTS.reduce((total, district) => total + (c.districts[district.id] ?? 0) * (district.populationCap ?? 0), 0)
  : Math.min(stat(c, 'popCap'), (legacyFields(c).populationTier ?? 0) * ECTOGENESIS_TIER_SIZE);
export const colonyAmenityDemand = (c: Colony) => {
  const assignments = filledJobs(c);
  return Math.max(0, c.population) * AMENITIES_PER_PERSON + DISTRICTS.reduce((total, district) => {
    const slots = (c.districts?.[district.id] ?? 0) * district.jobs;
    if (district.populationCap || !district.job || slots <= 0) return total;
    const staffed = Math.min(1, (assignments[district.job] ?? 0) / slots);
    return total + (c.districts?.[district.id] ?? 0) * AMENITIES_PER_WORKING_DISTRICT * staffed;
  }, 0);
};
export const colonyAmenityRatio = (c: Colony) => c.amenityRatio ?? 1;
/** Growth fades out as amenities fall short, so a colony settles where it can house and entertain itself. */
export const colonyContentment = (c: Colony) => Math.max(0, Math.min(1, (colonyAmenityRatio(c) - AMENITY_GROWTH_FLOOR) / (1 - AMENITY_GROWTH_FLOOR)));
export const colonyGrowthRate = (c: Colony) => usesDistrictModel(c) ? 0.1 * colonyContentment(c) : 0.1 + stat(c, 'growth') + stat(c, 'research');
export const colonyFuelCap = (c: Colony) => usesDistrictModel(c) ? COLONY_FUEL_CAP : stat(c, 'autonomy');
export function colonyDefense(c: Colony) {
  const batteries = usesDistrictModel(c) ? (c.districts?.defense_district ?? 0) : (stat(c, 'defense') > 0 ? 1 : 0);
  return { batteries, cooldownMs: 30_000 / Math.max(1, batteries) };
}

export function colonyFoodCapacity(c: Colony): number {
  return Math.max(COLONY_MIN_FOOD_STORE, colonyPopCap(c) * NUTRIENTS_PER_PERSON_HOUR * 2);
}

export const colonyDistrictsUsed = (c: Colony) => Object.values(c.districts ?? {}).reduce((sum, count) => sum + count, 0);

/** Districts are shipped down from the Peregrine's hold, not staged by drone route. */
export function hasDistrictMaterials(builtWith: MaterialCost): boolean {
  const stockpile = useStockpileStore.getState();
  return Object.entries(builtWith).every(([material, count]) =>
    ((rareAssemblyIds.has(material) ? stockpile.rares[material] : stockpile.materials[material]) ?? 0) >= count);
}

export function districtSlotsForRadius(radius: number): number {
  return Math.max(6, Math.min(12, Math.round(6 + (radius - 24) * 6 / 16)));
}

function planetDistrictSlots(seed: number, starType: StarType, planetName: string): number | undefined {
  const layout = generateSystemLayout(seed, starType);
  const planetIndex = generatePlanets(layout).findIndex(planet => planet.name === planetName);
  const radius = layout.planets[planetIndex]?.radius;
  return radius === undefined ? undefined : districtSlotsForRadius(radius);
}

const districtCapacityCache = new Map<string, number>();
export function clearDistrictCapacityCache(): void {
  districtCapacityCache.clear();
}
export function colonyDistrictCapacity(c: Colony): number {
  if (c.districtSlots !== undefined) return c.districtSlots;
  const cached = districtCapacityCache.get(c.key);
  if (cached !== undefined) return cached;
  const system = generateGalaxy(c.galaxySeed).systems.find(candidate => candidate.id === c.systemId);
  const capacity = system ? planetDistrictSlots(system.seed, system.starType, c.planetName) ?? 6 : 6;
  districtCapacityCache.set(c.key, capacity);
  return capacity;
}

export const jobWeight = (c: Colony, job: JobType) =>
  Math.max(0, Math.min(JOB_WEIGHT_MAX, c.jobWeights?.[job] ?? DEFAULT_JOB_WEIGHT));

/**
 * Weights split the residents proportionally, so a colony can staff three half-crewed districts
 * rather than filling one before the next sees anybody. Priority only orders the spill left over
 * when a job runs out of slots, and a job weighted to zero is never spilled into.
 */
export function filledJobs(c: Colony): Record<JobType, number> {
  const slots = colonyJobSlots(c);
  const result = Object.fromEntries(DEFAULT_JOB_PRIORITY.map(job => [job, 0])) as Record<JobType, number>;
  const order = [...new Set([...(c.jobPriority ?? []), ...DEFAULT_JOB_PRIORITY])];
  const population = Math.max(0, c.population);
  const total = order.reduce((sum, job) => sum + (slots[job] > 0 ? jobWeight(c, job) : 0), 0);
  let available = population;
  if (total > 0) for (const job of order) {
    const amount = Math.min(available, slots[job], population * jobWeight(c, job) / total);
    result[job] = amount;
    available -= amount;
  }
  for (const job of order) {
    if (available <= 0) break;
    if (jobWeight(c, job) <= 0) continue;
    const amount = Math.min(available, slots[job] - result[job]);
    result[job] += amount;
    available -= amount;
  }
  return result;
}

export function colonyJobSlots(c: Colony): Record<JobType, number> {
  const slots = Object.fromEntries(DEFAULT_JOB_PRIORITY.map(job => [job, 0])) as Record<JobType, number>;
  for (const district of DISTRICTS) if (district.job) slots[district.job] += (c.districts?.[district.id] ?? 0) * district.jobs;
  return slots;
}

/** Local factory output may leave by route; a colony keeps only what it has standing orders for. */
export function colonyExport(c: Colony): MaterialCost {
  if (!c.foundedAt || c.population <= 0) return {};
  const keep = (id: string) => c.requested?.[id] ?? 0;
  const source = usesDistrictModel(c) ? c.produced : c.assemblies;
  return Object.fromEntries(Object.entries(source).map(([id, amount]) => [id,
    Math.max(0, amount - keep(id)),
  ]).filter(([, amount]) => Number(amount) > 0));
}

export function colonyRawExport(c: Colony): Partial<Record<Resource['type'], number>> {
  if (!c.foundedAt || c.population <= 0 || !usesDistrictModel(c)) return {};
  const upkeep = DISTRICTS.reduce((totals, district) => {
    const count = c.districts[district.id] ?? 0;
    for (const [type, rate] of Object.entries(district.upkeep.raw ?? {})) totals[type as Resource['type']] = (totals[type as Resource['type']] ?? 0) + (rate ?? 0) * count;
    return totals;
  }, {} as Partial<Record<Resource['type'], number>>);
  // Exporting below the store a colony's own demand refills would sell food back to itself every dispatch.
  const reserves: Partial<Record<Resource['type'], number>> = {
    nutrients: colonyFoodCapacity(c),
    alloys: upkeep.alloys ?? 0,
  };
  return Object.entries(reserves).reduce((output, [type, reserve]) => {
    const amount = Math.max(0, (c.supplies[type as Resource['type']] ?? 0) - reserve);
    if (amount > 0) output[type as Resource['type']] = amount;
    return output;
  }, {} as Partial<Record<Resource['type'], number>>);
}

export function canBuildExtractor(galaxySeed: number, systemId: number): boolean {
  void galaxySeed;
  void systemId;
  return Object.keys(useExtractorStore.getState().extractors).length < computeLogisticsCap(useUIStore.getState().logisticsA);
}

export function charterSite(fabricator: Fabricator, now: number): Colony {
  const districts = Object.fromEntries(DISTRICTS.map(district => [district.id, 0])) as Record<DistrictId, number>;
  return {
    ...fabricator, fabricatorKey: fabricator.key, foundedAt: 0, population: 0,
    districts, jobPriority: [...DEFAULT_JOB_PRIORITY], jobWeights: {}, produced: {},
    supplies: {}, assemblies: {}, requested: {},
    lastTickAt: now, lastFireAt: now,
    lastProbeEscapeAt: now, localHeat: 0,
    fedMs: 0, starvationMs: 0, lostPeople: 0, planetaryProgressMs: 0,
    project: null, projectDelivered: {},
    swarmComplete: false, probeCoverage: 0, amenityRatio: 1,
  };
}

/**
 * Standing demand includes construction before a charter has living residents. A founded colony
 * advertises a delivery window rather than a whole reservoir, so it ramps up alongside the
 * fabricators sharing its edges instead of emptying them in one dispatch.
 */
export function colonyDemand(c: Colony): { raw: Partial<Record<Resource['type'], number>>; materials: MaterialCost } {
  const materials: MaterialCost = {};
  if (!c.foundedAt) {
    for (const [id, count] of Object.entries(CHARTER_ASSEMBLIES)) materials[id] = Math.max(0, count - (c.assemblies[id] ?? 0));
  } else {
    for (const [id, count] of Object.entries(c.requested ?? {})) materials[id] = Math.max(0, count - (c.assemblies[id] ?? 0));
    if (c.project) for (const [id, count] of Object.entries(c.project === 'dyson' ? DYSON_COST : PROBE_COST)) {
      materials[id] = (materials[id] ?? 0) + Math.max(0, count - (c.projectDelivered[id] ?? 0));
    }
  }
  const fuelCap = c.foundedAt ? colonyFuelCap(c) : COLONY_FUEL_CAP;
  const foodWindow = Math.max(500, c.population * NUTRIENTS_PER_PERSON_HOUR * COLONY_SUPPLY_WINDOW_MS / HOUR);
  const fuelWindow = Math.max(1, fuelCap / 4);
  const window = (cap: number, stored: number, chunk: number) => Math.max(0, Math.min(chunk, cap - stored));
  return { raw: {
    nutrients: window(colonyFoodCapacity(c), c.supplies.nutrients ?? 0, foodWindow),
    'helium-3': window(fuelCap, c.supplies['helium-3'] ?? 0, fuelWindow),
    exotic: window(fuelCap, c.supplies.exotic ?? 0, fuelWindow),
  }, materials };
}

/** Shared by the live route and its shadow preview. Never mutates input cargo. */
export function deliverColony(c: Colony, raw: Partial<Record<Resource['type'], number>>, materials: MaterialCost, _now: number) {
  const next = { ...c, supplies: { ...c.supplies }, assemblies: { ...c.assemblies }, projectDelivered: { ...c.projectDelivered }, districts: { ...c.districts } };
  const demand = colonyDemand(c);
  const consumedRaw: Partial<Record<Resource['type'], number>> = {};
  const consumedMaterials: MaterialCost = {};
  for (const [type, wanted] of Object.entries(demand.raw)) {
    const id = type as Resource['type'];
    const amount = Math.max(0, Math.min(wanted ?? 0, raw[id] ?? 0));
    if (!amount) continue;
    consumedRaw[id] = amount;
    next.supplies[id] = (next.supplies[id] ?? 0) + amount;
  }
  for (const [id, wanted] of Object.entries(demand.materials)) {
    const amount = Math.max(0, Math.min(wanted, materials[id] ?? 0));
    if (!amount) continue;
    consumedMaterials[id] = amount;
    let remaining = amount;
    if (remaining > 0 && c.project && id in (c.project === 'dyson' ? DYSON_COST : PROBE_COST)) {
      const projectCost = c.project === 'dyson' ? DYSON_COST : PROBE_COST;
      const take = Math.min(remaining, Math.max(0, projectCost[id] - (next.projectDelivered[id] ?? 0)));
      next.projectDelivered[id] = (next.projectDelivered[id] ?? 0) + take;
      remaining -= take;
    }
    if (remaining > 0) next.assemblies[id] = (next.assemblies[id] ?? 0) + remaining;
  }
  const changed = Object.keys(consumedRaw).length + Object.keys(consumedMaterials).length > 0;
  if (changed) next.localHeat += c.foundedAt ? COLONY_ARRIVAL_HEAT : 0;
  return { colony: next, consumedRaw, consumedMaterials, changed };
}

/** Exact logistic population and nutrient integral over a fed interval in hours. */
function growth(population: number, cap: number, rate: number, hours: number) {
  if (population <= 0 || cap <= 0) return { population, food: 0 };
  if (population >= cap || rate <= 0) return { population, food: population * hours * NUTRIENTS_PER_PERSON_HOUR };
  const a = cap / population - 1;
  const exponent = rate * hours;
  const logSum = exponent > 500 ? exponent : Math.log(Math.exp(exponent) + a);
  return {
    population: cap / (1 + a * Math.exp(-exponent)),
    food: NUTRIENTS_PER_PERSON_HOUR * cap / rate * (logSum - Math.log(1 + a)),
  };
}

/** Pure elapsed-time colony simulation; no clock, stores, or side effects. */
function tickLegacyColony(c: Colony, now: number, localFoodPerHour = 0, industryCount = 0, floor = 0, armed = colonyDefense(c).batteries > 0) {
  const currentLegacy = legacyFields(c);
  const next = { ...c, supplies: { ...c.supplies } } as Colony & Partial<LegacyFields>;
  let escapes = 0;
  let kills = 0;
  let lines = 0;
  if (now <= c.lastTickAt || !c.foundedAt || c.population <= 0) return { colony: next, escapes, kills, lines, research: 0 };
  // A closed tab is not a siege: unattended time is simulated only as far as a colony can stock for.
  const simStart = Math.max(c.lastTickAt, now - MAX_UNATTENDED_MS);
  const hours = (now - simStart) / HOUR;
  const food = Math.max(0, c.supplies.nutrients ?? 0);
  const full = growth(c.population, colonyPopCap(c), colonyGrowthRate(c), hours);
  let fedHours = hours;
  if (full.food > food) {
    let lo = 0, hi = hours;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (growth(c.population, colonyPopCap(c), colonyGrowthRate(c), mid).food <= food) lo = mid;
      else hi = mid;
    }
    fedHours = lo;
  }
  const fed = growth(c.population, colonyPopCap(c), colonyGrowthRate(c), fedHours);
  next.population = fed.population;
  next.supplies.nutrients = Math.max(0, food - fed.food);
  next.labor = (currentLegacy.labor ?? 0) + fed.food / NUTRIENTS_PER_PERSON_HOUR;
  const unfedMs = (hours - fedHours) * HOUR;
  // A half-hour reserve of time before whole people begin disappearing from the ledger.
  const previousStarvation = c.starvationMs;
  next.starvationMs = unfedMs > 0.0001 ? previousStarvation + unfedMs : 0;
  const loss = Math.min(next.population, Math.max(0, Math.max(0, next.starvationMs - HOUR / 2) / HOUR * 100
    - Math.max(0, previousStarvation - HOUR / 2) / HOUR * 100));
  next.population -= loss;
  next.lostPeople += loss;
  // Only fed time spent at maturity counts, and each population tier is worth one line.
  if (next.population >= MATURITY_POPULATION) {
    next.fedMs += fedHours * HOUR;
    lines = Math.max(0, Math.min(currentLegacy.populationTier ?? 0, Math.floor(next.fedMs / MATURITY_INTERVAL)) - (currentLegacy.exportedLines ?? 0));
    next.exportedLines = (currentLegacy.exportedLines ?? 0) + lines;
  }
  const selfFed = unfedMs <= 1 && localFoodPerHour >= next.population * NUTRIENTS_PER_PERSON_HOUR && (currentLegacy.lastShipmentAt ?? 0) <= simStart - HOUR;
  next.selfSufficientMs = selfFed ? (currentLegacy.selfSufficientMs ?? 0) + (now - simStart) : 0;
  // Simulate defense on a fixed weapon clock, including unattended elapsed time.
  const defense = colonyDefense(c);
  const stepMs = defense.cooldownMs;
  let heat = c.localHeat;
  // Every industry advertises, so the cost of defense rises smoothly with what the colony runs.
  const heatPerMs = (industryCount * COLONY_HEAT_PER_INDUSTRY_HOUR - COLONY_HEAT_DECAY_PER_HOUR) / HOUR;
  const escapeThreshold = probeEscapeThreshold(floor);
  let cursor = simStart;
  let fireAt = Math.max(c.lastFireAt + stepMs, simStart);
  while (fireAt <= now) {
    heat = Math.max(floor, heat + (fireAt - cursor) * heatPerMs);
    if (heat >= 1 && armed) {
      const salvaged = heat >= escapeThreshold;
      heat = Math.min(heat, Math.max(floor, heat - 1) + (salvaged ? WRECK_HEAT_PER_KILL : 0));
      if (salvaged) kills++;
    }
    if (probeEscapes(heat, armed, next.lastProbeEscapeAt, fireAt, floor)) { escapes++; next.lastProbeEscapeAt = fireAt; }
    cursor = fireAt;
    next.lastFireAt = fireAt;
    fireAt += stepMs;
    // Once unarmed, aggregate the identical escape intervals instead of stepping through them.
    if (!armed && heat >= escapeThreshold) {
      const first = Math.max(fireAt, next.lastProbeEscapeAt + FIRE_COOLDOWN_MS);
      if (first <= now) {
        const count = Math.floor((now - first) / FIRE_COOLDOWN_MS) + 1;
        escapes += count; next.lastProbeEscapeAt = first + (count - 1) * FIRE_COOLDOWN_MS;
      }
      next.lastFireAt = now; break;
    }
    // With heat pinned at the floor and no shot or escape possible, later steps are identical.
    if (heatPerMs <= 0 && heat < escapeThreshold && (heat < 1 || !armed)) {
      next.lastFireAt = now; break;
    }
  }
  next.localHeat = Math.min(5, Math.max(floor, heat + (now - cursor) * heatPerMs));
  next.lastTickAt = now;
  return { colony: next, escapes: Math.min(escapes, MAX_UNATTENDED_ESCAPES), kills, lines, research: 0 };
}

function tickDistrictColony(c: Colony, now: number, industryCount = 0, floor = 0) {
  if (now <= c.lastTickAt || !c.foundedAt || c.population <= 0) return { colony: { ...c, supplies: { ...c.supplies }, produced: { ...c.produced } }, escapes: 0, kills: 0, lines: 0, research: 0 };
  const simStart = Math.max(c.lastTickAt, now - MAX_UNATTENDED_MS);
  const hours = (now - simStart) / HOUR;
  const next: Colony = {
    ...c,
    supplies: { ...c.supplies },
    assemblies: { ...c.assemblies },
    produced: { ...c.produced },
    projectDelivered: { ...c.projectDelivered },
  };
  const assignments = filledJobs(c);
  let nutrientOutputPerHour = 0;
  let nutrientUpkeepPerHour = 0;
  let districtHeat = 0;
  let defenseCoverage = 0;
  let research = 0;
  let amenities = 0;
  for (const district of DISTRICTS) {
    const count = c.districts[district.id] ?? 0;
    if (count <= 0) continue;
    const rawUpkeep = district.upkeep.raw ?? {};
    const materialUpkeep = district.upkeep.materials ?? {};
    let efficiency = 1;
    for (const [type, rate] of Object.entries(rawUpkeep)) {
      const required = (rate ?? 0) * count * hours;
      if (required > 0) efficiency = Math.min(efficiency, (next.supplies[type as Resource['type']] ?? 0) / required);
      if (type === 'nutrients') nutrientUpkeepPerHour += (rate ?? 0) * count;
    }
    for (const [id, rate] of Object.entries(materialUpkeep)) {
      const required = rate * count * hours;
      if (required > 0) efficiency = Math.min(efficiency, (next.assemblies[id] ?? 0) / required);
    }
    efficiency = Math.max(0, Math.min(1, efficiency));
    for (const [type, rate] of Object.entries(rawUpkeep)) {
      const used = (rate ?? 0) * count * hours * efficiency;
      next.supplies[type as Resource['type']] = Math.max(0, (next.supplies[type as Resource['type']] ?? 0) - used);
    }
    for (const [id, rate] of Object.entries(materialUpkeep)) {
      const used = rate * count * hours * efficiency;
      next.assemblies[id] = Math.max(0, (next.assemblies[id] ?? 0) - used);
    }
    const workers = district.job ? assignments[district.job] : 0;
    const anchorEffect = district.anchor ? RARE_RESOURCES.find(resource => resource.id === district.anchor)?.effect : undefined;
    const modifier = anchorEffect?.stat === 'research' ? 1 + anchorEffect.value
      : anchorEffect?.stat === 'ectogenesis' ? 1 + anchorEffect.value / ECTOGENESIS_TIER_SIZE : 1;
    const active = workers * efficiency * modifier;
    const crewed = district.jobs > 0 ? Math.min(1, workers / (count * district.jobs)) * efficiency : efficiency;
    // An idle district still advertises; only a crewed one can quiet the sky or fire back.
    districtHeat += count * (district.heat ?? 0) * ((district.heat ?? 0) < 0 ? crewed : 1);
    if (district.id === 'defense_district') defenseCoverage = crewed;
    for (const [type, rate] of Object.entries(district.output.raw ?? {})) {
      const amount = (rate ?? 0) * active * hours;
      next.supplies[type as Resource['type']] = (next.supplies[type as Resource['type']] ?? 0) + amount;
      if (type === 'nutrients') nutrientOutputPerHour += (rate ?? 0) * active;
    }
    for (const [id, rate] of Object.entries(district.output.materials ?? {})) next.produced[id] = (next.produced[id] ?? 0) + rate * active * hours;
    research += (district.output.research ?? 0) * active * hours;
    amenities += count * (district.baseAmenities ?? 0) + (district.output.amenities ?? 0) * active;
  }
  const amenityDemand = colonyAmenityDemand(c);
  next.amenityRatio = amenityDemand > 0 ? amenities / amenityDemand : 1;
  if (next.project) next.projectDelivered.labor = (next.projectDelivered.labor ?? 0)
    + c.population * PROJECT_LABOR_PER_PERSON_HOUR * Math.min(1, next.amenityRatio) * hours;
  const slots = colonyJobSlots(c);
  const allSlots = Object.values(slots).reduce((sum, amount) => sum + amount, 0);
  const allFilled = allSlots > 0 && Object.values(assignments).reduce((sum, amount) => sum + amount, 0) >= allSlots;
  const foodPositive = nutrientOutputPerHour >= c.population * NUTRIENTS_PER_PERSON_HOUR + nutrientUpkeepPerHour;
  next.planetaryProgressMs = allFilled && foodPositive ? (c.planetaryProgressMs ?? 0) + (now - simStart) : 0;
  const result = tickLegacyColony(next, now, 0, industryCount + districtHeat, floor, defenseCoverage > 0);
  result.colony.planetaryProgressMs = next.planetaryProgressMs;
  result.colony.produced = next.produced;
  result.colony.projectDelivered = next.projectDelivered;
  result.colony.probeCoverage = next.probeCoverage;
  result.colony.amenityRatio = next.amenityRatio;
  result.lines = 0;
  result.research = research;
  return result;
}

export function tickColony(c: Colony, now: number, localFoodPerHour = 0, industryCount = 0, floor = 0) {
  return usesDistrictModel(c)
    ? tickDistrictColony(c, now, industryCount, floor)
    : tickLegacyColony(c, now, localFoodPerHour, industryCount, floor);
}

interface ColonyState {
  colonies: Record<string, Colony>;
  planCharter: (key: string, now?: number) => boolean;
  charterColony: (key: string, now?: number) => boolean;
  buildDistrict: (key: string, id: DistrictId) => boolean;
  demolishDistrict: (key: string, id: DistrictId, roll?: number) => boolean;
  setJobPriority: (key: string, priority: JobType[]) => void;
  setJobWeight: (key: string, job: JobType, weight: number) => void;
  startProject: (key: string, project: 'dyson' | 'probes') => boolean;
  tickColonies: (now: number) => { colonyKeys: string[]; extractorKeys: string[]; fabricatorKeys: string[] };
  evacuate: (key: string) => boolean;
  removeColony: (key: string) => void;
  restoreColonies: (colonies: (Colony | LegacyColony)[]) => void;
}

export const useColonyStore = create<ColonyState>((set, get) => ({
  colonies: {},
  planCharter: (key, now = Date.now()) => {
    const f = useFabricatorStore.getState().fabricators[key];
    if (!f || f.tier !== 2 || get().colonies[key] || useUIStore.getState().destroyed) return false;
    const system = useGameStore.getState().system;
    const districtSlots = system && system.id === f.systemId
      ? planetDistrictSlots(system.seed, system.starType, f.planetName) : undefined;
    set({ colonies: { ...get().colonies, [key]: { ...charterSite(f, now), districtSlots } } });
    return true;
  },
  charterColony: (key, now = Date.now()) => {
    const c = get().colonies[key];
    const game = useGameStore.getState();
    const ui = useUIStore.getState();
    const f = useFabricatorStore.getState().fabricators[key];
    if (!c || c.foundedAt || f?.tier !== 2 || ui.destroyed
      || game.galaxy.seed !== c.galaxySeed || game.system?.id !== c.systemId
      || game.system.planets?.find(p => p.name === c.planetName)?.type !== 'habitable'
      || !canCharterWithAvailableAssemblies(c)
      || !ui.spendGeneLine(CHARTER_LINES)) return false;
    const assemblies = { ...c.assemblies };
    const installed: MaterialCost = {};
    const districts = { ...c.districts };
    const stockpile = useStockpileStore.getState();
    const materials = { ...stockpile.materials };
    const rares = { ...stockpile.rares };
    for (const [id, count] of Object.entries(CHARTER_ASSEMBLIES)) {
      const delivered = Math.min(count, assemblies[id] ?? 0);
      assemblies[id] = (assemblies[id] ?? 0) - delivered;
      const fromPeregrine = count - delivered;
      if (fromPeregrine > 0) {
        const cargo = rareAssemblyIds.has(id) ? rares : materials;
        cargo[id] = (cargo[id] ?? 0) - fromPeregrine;
      }
      if (id !== 'ectogenesis_bank') installed[id] = count;
      const districtId = ANCHOR_DISTRICT[id];
      if (districtId) districts[districtId] = (districts[districtId] ?? 0) + count;
    }
    useStockpileStore.setState({ materials, rares });
    const founded: Colony = {
      ...c, foundedAt: now, lastTickAt: now, lastFireAt: now, population: 100,
      districtModel: true, districts, assemblies,
    };
    Object.defineProperty(founded, 'installed', { value: installed, enumerable: false });
    set({ colonies: { ...get().colonies, [key]: founded } });
    useQuestStore.getState().completeQuest('living_colony');
    return true;
  },
  buildDistrict: (key, id) => {
    const c = get().colonies[key];
    const district = DISTRICT_BY_ID[id];
    if (!c?.foundedAt || c.population <= 0 || !district || useUIStore.getState().destroyed) return false;
    if (colonyDistrictsUsed(c) >= colonyDistrictCapacity(c)) return false;
    if (!hasDistrictMaterials(district.builtWith)) { useUIStore.getState().triggerHudFlash(); return false; }
    if (!trySpendTravelCost(districtBuildCost())) return false;
    const stockpile = useStockpileStore.getState();
    const materials = { ...stockpile.materials };
    const rares = { ...stockpile.rares };
    for (const [material, count] of Object.entries(district.builtWith)) {
      const hold = rareAssemblyIds.has(material) ? rares : materials;
      hold[material] = (hold[material] ?? 0) - count;
    }
    useStockpileStore.setState({ materials, rares });
    set({ colonies: { ...get().colonies, [key]: { ...c, districts: { ...c.districts, [id]: (c.districts[id] ?? 0) + 1 } } } });
    return true;
  },
  demolishDistrict: (key, id, roll = Math.random()) => {
    const c = get().colonies[key];
    const district = DISTRICT_BY_ID[id];
    if (!c?.foundedAt || !district || (c.districts[id] ?? 0) <= 0 || useUIStore.getState().destroyed) return false;
    const districts = { ...c.districts, [id]: c.districts[id] - 1 };
    const cap = colonyPopCap({ ...c, districts });
    if (c.population > 0 && cap <= 0) {
      useUIStore.getState().triggerHudFlash();
      useUIStore.getState().triggerHudNotify(`${c.planetName}: razing the last civilian district would leave ${Math.floor(c.population)} people unhoused`);
      return false;
    }
    const salvage = Object.entries(district.builtWith);
    const [material, count] = salvage[Math.min(salvage.length - 1, Math.floor(roll * salvage.length))];
    const stockpile = useStockpileStore.getState();
    const hold = rareAssemblyIds.has(material) ? 'rares' as const : 'materials' as const;
    useStockpileStore.setState({ [hold]: { ...stockpile[hold], [material]: (stockpile[hold][material] ?? 0) + count } });
    const displaced = Math.max(0, c.population - cap);
    set({ colonies: { ...get().colonies, [key]: { ...c, districts, population: c.population - displaced, lostPeople: c.lostPeople + displaced } } });
    const ui = useUIStore.getState();
    ui.triggerHudNotify(displaced >= 1
      ? `${c.planetName}: ${district.name} razed, ${Math.floor(displaced)} people displaced · salvaged ${count} ${materialName(material)}`
      : `${c.planetName}: ${district.name} razed · salvaged ${count} ${materialName(material)}`);
    return true;
  },
  setJobPriority: (key, priority) => set(state => {
    const c = state.colonies[key];
    if (!c) return {};
    const normalized = [...new Set([...priority.filter(job => DEFAULT_JOB_PRIORITY.includes(job)), ...DEFAULT_JOB_PRIORITY])];
    return { colonies: { ...state.colonies, [key]: { ...c, jobPriority: normalized } } };
  }),
  setJobWeight: (key, job, weight) => set(state => {
    const c = state.colonies[key];
    if (!c || !DEFAULT_JOB_PRIORITY.includes(job)) return {};
    const clamped = Math.round(Math.max(0, Math.min(JOB_WEIGHT_MAX, weight)));
    return { colonies: { ...state.colonies, [key]: { ...c, jobWeights: { ...c.jobWeights, [job]: clamped } } } };
  }),
  startProject: (key, project) => {
    const c = get().colonies[key];
    const research = useResearchStore.getState().points;
    const allowed = c && usesDistrictModel(c)
      ? project === 'dyson' ? research >= researchThreshold(2) && useUIStore.getState().kardashevTier >= 1 : research >= researchThreshold(3) && useUIStore.getState().kardashevTier >= 2
      : project === 'dyson' ? useUIStore.getState().kardashevTier >= 1 : !!c?.swarmComplete;
    if (!c?.foundedAt || c.population <= 0 || c.project || !allowed || useUIStore.getState().destroyed || (project === 'dyson' ? c.swarmComplete : c.probeCoverage >= 1)) return false;
    set({ colonies: { ...get().colonies, [key]: { ...c, project, projectDelivered: {} } } });
    return true;
  },
  tickColonies: (now) => {
    const touched = { colonyKeys: [] as string[], extractorKeys: [] as string[], fabricatorKeys: [] as string[] };
    if (useUIStore.getState().destroyed) return touched;
    const snapshot = get().colonies;
    const updated: Record<string, Colony> = {};
    let research = 0;
    for (const original of Object.values(snapshot).sort((a,b) => a.key.localeCompare(b.key))) {
      if (!original.foundedAt || original.population <= 0 || now <= original.lastTickAt) continue;
      let c = { ...original, supplies: { ...original.supplies }, assemblies: { ...original.assemblies } };
      const ex = useExtractorStore.getState();
      const fs = useFabricatorStore.getState();
      const inSystem = (e: { galaxySeed: number; systemId: number }) => e.galaxySeed === c.galaxySeed && e.systemId === c.systemId;
      const peers = Object.values(snapshot).filter(x => x.foundedAt && x.population > 0 && inSystem(x)).sort((a,b) => a.key.localeCompare(b.key));
      const industries = [
        ...Object.values(ex.extractors).filter(inSystem).sort((a,b) => Number(b.resourceType === 'nutrients') - Number(a.resourceType === 'nutrients') || a.key.localeCompare(b.key)),
        ...Object.values(fs.fabricators).filter(x => inSystem(x) && !peers.some(p => p.fabricatorKey === x.key)).sort((a,b) => a.key.localeCompare(b.key)),
      ];
      const localExtractors = industries.filter((x): x is import('../game/types').Extractor => 'resourceType' in x);
      const localFabricators = [fs.fabricators[c.fabricatorKey], ...industries.filter((x): x is Fabricator => !('resourceType' in x))].filter((x): x is Fabricator => !!x);
      let localFood = 0;
      for (const e of localExtractors) {
        const capacity = e.resourceType === 'nutrients' ? colonyFoodCapacity(c) : 20_000;
        const available = Math.max(0, peekAccumulated(e, now) - (e.reserve ?? 0));
        const amount = ex.collectExtractor(e.key, Math.min(available, Math.max(0, capacity - (c.supplies[e.resourceType] ?? 0))), now);
        if (amount > 0) { c.supplies[e.resourceType] = (c.supplies[e.resourceType] ?? 0) + amount; touched.extractorKeys.push(e.key); }
        if (e.resourceType === 'nutrients') {
          const ui = useUIStore.getState();
          const multipliers = getExtractorMultipliers(e.key, ex.nodeEquipped);
          if ((e.reserve ?? 0) < EXTRACTOR_HOLD_CAPS[ui.storageB] * multipliers.storageMultiplier) {
            localFood += e.rate * multipliers.rateMultiplier * LOGISTICS_B_RATE[ui.logisticsB] * ACCUMULATION_RATE_PER_MS * HOUR;
          }
        }
      }
      const tick = tickColony(c, now, localFood, localExtractors.length + localFabricators.length, detectionFloor(useUIStore.getState().kardashevTier));
      c = tick.colony;
      research += tick.research;
      if (Math.floor(c.lostPeople) > Math.floor(original.lostPeople)) useUIStore.getState().triggerHudNotify(`${c.planetName}: ${Math.floor(c.lostPeople) - Math.floor(original.lostPeople)} people lost to starvation`);
      if (tick.lines) {
        useUIStore.getState().receiveGeneLine(tick.lines);
        useUIStore.getState().triggerHudNotify(`${c.planetName}: ${tick.lines} VIABLE LINES RETURNED TO THE VAULT`);
      }
      if (tick.escapes || tick.kills) {
        const ui = useUIStore.getState();
        useUIStore.setState({ exposure: ui.exposure + tick.escapes, alienMatter: ui.alienMatter + tick.kills });
      }
      // Protect the next hour's food before allocating industrial inputs.
      for (const f of c.population > 0 ? localFabricators : []) {
        const raw = { ...c.supplies, nutrients: Math.max(0, (c.supplies.nutrients ?? 0) - c.population * NUTRIENTS_PER_PERSON_HOUR) };
        const result = fs.feedFabricator(f.key, raw, c.assemblies, { remaining: 0 }, () => true, {});
        for (const [id, amount] of Object.entries(result.consumed)) c.supplies[id as Resource['type']] = Math.max(0, (c.supplies[id as Resource['type']] ?? 0) - (amount ?? 0));
        for (const [id, amount] of Object.entries(result.consumedCarried)) c.assemblies[id] = Math.max(0, (c.assemblies[id] ?? 0) - amount);
        for (const item of result.readyItems) {
          if (item.category === 'extractor') ex.receiveFabricatorItems([item]);
          else c.assemblies[item.upgradeId] = (c.assemblies[item.upgradeId] ?? 0) + item.count;
        }
        if (result.changed) touched.fabricatorKeys.push(f.key);
      }
      if (c.project && c.population > 0) {
        const cost = c.project === 'dyson' ? DYSON_COST : PROBE_COST;
        const labor = c.project === 'dyson' ? DYSON_LABOR : PROBE_LABOR;
        const availableLabor = usesDistrictModel(c) ? (c.projectDelivered.labor ?? 0) : (legacyFields(c).labor ?? 0);
        if (availableLabor >= labor && Object.entries(cost).every(([id, n]) => (c.projectDelivered[id] ?? 0) >= n)) {
          if (usesDistrictModel(c)) c.projectDelivered.labor = availableLabor - labor;
          else (c as Colony & Partial<LegacyFields>).labor = availableLabor - labor;
          if (c.project === 'dyson') c.swarmComplete = true;
          else c.probeCoverage = 1;
          c.project = null; c.projectDelivered = {};
        }
      }
      updated[c.key] = c;
      touched.colonyKeys.push(c.key);
    }
    if (touched.colonyKeys.length > 0) set({ colonies: { ...get().colonies, ...updated } });
    if (research > 0) useResearchStore.getState().addResearch(research);
    return touched;
  },
  evacuate: (key) => {
    const c = get().colonies[key];
    if (!c?.foundedAt || c.population <= 0 || useUIStore.getState().destroyed) return false;
    const strike = useUIStore.getState().strike;
    if (strike?.superclusSeed === c.superclusSeed && Date.now() >= strike.arrivesAt) return false;
    useUIStore.setState(s => ({ evacuatedPopulation: s.evacuatedPopulation + Math.floor(c.population), geneLines: s.geneLines + 1 }));
    get().removeColony(key);
    return true;
  },
  removeColony: (key) => set(s => {
    const colonies = { ...s.colonies }; delete colonies[key]; return { colonies };
  }),
  restoreColonies: (colonies) => set({ colonies: Object.fromEntries(colonies.map(c => [c.key, migrateColony(c)])) }),
}));

/** Old saves carry nine district kinds; the industrial ones have no successor and are dropped. */
function foldDistricts(saved: Record<string, number>): Record<DistrictId, number> {
  const districts = Object.fromEntries(DISTRICTS.map(district => [district.id, 0])) as Record<DistrictId, number>;
  for (const [id, count] of Object.entries(saved)) {
    const mapped = DISTRICT_BY_ID[id as DistrictId] ? id as DistrictId : LEGACY_DISTRICT_ID[id];
    if (mapped) districts[mapped] += count ?? 0;
  }
  return districts;
}

export function migrateColony(saved: Colony | LegacyColony): Colony {
  const legacy = legacyFields(saved);
  const { installed: _installed, exportedLines: _exportedLines, labor: _labor, populationTier: _populationTier, selfSufficientMs: _selfSufficientMs, lastShipmentAt: _lastShipmentAt, ammo: _ammo, ...current } = saved as Colony & Partial<LegacyFields> & { ammo?: number };
  if ('districts' in saved && saved.districts && saved.jobPriority && saved.produced) {
    return {
      ...current, districtModel: true, requested: saved.requested ?? {},
      districts: foldDistricts(saved.districts as Record<string, number>),
      jobPriority: [...new Set([...(saved.jobPriority as JobType[]).filter(job => DEFAULT_JOB_PRIORITY.includes(job)), ...DEFAULT_JOB_PRIORITY])],
    } as Colony;
  }
  const districts = Object.fromEntries(DISTRICTS.map(district => [district.id, 0])) as Record<DistrictId, number>;
  for (const [anchor, count] of Object.entries(legacy.installed ?? {})) {
    const districtId = ANCHOR_DISTRICT[anchor];
    if (districtId) districts[districtId] += count;
  }
  if ((legacy.populationTier ?? 0) > 0) districts.civilian_district = Math.max(districts.civilian_district, legacy.populationTier ?? 0);
  return {
    ...current,
    districtModel: true,
    districts,
    jobPriority: [...DEFAULT_JOB_PRIORITY],
    produced: {},
    planetaryProgressMs: 0,
    projectDelivered: { ...saved.projectDelivered, ...(legacy.labor ? { labor: legacy.labor } : {}) },
    requested: saved.requested ?? {},
  } as Colony;
}
