import type { Rng, StarPopulation } from './types';
import type { GalaxyConfig } from './galaxyConfig';
import {
  GALAXY_RADIUS,
  BULGE_FRACTION,
  BULGE_RADIUS_FRACTION,
  BULGE_ELLIPSE,
  ARM_T_POWER,
  ARM_INNER_FRACTION,
  ARM_SPREAD,
  ARM_SPREAD_BASE,
  DISK_FRACTION,
  DISK_GAP_SCATTER,
  BAR_WIDTH,
  BAR_CLOUD_DENSITY,
  BAR_CLOUD_NEBULA_CHANCE,
  ELLIPTICAL_NEBULA_CLOUDS,
  ELLIPTICAL_NEBULA_EXTENT,
  ELLIPTICAL_NEBULA_FALLOFF,
  ELLIPTICAL_NEBULA_ALPHA_SCALE,
  BAR_FRACTION,
  BARRED_ARM_SPREAD_SCALE,
  BARRED_ARM_NEBULA_ALPHA_SCALE,
  BARRED_ARM_ROOT_NEBULA_SPREAD_SCALE,
  BARRED_ARM_ROOT_NEBULA_SPREAD_EXTENT,
  IRREGULAR_HAZE_FRACTION,
  IRREGULAR_HAZE_EXTENT,
  IRREGULAR_NEBULA_REACH,
  IRREGULAR_NEBULA_HOLE,
  IRREGULAR_GAS_EXTENT,
  IRREGULAR_GAS_OFFSET,
  IRREGULAR_HII_CHANCE,
  IRREGULAR_CLUMP_SIGMA,
  IRREGULAR_CORE_GLOW,
  IRREGULAR_CORE_SPREAD,
  BARRED_CORE_LENGTH_FRACTION,
  BARRED_CORE_BULGE_SCALE,
  BARRED_CORE_END_WIDTH,
  BARRED_CORE_LENS,
  BARRED_CORE_COUNT_SCALE,
  BARRED_CORE_PLATEAU,
  BARRED_CORE_FALLOFF,
  BARRED_CORE_ALPHA_SCALE,
  BARRED_CORE_FLATTENING,
  IRREGULAR_CORE_FLATTENING,
  CORE_ELLIPSE_X,
  CORE_ELLIPSE_Y,
  CORE_PARTICLE_COUNT,
  NEBULA_STEPS,
  NEBULA_PARTICLES_PER_STEP,
  NEBULA_SPREAD,
  NEBULA_RADIUS_MULTIPLIER,
  NEBULA_CLOUD_OFFSET,
} from './constants';

export interface StarPlacement {
  x: number;
  y: number;
  arm: number | null;
  armFraction: number | null;
  population: StarPopulation;
}

export interface NebulaCloud {
  x: number;
  y: number;
  t: number;
  spread: number;
  blobScale: number;
  count: number;
  nebulaChance: number;
  opacityScale?: number;
}

