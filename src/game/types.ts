import type { GalaxyConfig } from "./galaxyConfig";

export type StarType = 'G' | 'K' | 'M' | 'F' | 'A' | 'L' | 'N';

export const STAR_TYPE_LABELS: Record<StarType, string> = {
  G: 'G-class (Yellow Dwarf)',
  K: 'K-class (Orange Dwarf)',
  M: 'M-class (Red Dwarf)',
  F: 'F-class (Yellow-White)',
  A: 'A-class (White)',
  L: 'L-class (Brown Dwarf)',
  N: 'N-class (Neutron Star)',
};

export interface StarSystem {
  id: number;
  x: number;
  y: number;
  name: string;
  starType: StarType;
  color: number;
  size: number;
  arm: number | null;
  seed: number;
  visited: boolean;
  current: boolean;
  planets?: Planet[];
}

export interface BackgroundStar {
  x: number;
  y: number;
  brightness: number;
}

export type Rng = () => number;

export interface Galaxy {
  systems: StarSystem[];
  backgroundStars: BackgroundStar[];
  config: GalaxyConfig;
  seed: number;
}

export interface SuperclusterAttractor {
  x: number;
  y: number;
  z: number;
  strength: number;
  name: string;
}

export interface SuperclusterFilament {
  from: number;
  to: number;
}

export interface SuperclusterDot {
  x: number;
  y: number;
  z: number;
  brightness: number;
  seed: number;
  name: string;
  visited: boolean;
  current: boolean;
}

export interface SuperclusterData {
  name: string;
  attractors: SuperclusterAttractor[];
  filaments: SuperclusterFilament[];
  dots: SuperclusterDot[];
  backgroundStars: BackgroundStar[];
  seed: number;
}

export interface Resource {
  type: 'exotic' | 'alloys' | 'nutrients' | 'helium-3' | 'metallicHydrogen' | 'neutronStarMatter'
  count: number;
}

export interface Moon {
  name: string;
  resources: Resource[] | null;
}

export interface Planet {
  name: string;
  type: ZoneType;
  resources: Resource[] | null;
  moons: Moon[];
}

export type ZoneType = 'hot' | 'marginal' | 'habitable' | 'gas' | 'ice';

export type AddressComponentType = 'universe' | 'supercluster' | 'attractor' | 'galaxy' | 'system'

export interface AddressComponent {
  name: string;
  x: number;
  y: number;
  z: number;
  type: AddressComponentType
}

export function buildAddressComponent(name: string, x: number, y: number, z: number, type: AddressComponentType) {
  return { name, x, y, z, type } as AddressComponent
}

export type ExtractorKey = string;

export interface Extractor {
  key: ExtractorKey;
  galaxySeed: number;
  systemId: number;
  systemName: string;
  planetName: string;
  resourceType: Resource['type'];
  rate: number;
  placedAt: number;
  lastCollectedAt: number;
  systemX: number;
  systemY: number;
  galaxyX: number;
  galaxyY: number;
  superclusSeed: number;
}

export interface LogisticsRoute {
  id: string;
  name: string;
  nodeKeys: string[];
}

export function makeExtractorKey(galaxySeed: number, systemId: number, planetName: string): ExtractorKey {
  return `${galaxySeed}|${systemId}|${planetName}`;
}

export type SettlementKey = string;

export interface Settlement {
  key: SettlementKey;
  galaxySeed: number;
  systemId: number;
  systemName: string;
  planetName: string;
  settledAt: number;
  systemX: number;
  systemY: number;
  galaxyX: number;
  galaxyY: number;
  superclusSeed: number;
}

export function makeSettlementKey(galaxySeed: number, systemId: number, planetName: string): SettlementKey {
  return `${galaxySeed}|${systemId}|${planetName}`;
}

export interface ColonyProductionItem {
  upgradeId: string;
  availableAt: number;
}

export interface ColonyProductionSlot {
  targetUpgradeId: string | null;
  pendingResources: Partial<Record<Resource['type'], number>>;
  inProduction: ColonyProductionItem | null;
}

export interface ColonyState {
  slots: ColonyProductionSlot[];
}

export function makeEmptyColonySlot(): ColonyProductionSlot {
  return { targetUpgradeId: null, pendingResources: {}, inProduction: null };
}

export const MAX_COLONY_SLOTS = 3;
export const COLONY_SLOT_COSTS: Array<{ alloys?: number; exotic?: number }> = [
  { alloys: 2000 },
  { alloys: 3000, exotic: 1500 },
];

// Maps EXTRACTOR_UPGRADES cost keys to Resource['type'] values
export const COST_KEY_TO_RESOURCE: Record<string, Resource['type']> = {
  alloys: 'alloys',
  exotic: 'exotic',
  helium: 'helium-3',
};

export const RESOURCE_LABELS: Record<Resource['type'], string> = {
  exotic: 'Exotic Matter',
  alloys: 'Alloys',
  nutrients: 'Nutrients',
  'helium-3': 'Helium-3',
  metallicHydrogen: 'Metallic Hydrogen',
  neutronStarMatter: 'Neutron Star Matter'
};

type UpgradeType = 'rate' | 'storage' | 'detection';

interface Effect {
  upgType: UpgradeType,
  multiplier: number
}

export interface ExtractorUpgrade {
  id: string;
  name: string;
  cost: { alloys?: number; exotic?: number; helium?: number };
  effect: Effect;
}

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = [
  {
    id: 'resonance_drill',
    name: 'Resonance Drill Head',
    cost: { alloys: 1 },
    effect: { upgType: 'rate', multiplier: 1.25 }
  },
  {
    id: 'thermal_coil',
    name: 'Thermal Extraction Coil',
    cost: { alloys: 1 },
    effect: { upgType: 'rate', multiplier: 1.5 }
  },
  {
    id: 'compression_manifold',
    name: 'Compression Manifold',
    cost: { alloys: 1500, exotic: 1500 },
    effect: { upgType: 'storage', multiplier: 1.25 }
  },
  {
    id: 'signal_dampener',
    name: 'Signal Dampener',
    cost: { exotic: 2500 },
    effect: { upgType: 'detection', multiplier: 1 }
  },
  {
    id: 'overcharge_module',
    name: 'Overcharge Module',
    cost: { alloys: 2000, helium: 2000 },
    effect: { upgType: 'rate', multiplier: 2 }
  },
];
