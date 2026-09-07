import { create } from 'zustand';
import type { Colony, Fabricator, MaterialCost, Resource } from '../game/types';
import { RARE_RESOURCES } from '../data/rareResources';
import { useUIStore, FIRE_COST, FIRE_COOLDOWN_MS, WRECK_HEAT_PER_KILL, probeEscapes, probeEscapeThreshold, detectionFloor, LOGISTICS_B_RATE, EXTRACTOR_HOLD_CAPS, computeLogisticsCap } from './uiStore';
import { useFabricatorStore } from './fabricatorStore';
import { useGameStore } from './gameStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers, ACCUMULATION_RATE_PER_MS } from './extractorStore';
import { useQuestStore } from './questStore';
import { useStockpileStore } from './stockpileStore';

export const HOUR = 3_600_000;
export const CHARTER_LINES = 2;
export const CHARTER_ASSEMBLIES: MaterialCost = {
  closed_ecology_column: 1, zero_point_capacitor: 1,
  frame_dragging_gyro: 1, antihydrogen_reservoir: 1, ectogenesis_bank: 1,
};
const rareAssemblyIds = new Set(RARE_RESOURCES.map(resource => resource.id));

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
export const DYSON_LABOR = 10_000;
export const PROBE_LABOR = 5_000;
// Extraction currently runs in real seconds: a mature 1000-person colony draws 5/s.
export const NUTRIENTS_PER_PERSON_HOUR = 18;
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

function stat(colony: Colony, name: NonNullable<(typeof RARE_RESOURCES)[number]['effect']>['stat']) {
  return RARE_RESOURCES.reduce((total, assembly) => total + (assembly.effect?.stat === name
    ? (colony.installed[assembly.id] ?? 0) * assembly.effect.value : 0), 0);
}
export const ECTOGENESIS_TIER_SIZE = RARE_RESOURCES.find(r => r.effect?.stat === 'ectogenesis')?.effect?.value ?? 1000;
export const colonyPopCap = (c: Colony) => Math.min(stat(c, 'popCap'), c.populationTier * ECTOGENESIS_TIER_SIZE);
export const colonyGrowthRate = (c: Colony) => 0.1 + stat(c, 'growth');
export const colonyFuelCap = (c: Colony) => stat(c, 'autonomy');
export function colonyDefense(c: Colony) {
  const ammoCap = stat(c, 'defense');
  return { ammoCap, cooldownMs: 30_000 / Math.max(1, ammoCap / 40) };
}

export function colonyFoodCapacity(c: Colony): number {
  return Math.max(COLONY_MIN_FOOD_STORE, colonyPopCap(c) * NUTRIENTS_PER_PERSON_HOUR * 2);
}

/** Local factory output may leave by route; a colony keeps only what it has standing orders for. */
export function colonyExport(c: Colony): MaterialCost {
  if (!c.foundedAt || c.population <= 0) return {};
  const keep = (id: string) => (c.requested?.[id] ?? 0)
    + (id === 'sentinel_ammo' ? Math.max(0, colonyDefense(c).ammoCap - c.ammo) : 0);
  return Object.fromEntries(Object.entries(c.assemblies).map(([id, amount]) => [id,
    Math.max(0, amount - keep(id)),
  ]).filter(([, amount]) => Number(amount) > 0));
}

export function canBuildExtractor(galaxySeed: number, systemId: number): boolean {
  void galaxySeed;
  void systemId;
  return Object.keys(useExtractorStore.getState().extractors).length < computeLogisticsCap(useUIStore.getState().logisticsA);
}

export function charterSite(fabricator: Fabricator, now: number): Colony {
  return {
    ...fabricator, fabricatorKey: fabricator.key, foundedAt: 0, population: 0,
    installed: {}, supplies: {}, assemblies: {}, requested: {},
    lastTickAt: now, lastFireAt: now,
    lastProbeEscapeAt: now, ammo: 0, localHeat: 0, exportedLines: 0,
    fedMs: 0, starvationMs: 0, lostPeople: 0, labor: 0, populationTier: 0,
    selfSufficientMs: 0, lastShipmentAt: 0, project: null, projectDelivered: {},
    swarmComplete: false, probeCoverage: 0,
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
      materials[id] = Math.max(0, count - (c.projectDelivered[id] ?? 0));
    }
  }
  const ammoCap = c.foundedAt ? colonyDefense(c).ammoCap : 40;
  materials.sentinel_ammo = Math.max(0, ammoCap - c.ammo);
  const fuelCap = c.foundedAt ? colonyFuelCap(c) : 2000;
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
export function deliverColony(c: Colony, raw: Partial<Record<Resource['type'], number>>, materials: MaterialCost, now: number) {
  const next = { ...c, supplies: { ...c.supplies }, assemblies: { ...c.assemblies }, projectDelivered: { ...c.projectDelivered } };
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
    if (id === 'sentinel_ammo') next.ammo += amount;
    else if (c.project && id in (c.project === 'dyson' ? DYSON_COST : PROBE_COST)) next.projectDelivered[id] = (next.projectDelivered[id] ?? 0) + amount;
    else next.assemblies[id] = (next.assemblies[id] ?? 0) + amount;
  }
  const changed = Object.keys(consumedRaw).length + Object.keys(consumedMaterials).length > 0;
  if ((consumedRaw.nutrients ?? 0) > 0) next.lastShipmentAt = now;
  if (changed) next.localHeat += c.foundedAt ? COLONY_ARRIVAL_HEAT : 0;
  return { colony: next, consumedRaw, consumedMaterials, changed };
}

