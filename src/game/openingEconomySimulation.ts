import { CRAFTABLE_MATERIALS } from '../data/materials';
import { getCraftable } from '../data/upgrades';
import { defaultSettings } from '../firebase/userDoc';
import { SOL_SYSTEM_PLANETS } from './hardcoded';
import { FABRICATOR_COST, FABRICATOR_UPGRADE_COST, FABRICATOR_UPGRADE_MATERIALS } from './types';
import type { MaterialCost, ResourceCost, ResourceCostKey } from './types';
import { CHARTER_ASSEMBLIES } from '../store/colonyStore';
import { EXTRACTOR_HOLD_CAPS } from '../store/uiStore';
import { effectiveExtractionPerHour, miningStationPaybackHours, MINING_STATION_COST } from './economy';

type RawLedger = Record<ResourceCostKey, number>;

const RAW_KEYS: ResourceCostKey[] = ['alloys', 'exotic', 'helium', 'nutrients', 'metallicHydrogen', 'neutronStarMatter', 'alienMatter'];
const SOL_STATION_CHOICES: Record<string, ResourceCostKey> = {
  Mercury: 'alloys', Jupiter: 'nutrients', Saturn: 'helium', Uranus: 'metallicHydrogen', Neptune: 'metallicHydrogen',
};

function emptyRaw(): RawLedger {
  return Object.fromEntries(RAW_KEYS.map(key => [key, 0])) as RawLedger;
}

function addRaw(target: RawLedger, cost: ResourceCost, batches = 1) {
  for (const [key, amount] of Object.entries(cost)) target[key as ResourceCostKey] += (amount ?? 0) * batches;
}

function craftTargets(targets: MaterialCost, raw = emptyRaw(), inventory: MaterialCost = {}) {
  const craft = (id: string, batches: number, stack: string[]) => {
    const recipe = getCraftable(id);
    if (!recipe) throw new Error(`No recipe produces ${id}`);
    for (const [materialId, amount] of Object.entries(recipe.materials)) {
      const required = amount * batches;
      ensure(materialId, required, [...stack, id]);
      inventory[materialId] -= required;
    }
    addRaw(raw, recipe.cost, batches);
    inventory[recipe.produces] = (inventory[recipe.produces] ?? 0) + recipe.outputs * batches;
    for (const [byproductId, amount] of Object.entries(recipe.byproducts)) {
      inventory[byproductId] = (inventory[byproductId] ?? 0) + amount * batches;
    }
  };
  const ensure = (id: string, wanted: number, stack: string[]) => {
    if ((inventory[id] ?? 0) >= wanted) return;
    if (stack.includes(id)) throw new Error(`Cyclic recipe dependency: ${[...stack, id].join(' -> ')}`);
    const recipe = getCraftable(id);
    const missing = wanted - (inventory[id] ?? 0);
    if (!recipe) {
      const source = CRAFTABLE_MATERIALS.find(material => (material.byproducts?.[id] ?? 0) > 0);
      if (!source) throw new Error(`No recipe produces ${id}`);
      craft(source.id, Math.ceil(missing / (source.byproducts?.[id] ?? 1)), [...stack, id]);
      return;
    }
    craft(id, Math.ceil(missing / recipe.outputs), stack);
  };

  for (const [id, amount] of Object.entries(targets)) ensure(id, amount, []);
  return { raw, inventory };
}

function timeToAfford(cost: RawLedger, starting: RawLedger, rates: RawLedger): number {
  return Math.max(0, ...RAW_KEYS.map(key => {
    const deficit = Math.max(0, cost[key] - starting[key]);
    return deficit === 0 ? 0 : rates[key] > 0 ? deficit / rates[key] : Infinity;
  }));
}

function solStationRatings(): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const planet of SOL_SYSTEM_PLANETS) {
    const type = SOL_STATION_CHOICES[planet.name];
    if (!type) continue;
    const resourceType = type === 'helium' ? 'helium-3' : type;
    ratings[planet.name] = [...(planet.resources ?? []), ...planet.moons.flatMap(moon => moon.resources ?? [])]
      .filter(resource => resource.type === resourceType)
      .reduce((sum, resource) => sum + resource.count, 0);
  }
  return ratings;
}

function solRates(): RawLedger {
  const rates = emptyRaw();
  for (const [planetName, rating] of Object.entries(solStationRatings())) {
    rates[SOL_STATION_CHOICES[planetName]] += effectiveExtractionPerHour(rating);
  }
  return rates;
}

