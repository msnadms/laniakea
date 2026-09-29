import {
  FUEL_TANK_CAPACITY,
  MLY_PER_MPC,
  TECH_AWARD_BY_STAGE,
  TECH_AWARD_LIVING_BONUS,
  TECH_CAPACITY_PER_LEVEL,
  TECH_NODE_COSTS,
  TECH_SCAN_DECOY_PER_LEVEL,
  TECH_SCAN_PRECISION_PER_LEVEL,
  TECH_SPEED_TOP,
  UNIVERSE_SPEED_MAX,
} from './constants';
import type { CivilizationProfile } from './anomalies';

export type TechPath = 'capacity' | 'speed' | 'scanning';

export type TechLevels = Record<TechPath, number>;

export interface TechNode {
  name: string;
  blurb: string;
}

export interface TechBranch {
  title: string;
  nodes: readonly TechNode[];
}

export const TECH_PATHS: readonly TechPath[] = ['capacity', 'speed', 'scanning'];

export const TECH_MAX_LEVEL = TECH_NODE_COSTS.length;

export const NO_TECH: TechLevels = { capacity: 0, speed: 0, scanning: 0 };

export const TECH_ROOT_NAME = 'Ship Core';

export const TECH_TREE: Record<TechPath, TechBranch> = {
  capacity: {
    title: 'Condensate Capacity',
    nodes: [
      {
        name: 'Casimir Plate Stacking',
        blurb: 'Closely spaced conducting plates suppress vacuum fluctuations between them and leave a region of negative energy. Stacking millions of plates increases storage without enlarging the tank.',
      },
      {
        name: 'Squeezed-Vacuum Containment',
        blurb: 'Squeezed light pushes vacuum energy below zero in narrow bands. A resonant cavity holds those bands in place and slows their decay.',
      },
      {
        name: 'Van den Broeck Compression',
        blurb: 'A pocket of space with a tiny exterior and a large interior. The tank\'s volume grows while the hull stays the same size.',
      },
      {
        name: 'Morris–Thorne Throat Reservoir',
        blurb: 'A traversable wormhole throat requires exotic matter to stay open. Holding the throat near collapse turns it into a dense reservoir of condensate.',
      },
      {
        name: 'Planck-Density Condensate Lattice',
        blurb: 'Condensate is packed to the highest density spacetime permits. Known physics allows no further compression.',
      },
    ],
  },
  speed: {
    title: 'Maximum Speed',
    nodes: [
      {
        name: 'Toroidal Warp Geometry',
        blurb: 'Reshaping the warp field from a shell into a torus reduces its energy requirement by orders of magnitude. The savings go directly into speed.',
      },
      {
        name: 'Bubble Wall Thinning',
        blurb: 'A thinner bubble wall needs less exotic matter for each unit of expansion. The drive reaches higher speeds on the same fuel draw.',
      },
      {
        name: 'Natário Zero-Expansion Flow',
        blurb: 'The bubble slides space past the ship without compressing or expanding it. Lower tidal stress lets the drive run closer to its limits.',
      },
      {
        name: 'Lentz Positive-Energy Soliton',
        blurb: 'A soliton made mostly of positive energy carries the ship forward. Condensate is needed only at its edges to keep it from dispersing.',
      },
      {
        name: 'Krasnikov Transit Lattice',
        blurb: 'The ship lays a tube of modified spacetime along its route. Later passages through the tube are faster than light.',
      },
    ],
  },
  scanning: {
    title: 'Scanning',
    nodes: [
      {
        name: 'Hanbury Brown–Twiss Interferometry',
        blurb: 'Correlating intensity fluctuations between probes resolves sources far smaller than a single aperture can. Contacts narrow with each sweep.',
      },
      {
        name: 'Infrared Excess Photometry',
        blurb: 'Stellar collectors shed waste heat in the mid-infrared. Measuring this excess separates engineered stars from dusty ones.',
      },
      {
        name: 'Gravitational Lens Telescopy',
        blurb: 'Probes positioned along a star\'s focal line use its gravity as a lens. The magnification resolves structure across the cosmic web.',
      },
      {
        name: 'Technosignature Spectral Unmixing',
        blurb: 'Spectra are split into natural and artificial components before reporting. Fewer false readings reach the heat map.',
      },
      {
        name: 'Entangled Sensor Arrays',
        blurb: 'Entangled clocks remove phase noise between probes. The swarm measures as a single instrument as wide as the sweep.',
      },
    ],
  },
};

export function researchCost(level: number): number | null {
  return level < TECH_MAX_LEVEL ? TECH_NODE_COSTS[level] : null;
}

export function canResearch(levels: TechLevels, technology: number, path: TechPath): boolean {
  const cost = researchCost(levels[path]);
  return cost !== null && technology >= cost;
}

export function tankCapacity(level: number): number {
  return FUEL_TANK_CAPACITY + TECH_CAPACITY_PER_LEVEL * level;
}

export function maxFlightSpeed(level: number): number {
  return UNIVERSE_SPEED_MAX * Math.pow(TECH_SPEED_TOP / UNIVERSE_SPEED_MAX, level / TECH_MAX_LEVEL);
}

export function formatSpeedMpc(mlyPerSecond: number): string {
  return (mlyPerSecond / MLY_PER_MPC).toLocaleString('en-US', { maximumSignificantDigits: 3 });
}

export function scanPrecisionFactor(level: number): number {
  return 1 - TECH_SCAN_PRECISION_PER_LEVEL * level;
}

export function scanDecoyFactor(level: number): number {
  return 1 - TECH_SCAN_DECOY_PER_LEVEL * level;
}

export function technologyAward(profile: CivilizationProfile): number {
  return TECH_AWARD_BY_STAGE[profile.stage - 1] + (profile.living ? TECH_AWARD_LIVING_BONUS : 0);
}

export function techLevelsOf(value: unknown): TechLevels {
  const raw = (value ?? {}) as Partial<Record<TechPath, unknown>>;
  const level = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? Math.min(TECH_MAX_LEVEL, Math.max(0, v)) : 0);
  return { capacity: level(raw.capacity), speed: level(raw.speed), scanning: level(raw.scanning) };
}

export function isTechPath(value: unknown): value is TechPath {
  return value === 'capacity' || value === 'speed' || value === 'scanning';
}