/** Exact logistic population and nutrient integral over a fed interval in hours. */
function growth(population: number, cap: number, rate: number, hours: number) {
  if (population <= 0 || cap <= 0) return { population, food: 0 };
  if (population >= cap) return { population, food: population * hours * NUTRIENTS_PER_PERSON_HOUR };
  const a = cap / population - 1;
  const exponent = rate * hours;
  const logSum = exponent > 500 ? exponent : Math.log(Math.exp(exponent) + a);
  return {
    population: cap / (1 + a * Math.exp(-exponent)),
    food: NUTRIENTS_PER_PERSON_HOUR * cap / rate * (logSum - Math.log(1 + a)),
  };
}

/** Pure elapsed-time colony simulation; no clock, stores, or side effects. */
export function tickColony(c: Colony, now: number, localFoodPerHour = 0, industryCount = 0, floor = 0) {
  const next: Colony = { ...c, supplies: { ...c.supplies } };
  let escapes = 0;
  let kills = 0;
  let lines = 0;
  if (now <= c.lastTickAt || !c.foundedAt || c.population <= 0) return { colony: next, escapes, kills, lines };
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
  next.labor += fed.food / NUTRIENTS_PER_PERSON_HOUR;
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
    lines = Math.max(0, Math.min(next.populationTier, Math.floor(next.fedMs / MATURITY_INTERVAL)) - c.exportedLines);
    next.exportedLines += lines;
  }
  const selfFed = unfedMs <= 1 && localFoodPerHour >= next.population * NUTRIENTS_PER_PERSON_HOUR && c.lastShipmentAt <= simStart - HOUR;
  next.selfSufficientMs = selfFed ? c.selfSufficientMs + (now - simStart) : 0;
  // Simulate defense on a fixed weapon clock, including unattended elapsed time.
  const defense = colonyDefense(c);
  const stepMs = defense.cooldownMs;
  let heat = c.localHeat;
  let ammo = c.ammo;
  // Every industry advertises, so the cost of defense rises smoothly with what the colony runs.
  const heatPerMs = (industryCount * COLONY_HEAT_PER_INDUSTRY_HOUR - COLONY_HEAT_DECAY_PER_HOUR) / HOUR;
  const escapeThreshold = probeEscapeThreshold(floor);
  let cursor = simStart;
  let fireAt = Math.max(c.lastFireAt + stepMs, simStart);
  while (fireAt <= now) {
    heat = Math.max(floor, heat + (fireAt - cursor) * heatPerMs);
    const available = defense.ammoCap > 0 && ammo >= FIRE_COST;
    if (heat >= 1 && available) {
      const salvaged = heat >= escapeThreshold;
      heat = Math.min(heat, Math.max(floor, heat - 1) + (salvaged ? WRECK_HEAT_PER_KILL : 0));
      ammo -= FIRE_COST;
      if (salvaged) kills++;
    }
    if (probeEscapes(heat, available, next.lastProbeEscapeAt, fireAt, floor)) { escapes++; next.lastProbeEscapeAt = fireAt; }
    cursor = fireAt;
    next.lastFireAt = fireAt;
    fireAt += stepMs;
    // Once unarmed, aggregate the identical escape intervals instead of stepping through them.
    if (ammo < FIRE_COST && heat >= escapeThreshold) {
      const first = Math.max(fireAt, next.lastProbeEscapeAt + FIRE_COOLDOWN_MS);
      if (first <= now) {
        const count = Math.floor((now - first) / FIRE_COOLDOWN_MS) + 1;
        escapes += count; next.lastProbeEscapeAt = first + (count - 1) * FIRE_COOLDOWN_MS;
      }
      next.lastFireAt = now; break;
    }
    // With heat pinned at the floor and no shot or escape possible, later steps are identical.
    if (heatPerMs <= 0 && heat < escapeThreshold && (heat < 1 || ammo < FIRE_COST)) {
      next.lastFireAt = now; break;
    }
  }
  next.localHeat = Math.min(5, Math.max(floor, heat + (now - cursor) * heatPerMs));
  next.ammo = ammo;
  next.lastTickAt = now;
  return { colony: next, escapes: Math.min(escapes, MAX_UNATTENDED_ESCAPES), kills, lines };
}

