import milkyway from './data/milkyway.json';
import laniakea from './data/laniakea.json';
import solSystem from './data/sol-system.json';
import type { StarType, ZoneType, Planet, AddressComponent } from './types';
import type { SystemLayout, PlanetLayout, MoonLayout } from './planetGen';

export const MILKY_WAY_SEED: number = milkyway.galaxySeed;
export const LANIAKEA_SEED: number = laniakea.superclusiterSeed;

export const MILKY_WAY_NAME: string = milkyway.galaxyName;
export const LANIAKEA_NAME: string = laniakea.superclusiterName;

export const NEARBY_SYSTEMS_DATA = milkyway.systems as Array<{
  id: number; x: number; y: number; name: string;
  starType: StarType; color: number; size: number; arm: number;
}>;

export const LANIAKEA_ATTRACTOR_NAMES: string[] = laniakea.attractorNames as string[];
export const VIRGO_ATTRACTOR_NAME: string = LANIAKEA_ATTRACTOR_NAMES[0];
export const MW_DOT_OFFSET: [number, number] = [laniakea.milkyWayDotOffsetX, laniakea.milkyWayDotOffsetY];

export const MILKY_WAY_NEBULA_COLOR_INDEX: number = milkyway.nebulaColorIndex;
export const MILKY_WAY_INNER_NEBULA_COLOR_INDEX: number = milkyway.innerNebulaColorIndex;

// Sol is system id=0, so its seed matches the galaxy seed.
export const SOL_SEED: number = MILKY_WAY_SEED;

export const SOL_SYSTEM_LAYOUT: SystemLayout = {
  seed: SOL_SEED,
  starType: 'G',
  asteroidGapIdx: solSystem.asteroidGapIdx,
  asteroidSeed: solSystem.asteroidSeed,
  planets: solSystem.layout as PlanetLayout[],
};

export const DEFAULT_ADDRESS: AddressComponent[] = [
  { name: 'Observable Universe', x: 0,   y: 0,   z: 0, type: 'universe'     },
  { name: LANIAKEA_NAME,         x: 0,   y: 0,   z: 0, type: 'supercluster' },
  { name: VIRGO_ATTRACTOR_NAME,  x: 0,   y: 0,   z: 0, type: 'attractor'    },
  { name: MILKY_WAY_NAME,        x: 0,   y: 0,   z: 0, type: 'galaxy'       },
  { name: 'Sol',                 x: 430, y: 100, z: 0, type: 'system'       },
];

export const SOL_SYSTEM_PLANETS: Planet[] = solSystem.planets.map((p) => ({
  name: p.name,
  type: p.type as ZoneType,
  resources: p.resources as Planet['resources'],
  moons: p.moons.map((m) => ({
    name: m.name,
    resources: m.resources as Planet['resources'],
  })),
}));
