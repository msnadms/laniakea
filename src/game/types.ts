import type { GalaxyConfig } from "./galaxyConfig";

export type GalaxyType = 'spiral' | 'barred' | 'elliptical' | 'irregular';

export const GALAXY_TYPE_LABELS: Record<GalaxyType, string> = {
  spiral: 'Spiral',
  barred: 'Barred Spiral',
  elliptical: 'Elliptical',
  irregular: 'Irregular',
};

export type StarPopulation = 'bulge' | 'disk' | 'arm' | 'bar' | 'halo' | 'starburst';

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

// x and y are galactic-plane coordinates; z is height above that plane.
export interface StarSystem {
  id: number;
  x: number;
  y: number;
  z: number;
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
  type: 'exotic' | 'alloys' | 'nutrients' | 'helium-3' | 'metallicHydrogen' | 'neutronStarMatter' | 'alienMatter'
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
  /** Units left in the ground on every collection, honored by every route. */
  reserve?: number;
}

export interface RouteEdge {
  from: string;
  to: string;
  /** Undefined means all raw cargo is allowed (save-data compatible default). */
  allowedRaw?: Resource['type'][];
  /** Undefined means all crafted materials are allowed. */
  allowedMaterials?: string[];
  /** Caps material units per dispatch, including how much stockpile a fabricator may draw. */
  materialDraw?: number;
  overflow?: 'hold' | 'stockpile';
}

export type RouteDispatchMode = 'fill' | 'batch';
export type RouteFillAggregate = 'any' | 'all' | 'weighted';

export interface RouteAutomationPolicy {
  dispatchMode: RouteDispatchMode;
  sourceFillPercent: number;
  fillAggregate: RouteFillAggregate;
  detectionCeiling: number;
  pauseOnJam: boolean;
}

export interface LogisticsRoute {
  id: string;
  name: string;
  edges: RouteEdge[];
  /** Transitional input used only while converting pre-DAG route saves. */
  legacyNodeKeys?: string[];
  active?: boolean;
  automation?: RouteAutomationPolicy;
  heldCargo?: Record<string, {
    raw: Partial<Record<Resource['type'], number>>;
    materials: MaterialCost;
  }>;
}

export function extractorNodeId(galaxySeed: number, systemId: number): string {
  return `${galaxySeed}|${systemId}`;
}

export function fabricatorNodeId(galaxySeed: number, systemId: number): string {
  return `fabricator:${galaxySeed}|${systemId}`;
}

export function makeExtractorKey(galaxySeed: number, systemId: number, planetName: string): ExtractorKey {
  return `${galaxySeed}|${systemId}|${planetName}`;
}

export type FabricatorKey = string;

export type ColonyKey = string;
export type DistrictId = 'farm_district' | 'research_district' | 'civilian_district';
export type JobType = 'farmer' | 'researcher' | 'steward';
export interface Colony {
  key: ColonyKey;
  fabricatorKey: FabricatorKey;
  galaxySeed: number; systemId: number; systemName: string; planetName: string;
  systemX: number; systemY: number; galaxyX: number; galaxyY: number; superclusSeed: number;
  /** Zero while the charter's delivered demand is being assembled. */
  foundedAt: number;
  population: number;
  districts: Record<DistrictId, number>;
  jobPriority: JobType[];
  produced: MaterialCost;
  supplies: Partial<Record<Resource['type'], number>>;
  assemblies: MaterialCost;
  /** Standing per-assembly order the colony advertises to routes and keeps back from export. */
  requested: MaterialCost;
  lastTickAt: number; lastFireAt: number; lastProbeEscapeAt: number;
  ammo: number; localHeat: number;
  fedMs: number; starvationMs: number; lostPeople: number;
  planetaryProgressMs: number;
  project: 'dyson' | 'probes' | null;
  projectDelivered: MaterialCost;
  swarmComplete: boolean;
  probeCoverage: number;
  amenityRatio?: number;
  districtModel?: boolean;
  districtSlots?: number;
}

export type LegacyColony = Omit<Colony, 'districts' | 'jobPriority' | 'produced' | 'planetaryProgressMs' | 'districtModel'> & {
  installed: Record<string, number>;
  exportedLines: number;
  labor: number;
  populationTier: number;
  selfSufficientMs: number;
  lastShipmentAt: number;
};

export const makeColonyKey = makeFabricatorKey;
export function colonyNodeId(galaxySeed: number, systemId: number): string {
  return `colony:${galaxySeed}|${systemId}`;
}
export interface CannonStrike {
  superclusSeed: number;
  targetName: string;
  arrivesAt: number;
}

export type FabricatorTier = 1 | 2;

export interface Fabricator {
  key: FabricatorKey;
  tier: FabricatorTier;
  galaxySeed: number;
  systemId: number;
  systemName: string;
  planetName: string;
  builtAt: number;
  systemX: number;
  systemY: number;
  galaxyX: number;
  galaxyY: number;
  superclusSeed: number;
  drawFromHold?: boolean;
  fillMode?: SlotFillMode;
}

export function makeFabricatorKey(galaxySeed: number, systemId: number, planetName: string): FabricatorKey {
  return `${galaxySeed}|${systemId}|${planetName}`;
}

export const FABRICATOR_TIER_LABELS: Record<FabricatorTier, string> = {
  1: 'Fabricator',
  2: 'Advanced Fabricator',
};

export type CraftCategory = 'material' | 'extractor' | 'rare';

export interface FabricatorProductionItem {
  upgradeId: string;
  category: CraftCategory;
  count: number;
}

export interface FabricatorProductionSlot {
  targetUpgradeId: string | null;
  pendingResources: Partial<Record<Resource['type'], number>>;
  pendingMaterials: Record<string, number>;
  byproducts: MaterialCost;
  priority: number;
}