function defaultNebulaChance(t: number) {
  return t + 0.4;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function place(angle: number, radius: number, ellipse: number, orientation: number): [number, number] {
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius * ellipse;
  const cos = Math.cos(orientation);
  const sin = Math.sin(orientation);
  return [x * cos - y * sin, x * sin + y * cos];
}

export function rotate(x: number, y: number, orientation: number): [number, number] {
  const cos = Math.cos(orientation);
  const sin = Math.sin(orientation);
  return [x * cos - y * sin, x * sin + y * cos];
}

function bulgeStar(rng: Rng, config: GalaxyConfig): StarPlacement {
  const radius = Math.pow(rng(), 0.5) * GALAXY_RADIUS * BULGE_RADIUS_FRACTION;
  const angle = rng() * Math.PI * 2;
  const [x, y] = place(angle, radius, BULGE_ELLIPSE, config.orientation);
  return { x, y, arm: null, armFraction: null, population: 'bulge' };
}

function interArmStar(rng: Rng, config: GalaxyConfig, innerFraction: number): StarPlacement {
  const t = Math.pow(rng(), ARM_T_POWER);
  const radius = lerp(GALAXY_RADIUS * innerFraction, GALAXY_RADIUS, t);
  const gap = Math.floor(rng() * config.numArms);
  const gapCenterAngle = config.baseAngleOffset + ((gap + 0.5) / config.numArms) * Math.PI * 2 + t * Math.PI * config.spiralTwist;
  const angularScatter = (DISK_GAP_SCATTER * Math.PI / config.numArms) * (rng() - 0.5) * 2;
  const [x, y] = place(gapCenterAngle + angularScatter, radius, config.galaxyEllipse, config.orientation);
  return { x, y, arm: null, armFraction: null, population: 'disk' };
}

function armStar(rng: Rng, config: GalaxyConfig, innerFraction: number, baseAngleFor: (arm: number) => number): StarPlacement {
  const arm = Math.floor(rng() * config.numArms);
  const armFraction = Math.pow(rng(), ARM_T_POWER);
  const radius = lerp(GALAXY_RADIUS * innerFraction, GALAXY_RADIUS, armFraction);
  const spiralAngle = baseAngleFor(arm) + armFraction * Math.PI * config.spiralTwist;
  const spread = GALAXY_RADIUS * ARM_SPREAD * armSpreadScale(config) * (ARM_SPREAD_BASE + radius / GALAXY_RADIUS);
  const [cx, cy] = place(spiralAngle, radius, config.galaxyEllipse, config.orientation);
  const [ox, oy] = rotate(
    (rng() - 0.5) * 2 * spread,
    (rng() - 0.5) * 2 * spread * config.galaxyEllipse,
    config.orientation,
  );
  return { x: cx + ox, y: cy + oy, arm, armFraction, population: 'arm' };
}

function armSpreadScale(config: GalaxyConfig) {
  return config.type === 'barred' ? BARRED_ARM_SPREAD_SCALE : 1;
}

function spiralBaseAngle(config: GalaxyConfig, arm: number) {
  return (arm / config.numArms) * Math.PI * 2 + config.baseAngleOffset;
}

function barredBaseAngle(config: GalaxyConfig, arm: number) {
  return config.barAngle + (arm % 2) * Math.PI + Math.floor(arm / 2) * (Math.PI / config.numArms);
}

function barStar(rng: Rng, config: GalaxyConfig): StarPlacement {
  const along = (rng() - 0.5) * 2 * GALAXY_RADIUS * config.barLength;
  const across = ((rng() + rng()) / 2 - 0.5) * 2 * GALAXY_RADIUS * BAR_WIDTH;
  const [x, y] = rotate(along, across, config.orientation + config.barAngle);
  return { x, y, arm: null, armFraction: null, population: 'bar' };
}

function ellipticalStar(rng: Rng, config: GalaxyConfig): StarPlacement {
  const radius = GALAXY_RADIUS * Math.pow(rng(), config.concentration);
  const angle = rng() * Math.PI * 2;
  const [x, y] = place(angle, radius, config.axisRatio, config.orientation);
  return { x, y, arm: null, armFraction: null, population: 'halo' };
}

function gaussian(rng: Rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function irregularStar(rng: Rng, config: GalaxyConfig): StarPlacement {
  if (rng() < IRREGULAR_HAZE_FRACTION) {
    const radius = GALAXY_RADIUS * IRREGULAR_HAZE_EXTENT * Math.sqrt(rng());
    const angle = rng() * Math.PI * 2;
    const [x, y] = place(angle, radius, config.galaxyEllipse, config.orientation);
    return { x, y, arm: null, armFraction: null, population: 'disk' };
  }

  const totalWeight = config.clumps.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng() * totalWeight;
  let clump = config.clumps[config.clumps.length - 1];
  for (const candidate of config.clumps) {
    roll -= candidate.weight;
    if (roll <= 0) { clump = candidate; break; }
  }

  // a Gaussian has no hard edge, so clumps fade into each other and into the
  // haze rather than reading as discrete circles
  const sigma = clump.r * IRREGULAR_CLUMP_SIGMA;
  return {
    x: clump.x + gaussian(rng) * sigma,
    y: clump.y + gaussian(rng) * sigma * (0.75 + rng() * 0.5),
    arm: null,
    armFraction: rng() * 0.4,
    population: 'starburst',
  };
}

export function sampleStar(rng: Rng, config: GalaxyConfig): StarPlacement {
  if (config.type === 'elliptical') return ellipticalStar(rng, config);
  if (config.type === 'irregular') return irregularStar(rng, config);

  if (rng() < BULGE_FRACTION) return bulgeStar(rng, config);

  if (config.type === 'barred') {
    if (rng() < BAR_FRACTION) return barStar(rng, config);
    if (rng() < DISK_FRACTION) return interArmStar(rng, config, config.barLength);
    return armStar(rng, config, config.barLength, (arm) => barredBaseAngle(config, arm));
  }

  if (rng() < DISK_FRACTION) return interArmStar(rng, config, ARM_INNER_FRACTION);
  return armStar(rng, config, ARM_INNER_FRACTION, (arm) => spiralBaseAngle(config, arm));
}

export function edgeStar(rng: Rng, config: GalaxyConfig): [number, number] {
  const angle = rng() * Math.PI * 2;
  const radius = GALAXY_RADIUS * (0.82 + rng() * 0.26);
  const ellipse = config.type === 'elliptical' ? config.axisRatio : config.galaxyEllipse;
  return place(angle, radius, ellipse, config.orientation);
}

function armClouds(config: GalaxyConfig, innerFraction: number, baseAngleFor: (arm: number) => number): NebulaCloud[] {
  const clouds: NebulaCloud[] = [];
  // Surface brightness goes as count * spread / span, so an arm that starts further
  // out (shorter span) or is drawn wider has to shed particles to stay as bright as
  // a plain spiral's rather than blowing out.
  const density = (1 - innerFraction) / armSpreadScale(config);
  for (let arm = 0; arm < config.numArms; arm++) {
    const baseAngle = baseAngleFor(arm);
    for (let step = 0; step < NEBULA_STEPS; step++) {
      const t = (step + 1) / (NEBULA_STEPS + 1);
      const radius = lerp(GALAXY_RADIUS * innerFraction, GALAXY_RADIUS, t);
      const [x, y] = place(baseAngle + t * Math.PI * config.spiralTwist, radius, config.galaxyEllipse, config.orientation);

      const taper = Math.pow(1 - Math.max(0, (t - 0.90) / 0.10), 1.5);
      const nearCore = Math.hypot(x, y) < NEBULA_CLOUD_OFFSET;
      const rootTaper = config.type === 'barred'
        ? Math.pow(Math.max(0, 1 - t / BARRED_ARM_ROOT_NEBULA_SPREAD_EXTENT), 2)
        : 0;
      const rootSpreadScale = 1 + (BARRED_ARM_ROOT_NEBULA_SPREAD_SCALE - 1) * rootTaper;
      clouds.push({
        x,
        y,
        t,
        spread: GALAXY_RADIUS * NEBULA_SPREAD * armSpreadScale(config) * (0.35 + radius / GALAXY_RADIUS) * (0.5 + 0.5 * taper) * rootSpreadScale,
        blobScale: nearCore ? 1.5 : NEBULA_RADIUS_MULTIPLIER,
        count: nearCore ? 20 : Math.max(1, Math.round(NEBULA_PARTICLES_PER_STEP * taper * density)),
        nebulaChance: defaultNebulaChance(t),
        opacityScale: config.type === 'barred' ? BARRED_ARM_NEBULA_ALPHA_SCALE : 1,
      });
    }
  }
  return clouds;
}

function barClouds(config: GalaxyConfig): NebulaCloud[] {
  const clouds: NebulaCloud[] = [];
  const steps = Math.round(NEBULA_STEPS * 0.6);
  for (let step = 0; step < steps; step++) {
    const along = lerp(-1, 1, step / (steps - 1)) * GALAXY_RADIUS * config.barLength;
    const [x, y] = rotate(along, 0, config.orientation + config.barAngle);
    const t = Math.abs(along) / GALAXY_RADIUS;
    clouds.push({
      x,
      y,
      t,
      spread: GALAXY_RADIUS * BAR_WIDTH * 0.9,
      blobScale: NEBULA_RADIUS_MULTIPLIER,
      count: Math.round(NEBULA_PARTICLES_PER_STEP * BAR_CLOUD_DENSITY),
      nebulaChance: BAR_CLOUD_NEBULA_CHANCE,
    });
  }
  return clouds;
}

// Sampled continuously rather than on shells of fixed angles: repeating the same
// angles at every radius stacks the clouds into radial spokes.
function ellipticalClouds(rng: Rng, config: GalaxyConfig): NebulaCloud[] {
  const clouds: NebulaCloud[] = [];
  for (let i = 0; i < ELLIPTICAL_NEBULA_CLOUDS; i++) {
    const t = Math.pow(rng(), ELLIPTICAL_NEBULA_FALLOFF);
    const radius = GALAXY_RADIUS * ELLIPTICAL_NEBULA_EXTENT * t;
    const angle = rng() * Math.PI * 2;
    const [x, y] = place(angle, radius, config.axisRatio, config.orientation);
    const taper = Math.pow(1 - Math.max(0, (t - 0.65) / 0.35), 1.5);
    clouds.push({
      x,
      y,
      t,
      spread: GALAXY_RADIUS * NEBULA_SPREAD * (0.55 + t * 0.75),
      blobScale: NEBULA_RADIUS_MULTIPLIER * lerp(2.2, 1.3, t),
      count: Math.max(1, Math.round(NEBULA_PARTICLES_PER_STEP * 0.06 * taper)),
      nebulaChance: defaultNebulaChance(t),
      opacityScale: ELLIPTICAL_NEBULA_ALPHA_SCALE,
    });
  }
  return clouds;
}

// Two components, matching how gas actually sits in a dwarf irregular: a broad
// lopsided envelope of neutral hydrogen that reaches well past the starlight and
// ignores where the stars are, plus ionized knots on the minority of star clumps
// that currently host hot young stars.
function irregularClouds(rng: Rng, config: GalaxyConfig): NebulaCloud[] {
  const clouds: NebulaCloud[] = [];

  const paletteT = (x: number, y: number, floor: number) =>
    Math.min(1, floor + (1 - floor) * (Math.hypot(x, y) / GALAXY_RADIUS));

  const offsetAngle = rng() * Math.PI * 2;
  const offsetDist = GALAXY_RADIUS * IRREGULAR_GAS_OFFSET * rng();
  const envelopeX = Math.cos(offsetAngle) * offsetDist;
  const envelopeY = Math.sin(offsetAngle) * offsetDist;
  const envelopeSquash = 0.6 + rng() * 0.7;
  const envelopeSteps = Math.round(NEBULA_STEPS * 1.4);

  for (let step = 0; step < envelopeSteps; step++) {
    const angle = rng() * Math.PI * 2;
    const dist = GALAXY_RADIUS * IRREGULAR_GAS_EXTENT * Math.sqrt(rng());
    const x = envelopeX + Math.cos(angle) * dist;
    const y = envelopeY + Math.sin(angle) * dist * envelopeSquash;
    clouds.push({
      x,
      y,
      t: paletteT(x, y, 0.5),
      spread: GALAXY_RADIUS * NEBULA_SPREAD * 1.3,
      blobScale: NEBULA_RADIUS_MULTIPLIER * 1.8,
      count: Math.round(NEBULA_PARTICLES_PER_STEP * 0.25),
      nebulaChance: defaultNebulaChance(paletteT(x, y, 0.5)),
    });
  }

  for (const clump of config.clumps) {
    if (rng() > IRREGULAR_HII_CHANCE) continue;
    const steps = Math.round(NEBULA_STEPS * 0.3);
    for (let step = 0; step < steps; step++) {
      // the inner hole stands in for the cavity feedback blows out of a region
      // that has already formed stars
      const angle = rng() * Math.PI * 2;
      const dist = clump.r * IRREGULAR_NEBULA_REACH * Math.sqrt(IRREGULAR_NEBULA_HOLE + (1 - IRREGULAR_NEBULA_HOLE) * rng());
      const x = clump.x + Math.cos(angle) * dist;
      const y = clump.y + Math.sin(angle) * dist * (0.7 + rng() * 0.6);
      clouds.push({
        x,
        y,
        t: paletteT(x, y, 0.4),
        spread: clump.r * 0.6,
        blobScale: NEBULA_RADIUS_MULTIPLIER * 1.4,
        count: Math.round(NEBULA_PARTICLES_PER_STEP * 0.35),
        nebulaChance: defaultNebulaChance(paletteT(x, y, 0.4)),
      });
    }
  }

  return clouds;
}

export function nebulaClouds(rng: Rng, config: GalaxyConfig): NebulaCloud[] {
  switch (config.type) {
    case 'elliptical':
      return ellipticalClouds(rng, config);
    case 'irregular':
      return irregularClouds(rng, config);
    case 'barred':
      return [...barClouds(config), ...armClouds(config, config.barLength, (arm) => barredBaseAngle(config, arm))];
    default:
      return armClouds(config, 0, (arm) => spiralBaseAngle(config, arm));
  }
}

export interface CoreGlow {
  scaleX: number;
  scaleY: number;
  flattening: number;
  count: number;
  plateau: number;
  falloff: number;
  alphaScale: number;
  angle: number;
  lens: number;
  lensFloor: number;
}

const ROUND_CORE = { plateau: 0, falloff: 0, alphaScale: 1, angle: 0, lens: 0, lensFloor: 1, flattening: 1 };

export function coreGlow(config: GalaxyConfig): CoreGlow {
  switch (config.type) {
    case 'elliptical':
      return { ...ROUND_CORE, scaleX: 1, scaleY: config.axisRatio / 0.6, count: CORE_PARTICLE_COUNT };
    case 'irregular':
      // no central bulge to glow, so this is a faint wide wash rather than a core
      return {
        ...ROUND_CORE,
        scaleX: IRREGULAR_CORE_SPREAD,
        scaleY: IRREGULAR_CORE_SPREAD,
        flattening: IRREGULAR_CORE_FLATTENING,
        count: Math.round(CORE_PARTICLE_COUNT * IRREGULAR_CORE_GLOW),
      };
    case 'barred':
      return {
        scaleX: (GALAXY_RADIUS * config.barLength * BARRED_CORE_LENGTH_FRACTION) / CORE_ELLIPSE_X,
        scaleY: (GALAXY_RADIUS * BAR_WIDTH * BARRED_CORE_BULGE_SCALE) / CORE_ELLIPSE_Y,
        flattening: BARRED_CORE_FLATTENING,
        count: Math.round(CORE_PARTICLE_COUNT * BARRED_CORE_COUNT_SCALE),
        plateau: BARRED_CORE_PLATEAU,
        falloff: BARRED_CORE_FALLOFF,
        alphaScale: BARRED_CORE_ALPHA_SCALE,
        angle: config.barAngle,
        lens: BARRED_CORE_LENS,
        lensFloor: BARRED_CORE_END_WIDTH,
      };
    default:
      return { ...ROUND_CORE, scaleX: 1, scaleY: 1, count: CORE_PARTICLE_COUNT };
  }
}
