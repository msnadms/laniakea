import {
  BASE_HABITAT_POPULATION,
  BASE_HANGAR_UNITS,
  BASE_LEVEL_ALLOY_FACTORS,
  BASE_LEVEL_SECONDS,
  BASE_LEVEL_TECHNOLOGY,
  BASE_MAX_LEVEL,
  BASE_PLATFORM_LIMITS,
  BASE_VAULT_ALLOYS,
  BASE_VAULT_CONDENSATE,
} from './constants';

export type BuildingKind = 'command' | 'refinery' | 'siphon' | 'vault' | 'habitat' | 'shipyard' | 'hangar';

export type BuildingLevels = Record<BuildingKind, number>;

export interface BuildingSpec {
  name: string;
  blurb: string;
  alloys: number;
  crew: number;
}

export interface LevelCost {
  alloys: number;
  technology: number;
  crew: number;
  seconds: number;
}

export const BUILDING_KINDS: readonly BuildingKind[] = ['command', 'refinery', 'siphon', 'vault', 'habitat', 'shipyard', 'hangar'];

export const STARTING_BUILDINGS: BuildingLevels = { command: 1, refinery: 1, siphon: 1, vault: 1, habitat: 1, shipyard: 0, hangar: 0 };

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  command: {
    name: 'Command Nexus',
    blurb: 'The survivors govern the settlement from here. Its level bounds every other building, the number of crews at work and how many platforms can be held in orbit.',
    alloys: 120,
    crew: 0,
  },
  refinery: {
    name: 'Alloy Refinery',
    blurb: 'Strips the crust for metals and reworks them into alloys. A world around a quiet yellow star yields the most.',
    alloys: 60,
    crew: 3,
  },
  siphon: {
    name: 'Condensate Siphon',
    blurb: 'Draws negative-energy condensate out of the vacuum between the world and its moons, a little at a time.',
    alloys: 80,
    crew: 2,
  },
  vault: {
    name: 'Storage Vault',
    blurb: 'Deep, shielded stores for alloys and negative-energy condensate. Nothing collects beyond what the vault can hold.',
    alloys: 50,
    crew: 1,
  },
  habitat: {
    name: 'Habitat Ring',
    blurb: 'Room for the survivors to grow. The world itself still sets how many it can ever carry.',
    alloys: 60,
    crew: 0,
  },
  shipyard: {
    name: 'Shipyard',
    blurb: 'Lays down hulls in orbit. Corvettes first, then destroyers, and at last the cruisers that need recovered technology.',
    alloys: 100,
    crew: 4,
  },
  hangar: {
    name: 'Hangar',
    blurb: 'Berths for the fleet. Every hull takes room, and a cruiser takes a great deal of it.',
    alloys: 70,
    crew: 2,
  },
};

export function buildingCost(kind: BuildingKind, level: number): LevelCost | null {
  if (level >= BASE_MAX_LEVEL) return null;
  return {
    alloys: Math.round(BUILDINGS[kind].alloys * BASE_LEVEL_ALLOY_FACTORS[level]),
    technology: BASE_LEVEL_TECHNOLOGY[level],
    crew: BUILDINGS[kind].crew,
    seconds: BASE_LEVEL_SECONDS[level],
  };
}

export function buildingCrew(kind: BuildingKind, level: number): number {
  return BUILDINGS[kind].crew * level;
}

export function builderSlots(commandLevel: number): number {
  return 1 + Math.floor(Math.max(0, commandLevel - 1) / 2);
}

export function platformLimit(commandLevel: number): number {
  return BASE_PLATFORM_LIMITS[commandLevel];
}

export function alloyCapacity(vaultLevel: number): number {
  return BASE_VAULT_ALLOYS[vaultLevel];
}

export function condensateCapacity(vaultLevel: number): number {
  return BASE_VAULT_CONDENSATE[vaultLevel];
}

export function habitatCapacity(habitatLevel: number): number {
  return BASE_HABITAT_POPULATION[habitatLevel];
}

export function hangarCapacity(hangarLevel: number): number {
  return BASE_HANGAR_UNITS[hangarLevel];
}

export function shipyardQueueLength(shipyardLevel: number): number {
  return shipyardLevel;
}

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && (BUILDING_KINDS as readonly string[]).includes(value);
}
