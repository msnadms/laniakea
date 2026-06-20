import type { GalaxyConfig } from "./galaxyConfig";

export type StarType = 'G' | 'K' | 'M' | 'F' | 'A' | 'L';

export const STAR_TYPE_LABELS: Record<StarType, string> = {
  G: 'G-class (Yellow Dwarf)',
  K: 'K-class (Orange Dwarf)',
  M: 'M-class (Red Dwarf)',
  F: 'F-class (Yellow-White)',
  A: 'A-class (White)',
  L: 'L-class (Brown Dwarf)',
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
  type: 'exotic' | 'alloys' | 'nutrients' | 'helium-3'
  count: number;
}

export interface Moon {
  name: string;
  resources: Resource[];
}

export interface Planet {
  name: string;
  type: ZoneType;
  resources: Resource[];
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
  planetName: string;
  resourceType: Resource['type'];
  rate: number;
  placedAt: number;
  lastCollectedAt: number;
}

export function makeExtractorKey(galaxySeed: number, systemId: number, planetName: string): ExtractorKey {
  return `${galaxySeed}|${systemId}|${planetName}`;
}