function startingAfterExpeditionKit(): RawLedger {
  return {
    alloys: defaultSettings.alloys - FABRICATOR_COST.alloys - 5 * MINING_STATION_COST,
    exotic: defaultSettings.exoticMatter,
    helium: defaultSettings.helium3Reserves - FABRICATOR_COST.helium3,
    nutrients: defaultSettings.nutrients - FABRICATOR_COST.nutrients,
    metallicHydrogen: defaultSettings.metallicHydrogen - FABRICATOR_COST.metallicHydrogen,
    neutronStarMatter: defaultSettings.neutronMatter,
    alienMatter: defaultSettings.alienMatter,
  };
}

export interface OpeningEconomyReport {
  baselineRouteAvailable: boolean;
  basicFabricatorHours: number;
  firstTier1BatchHours: number;
  advancedFabricatorHours: number;
  completeCharterHours: number;
  representativeWorkshopHours: number;
  stationPaybackHours: Record<string, number>;
  solOnlyMaterialTierHours: Record<number, number>;
  networkMaterialTierHours: Record<number, number>;
  solOnlyCharterHours: number;
  holdOverflow: Record<number, { stored: number; overflow: number }>;
  longestIsolatedCharterInputHours: number;
}

export function simulateOpeningEconomy(): OpeningEconomyReport {
  const starting = startingAfterExpeditionKit();
  const sol = solRates();
  const nearby = { ...sol, alloys: sol.alloys + 20, nutrients: sol.nutrients + 40, metallicHydrogen: sol.metallicHydrogen + 20, exotic: 20, neutronStarMatter: 10 };
  const planner = craftTargets(FABRICATOR_UPGRADE_MATERIALS);
  addRaw(planner.raw, {
    alloys: FABRICATOR_UPGRADE_COST.alloys,
    helium: FABRICATOR_UPGRADE_COST.helium3,
    nutrients: FABRICATOR_UPGRADE_COST.nutrients,
    metallicHydrogen: FABRICATOR_UPGRADE_COST.metallicHydrogen,
  });
  for (const [id, amount] of Object.entries(FABRICATOR_UPGRADE_MATERIALS)) planner.inventory[id] -= amount;
  const advancedFabricatorHours = timeToAfford(planner.raw, starting, sol);
  craftTargets(CHARTER_ASSEMBLIES, planner.raw, planner.inventory);
  planner.raw.alloys += 100 + 3 * MINING_STATION_COST;
  const tierRequirements = Object.fromEntries([1, 2, 3].map(tier => {
    const tierTargets = Object.fromEntries(CRAFTABLE_MATERIALS.filter(material => material.tier === tier && !material.produces).map(material => [material.id, 1]));
    return [tier, craftTargets(tierTargets).raw];
  }));
  const charterDirectWaits = Object.keys(CHARTER_ASSEMBLIES).flatMap(id => {
    const recipe = getCraftable(id)!;
    return Object.entries(recipe.cost).map(([key, amount]) => (amount ?? 0) / nearby[key as ResourceCostKey]);
  }).filter(Number.isFinite);
  const ratingSixRate = effectiveExtractionPerHour(6);
  const hold = EXTRACTOR_HOLD_CAPS[0];
  return {
    baselineRouteAvailable: true,
    basicFabricatorHours: 0,
    firstTier1BatchHours: timeToAfford(craftTargets({ graphene_lattice: 1 }).raw, starting, sol),
    advancedFabricatorHours,
    completeCharterHours: timeToAfford(planner.raw, starting, nearby),
    representativeWorkshopHours: Math.max(0, (75 - starting.alloys) / sol.alloys),
    stationPaybackHours: Object.fromEntries(Object.entries(solStationRatings()).map(([planetName, rating]) => [planetName, miningStationPaybackHours(rating)])),
    solOnlyMaterialTierHours: Object.fromEntries(Object.entries(tierRequirements).map(([tier, requirements]) => [tier, timeToAfford(requirements, starting, sol)])),
    networkMaterialTierHours: Object.fromEntries(Object.entries(tierRequirements).map(([tier, requirements]) => [tier, timeToAfford(requirements, starting, nearby)])),
    solOnlyCharterHours: timeToAfford(planner.raw, starting, sol),
    holdOverflow: Object.fromEntries([1, 8, 24, 72].map(hours => [hours, {
      stored: Math.min(hold, ratingSixRate * hours), overflow: Math.max(0, ratingSixRate * hours - hold),
    }])),
    longestIsolatedCharterInputHours: Math.max(...charterDirectWaits),
  };
}