interface ColonyState {
  colonies: Record<string, Colony>;
  planCharter: (key: string, now?: number) => boolean;
  charterColony: (key: string, now?: number) => boolean;
  installAssembly: (key: string, id: string) => boolean;
  setRequest: (key: string, id: string, count: number) => void;
  startProject: (key: string, project: 'dyson' | 'probes') => boolean;
  tickColonies: (now: number) => { colonyKeys: string[]; extractorKeys: string[]; fabricatorKeys: string[] };
  evacuate: (key: string) => boolean;
  removeColony: (key: string) => void;
  restoreColonies: (colonies: Colony[]) => void;
}

export const useColonyStore = create<ColonyState>((set, get) => ({
  colonies: {},
  planCharter: (key, now = Date.now()) => {
    const f = useFabricatorStore.getState().fabricators[key];
    if (!f || f.tier !== 2 || get().colonies[key] || useUIStore.getState().destroyed) return false;
    set({ colonies: { ...get().colonies, [key]: charterSite(f, now) } });
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
    }
    useStockpileStore.setState({ materials, rares });
    set({ colonies: { ...get().colonies, [key]: {
      ...c, foundedAt: now, lastTickAt: now, lastFireAt: now, population: 100,
      installed, assemblies, populationTier: 1,
    } } });
    useQuestStore.getState().completeQuest('living_colony');
    return true;
  },
  installAssembly: (key, id) => {
    const c = get().colonies[key];
    const assembly = RARE_RESOURCES.find(r => r.id === id);
    if (!c?.foundedAt || c.population <= 0 || !assembly?.effect || (c.assemblies[id] ?? 0) < 1 || useUIStore.getState().destroyed) return false;
    if (assembly.effect.stat === 'ectogenesis' && c.population < c.populationTier * ECTOGENESIS_TIER_SIZE * 0.9) return false;
    set({ colonies: { ...get().colonies, [key]: {
      ...c, assemblies: { ...c.assemblies, [id]: c.assemblies[id] - 1 },
      installed: id === 'ectogenesis_bank' ? c.installed : { ...c.installed, [id]: (c.installed[id] ?? 0) + 1 },
      populationTier: c.populationTier + (id === 'ectogenesis_bank' ? 1 : 0),
    } } });
    return true;
  },
  setRequest: (key, id, count) => set(s => {
    const c = s.colonies[key];
    if (!c) return {};
    const requested = { ...c.requested };
    const wanted = Math.max(0, Math.floor(count));
    if (wanted > 0) requested[id] = wanted; else delete requested[id];
    return { colonies: { ...s.colonies, [key]: { ...c, requested } } };
  }),
  startProject: (key, project) => {
    const c = get().colonies[key];
    if (!c?.foundedAt || c.population <= 0 || c.project || useUIStore.getState().destroyed || (project === 'dyson' ? c.swarmComplete || useUIStore.getState().kardashevTier < 1 : !c.swarmComplete || c.probeCoverage >= 1)) return false;
    set({ colonies: { ...get().colonies, [key]: { ...c, project, projectDelivered: {} } } });
    return true;
  },
  tickColonies: (now) => {
    const touched = { colonyKeys: [] as string[], extractorKeys: [] as string[], fabricatorKeys: [] as string[] };
    if (useUIStore.getState().destroyed) return touched;
    const snapshot = get().colonies;
    const updated: Record<string, Colony> = {};
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
      const rounds = Math.min(c.assemblies.sentinel_ammo ?? 0, Math.max(0, colonyDefense(c).ammoCap - c.ammo));
      c.ammo += rounds;
      if (rounds) c.assemblies.sentinel_ammo -= rounds;
      if (c.project && c.population > 0) {
        const cost = c.project === 'dyson' ? DYSON_COST : PROBE_COST;
        const labor = c.project === 'dyson' ? DYSON_LABOR : PROBE_LABOR;
        if (c.labor >= labor && Object.entries(cost).every(([id, n]) => (c.projectDelivered[id] ?? 0) >= n)) {
          c.labor -= labor;
          if (c.project === 'dyson') c.swarmComplete = true;
          else c.probeCoverage = 1;
          c.project = null; c.projectDelivered = {};
        }
      }
      updated[c.key] = c;
      touched.colonyKeys.push(c.key);
    }
    if (touched.colonyKeys.length > 0) set({ colonies: { ...get().colonies, ...updated } });
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
  restoreColonies: (colonies) => set({ colonies: Object.fromEntries(colonies.map(c =>
    [c.key, { ...c, requested: c.requested ?? {} }])) }),
}));
