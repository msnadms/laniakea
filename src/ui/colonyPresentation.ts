import { materialName } from '../data/materials';
import type { Colony, DistrictDefinition, MaterialCost, Resource } from '../game/types';
import { RESOURCE_LABELS } from '../game/types';
import { DISTRICTS } from '../data/districts';
import { districtBuildCost } from '../store/travelCosts';
import { colonyAmenityRatio, colonyContentment, colonyDemand, colonyJobSlots, isRareAssembly, NUTRIENTS_PER_PERSON_HOUR, useColonyStore } from '../store/colonyStore';

export function colonyRunwayHours(population: number, nutrients: number): number {
  return population > 0 ? nutrients / (population * NUTRIENTS_PER_PERSON_HOUR) : Infinity;
}

/** A district with none of its upkeep in store produces nothing at all, whatever its job table says. */
export function districtUpkeepShortfall(colony: Colony, district: DistrictDefinition): string[] {
  const count = colony.districts?.[district.id] ?? 0;
  if (count <= 0) return [];
  const raw = Object.entries(district.upkeep.raw ?? {}).flatMap(([type, rate]) =>
    (colony.supplies[type as Resource['type']] ?? 0) < (rate ?? 0) * count ? [RESOURCE_LABELS[type as Resource['type']]] : []);
  const materials = Object.entries(district.upkeep.materials ?? {}).flatMap(([id, rate]) =>
    ((id === 'sentinel_ammo' ? colony.ammo : colony.assemblies[id]) ?? 0) < rate * count ? [materialName(id)] : []);
  return [...raw, ...materials];
}

export function colonyNextAction(colony: ReturnType<typeof useColonyStore.getState>['colonies'][string]): string {
  if (!colony.foundedAt) return 'ready to charter, bring the ship';
  const runway = colonyRunwayHours(colony.population, colony.supplies.nutrients ?? 0);
  if (colony.starvationMs > 0 || runway < 0.25) return `starving, ${Math.max(0, Math.round(runway * 60))}m of food left`;
  const starved = DISTRICTS.flatMap(district => districtUpkeepShortfall(colony, district).map(label => `${district.name} out of ${label}`));
  if (starved.length) return starved[0].toLowerCase();
  const jobSlots = Object.values(colonyJobSlots(colony)).reduce((sum, count) => sum + count, 0);
  const idle = Math.max(0, Math.floor(colony.population - jobSlots));
  if (idle > 0) return jobSlots > 0 ? `${idle} idle pops, expand jobs` : `${idle} idle pops, no jobs`;
  const demand = colonyDemand(colony);
  const need = Object.entries(demand.materials).find(([, amount]) => amount > 0);
  if (need) return `needs ${Math.ceil(need[1])} ${materialName(need[0])}`;
  if (colonyContentment(colony) <= 0) return `crowded, amenities cover ${Math.round(colonyAmenityRatio(colony) * 100)}% of the need`;
  return 'stable, expand districts or exports';
}

export function districtBuildBlockers(
  colony: Colony,
  district: DistrictDefinition,
  freeSlots: number,
  hold: { materials: MaterialCost; rares: MaterialCost },
  fuel: { exotic: number; helium: number },
): string[] {
  const blockers: string[] = [];
  if (!colony.foundedAt) blockers.push('a chartered colony');
  if (freeSlots <= 0) blockers.push('a free district slot');
  for (const [material, count] of Object.entries(district.builtWith)) {
    const held = (isRareAssembly(material) ? hold.rares[material] : hold.materials[material]) ?? 0;
    if (held < count) blockers.push(`${count - held} more ${materialName(material)}`);
  }
  const cost = districtBuildCost();
  if (fuel.exotic < cost.exotic) blockers.push(`${Math.ceil(cost.exotic - fuel.exotic)} more exotic matter`);
  if (fuel.helium < cost.helium) blockers.push(`${Math.ceil(cost.helium - fuel.helium)} more helium-3`);
  return blockers;
}