export interface FabricatorState {
  slots: FabricatorProductionSlot[];
}

export function makeEmptyFabricatorSlot(): FabricatorProductionSlot {
  return {
    targetUpgradeId: null,
    pendingResources: {},
    pendingMaterials: {},
    byproducts: {},
    priority: 0,
  };
}

export const FABRICATOR_BUFFER_DEPTH: Record<FabricatorTier, number> = { 1: 3, 2: 5 };

export function bufferDepth(tier: FabricatorTier | undefined): number {
  return FABRICATOR_BUFFER_DEPTH[tier ?? 1];
}

export type SlotStatus = 'idle' | 'ready' | 'starved' | 'jammed' | 'flowing';

export type SlotFillMode = 'priority' | 'shared';

export const SLOT_FILL_MODE_LABELS: Record<SlotFillMode, string> = {
  priority: 'Priority',
  shared: 'Shared',
};

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  idle: 'Idle',
  ready: 'Ready',
  starved: 'Starved',
  jammed: 'Jammed',
  flowing: 'Flowing',
};

export const FABRICATOR_INCLUDED_SLOTS: Record<FabricatorTier, number> = { 1: 5, 2: 8 };
export const FABRICATOR_MAX_SLOTS: Record<FabricatorTier, number> = { 1: 6, 2: 8 };
export const MAX_FABRICATOR_SLOTS = 8;
export const FABRICATOR_COST = { alloys: 2000, helium3: 500, nutrients: 2000, metallicHydrogen: 500 } as const;
export const FABRICATOR_UPGRADE_COST = { alloys: 1500, helium3: 1000, nutrients: 1500, metallicHydrogen: 1200 } as const;
export const FABRICATOR_UPGRADE_MATERIALS: MaterialCost = { hea_billet: 2, ybco_tape: 1, metamaterial_film: 1 };
export function includedFabricatorSlots(tier: FabricatorTier | undefined): number {
  return FABRICATOR_INCLUDED_SLOTS[tier ?? 1];
}

export function maxFabricatorSlots(tier: FabricatorTier | undefined): number {
  return FABRICATOR_MAX_SLOTS[tier ?? 1];
}

// Maps recipe cost keys to Resource['type'] values
export const COST_KEY_TO_RESOURCE: Record<string, Resource['type']> = {
  alloys: 'alloys',
  exotic: 'exotic',
  helium: 'helium-3',
  nutrients: 'nutrients',
  metallicHydrogen: 'metallicHydrogen',
  neutronStarMatter: 'neutronStarMatter',
  alienMatter: 'alienMatter',
};

export const RESOURCE_LABELS: Record<Resource['type'], string> = {
  exotic: 'Exotic Matter',
  alloys: 'Alloys',
  nutrients: 'Nutrients',
  'helium-3': 'Helium-3',
  metallicHydrogen: 'Metallic Hydrogen',
  neutronStarMatter: 'Neutron Star Matter',
  alienMatter: 'Alien Matter',
};

export const RAW_TYPES: Resource['type'][] = ['exotic', 'alloys', 'nutrients', 'helium-3', 'metallicHydrogen', 'neutronStarMatter', 'alienMatter'];

export type UpgradeType = 'rate' | 'storage' | 'detection';

export interface UpgradeEffect {
  upgType: UpgradeType;
  multiplier: number;
}

export type ResourceCostKey =
  | 'alloys'
  | 'exotic'
  | 'helium'
  | 'nutrients'
  | 'metallicHydrogen'
  | 'neutronStarMatter'
  | 'alienMatter';

export type ResourceCost = Partial<Record<ResourceCostKey, number>>;

export type MaterialCost = Record<string, number>;

export interface ExtractorUpgrade {
  id: string;
  name: string;
  cost: ResourceCost;
  materials: MaterialCost;
  effect: UpgradeEffect;
}

export interface CraftMaterial {
  id: string;
  name: string;
  tier: number;
  desc: string;
  cost: ResourceCost;
  materials: MaterialCost;
  outputs?: number;
  byproducts?: MaterialCost;
  produces?: string;
  byproductOnly?: boolean;
}

export interface RareResource {
  id: string;
  name: string;
  role: string;
  desc: string;
  cost: ResourceCost;
  materials: MaterialCost;
  effect?: { stat: 'popCap' | 'growth' | 'defense' | 'autonomy' | 'ectogenesis' | 'research'; value: number };
}

export interface DistrictOutput {
  raw?: Partial<Record<Resource['type'], number>>;
  materials?: MaterialCost;
  research?: number;
  amenities?: number;
}

export interface DistrictDefinition {
  id: DistrictId;
  name: string;
  description: string;
  builtWith: MaterialCost;
  jobs: number;
  job: JobType | null;
  /** Amenities the district provides from its buildings alone, before any worker staffs it. */
  baseAmenities?: number;
  output: DistrictOutput;
  upkeep: {
    raw?: Partial<Record<Resource['type'], number>>;
    materials?: MaterialCost;
  };
  anchor?: string;
  populationCap?: number;
  heat?: number;
}

export interface CivilizationResearchTier {
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  threshold: number;
  milestone: string;
  unlock: string;
}

export const RARE_ROLE_LABELS: Record<string, string> = {
  structure: 'Structural',
  power: 'Power',
  fuel: 'Fuel',
  field: 'Field Systems',
  life: 'Life Support',
  population: 'Ectogenesis',
};

export const MATERIAL_TIER_LABELS: Record<number, string> = {
  1: 'Refined',
  2: 'Engineered',
  3: 'Exotic',
  4: 'Alien',
};
