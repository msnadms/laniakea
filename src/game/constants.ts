import type { GalaxyType } from './types';

// ─── Galaxy shape ────────────────────────────────────────────────────────────

// Outer radius of the galaxy in world-space pixels.
// Increasing this makes the galaxy larger and stars more spread out.
export const GALAXY_RADIUS = 720;
// Real-world scale: how many light years GALAXY_RADIUS represents.
export const GALAXY_RADIUS_LY = 25000;

// How many radians the spiral rotates from centre to edge.
// Higher = tighter/more wound spiral. Used in both star gen and nebula placement.
export const SPIRAL_TWISTS: Record<number, number> = {
    2: 3.5,
    3: 2.7,
    4: 2,
    5: 1.7
}

// Relative likelihood of each galaxy morphology when rolling a new galaxy.
export const GALAXY_TYPE_WEIGHTS: Record<GalaxyType, number> = {
    spiral: 0.40,
    barred: 0.30,
    elliptical: 0.18,
    irregular: 0.12,
};

// Bar half-length as a fraction of GALAXY_RADIUS; arms attach at the bar tips.
export const BAR_LENGTH_MIN = 0.30;
export const BAR_LENGTH_MAX = 0.40;

// Bar thickness perpendicular to its long axis, as a fraction of GALAXY_RADIUS.
export const BAR_WIDTH = 0.12;

// Fraction of a barred galaxy's non-bulge stars that land on the bar itself.
export const BAR_FRACTION = 0.18;

// Bar-fed arms are broader and more diffuse than core-fed ones.
export const BARRED_ARM_SPREAD_SCALE = 1.6;

// Bar-fed arms wind less than core-fed ones, so they get their own twist range.
export const BARRED_TWIST_MIN = 1.1;
export const BARRED_TWIST_MAX = 1.9;

// A bar is old yellow stars, not a glowing gas lane, so its clouds are sparse and
// almost never take the white core palette — otherwise they read as a solid white
// slab lying across the galaxy.
export const BAR_CLOUD_DENSITY = 0.1;
export const BAR_CLOUD_NEBULA_CHANCE = 0.95;

// The barred core is a lens lying along the bar: it swells to a bulge at the
// centre and narrows to the bar's own width at each end, so the bar reads as one
// shape running out of the bulge instead of a circle with a slab through it.
// Length is a fraction of the bar's half-length, height a multiple of its
// half-width, and BARRED_CORE_END_WIDTH is the share of that height still left
// where the lens meets the bar.
export const BARRED_CORE_LENGTH_FRACTION = 0.8;
export const BARRED_CORE_BULGE_SCALE = 1.7;
export const BARRED_CORE_END_WIDTH = 0.38;
export const BARRED_CORE_LENS = 0.8;
export const BARRED_CORE_COUNT_SCALE = 1.8;

// Alpha holds full inside BARRED_CORE_PLATEAU of the reach, keeping the solid
// bright centre, then falls as (1 - r)^f so the extra reach is a faint white haze.
// The plateau is brightened to hold its own now that it covers more sky than the
// unscaled core ellipse did.
export const BARRED_CORE_PLATEAU = 0.25;
export const BARRED_CORE_FALLOFF = 3.2;
export const BARRED_CORE_ALPHA_SCALE = 1.6;

// Power curve for elliptical radius: radius = R * u^c, so surface density goes
// as r^(1/c - 2). 0.5 is a flat disc; at 1.0 and above the centre becomes a
// cusp that reads as a star cluster rather than a galaxy body.
export const ELLIPTICAL_CONCENTRATION_MIN = 0.65;
export const ELLIPTICAL_CONCENTRATION_MAX = 0.85;

// Minor/major axis ratio range for elliptical galaxies (E0 round to E7 flattened).
export const ELLIPTICAL_AXIS_MIN = 0.40;
export const ELLIPTICAL_AXIS_MAX = 0.85;

// Elliptical nebula haze: many light, widely overlapping clouds rather than a
// few dense ones, so no cloud is big or solid enough to read as its own puff.
export const ELLIPTICAL_NEBULA_CLOUDS = 1500;
export const ELLIPTICAL_NEBULA_EXTENT = 1.05;

// Radius power for cloud placement: surface density goes as r^(1/p - 2), so 0.5
// is an even wash. Anything near the stars' own concentration piles the whole
// haze onto the core, which the per-particle alpha already brightens.
export const ELLIPTICAL_NEBULA_FALLOFF = 0.55;

// Number of star-forming clumps in an irregular galaxy.
export const IRREGULAR_CLUMP_MIN = 3;
export const IRREGULAR_CLUMP_MAX = 5;

// How far from the centre clump centres can sit, as a fraction of GALAXY_RADIUS.
export const IRREGULAR_CLUMP_SPREAD = 0.36;

// Clump radius range as a fraction of GALAXY_RADIUS.
export const IRREGULAR_CLUMP_RADIUS_MIN = 0.22;
export const IRREGULAR_CLUMP_RADIUS_MAX = 0.45;

// Standard deviation of a star's offset from its clump centre, as a fraction of
// the clump radius. Gaussian rather than a hard cutoff so clumps have soft edges
// and overlap instead of reading as separate circles.
export const IRREGULAR_CLUMP_SIGMA = 0.6;

// Irregulars have no central bulge, so the core glow is scaled right down and
// spread wide instead of sitting as a bright knot at the centre.
export const IRREGULAR_CORE_GLOW = 0.12;
export const IRREGULAR_CORE_SPREAD = 1.8;

// How far the neutral-hydrogen envelope reaches, as a fraction of GALAXY_RADIUS.
// Dwarf irregulars carry gas well past their starlight, so this exceeds the
// radius the clumps occupy (IRREGULAR_CLUMP_SPREAD).
export const IRREGULAR_GAS_EXTENT = 0.95;

// How far off the galactic centre that envelope is anchored. Irregular gas is
// characteristically lopsided rather than centred on the stellar body.
export const IRREGULAR_GAS_OFFSET = 0.3;

// Chance that a given star clump currently hosts hot young stars and so lights
// up an ionized region. Below 1 so some clumps stay dark and some gas has no stars.
export const IRREGULAR_HII_CHANCE = 0.55;

// How far an irregular galaxy's nebula reaches past its star clumps. Above 1 the
// gas drifts off the clumps instead of sitting on them as bright cores.
export const IRREGULAR_NEBULA_REACH = 1.5;

// Fraction of each clump's inner radius left clear of nebula clouds, so the
// brightest part of the clump is the stars rather than the gas.
export const IRREGULAR_NEBULA_HOLE = 0.2;

// Fraction of an irregular galaxy's stars placed as loose haze between clumps
// so the clumps read as one galaxy rather than separate objects, and so the
// middle of the galaxy is populated even when no clump lands there.
export const IRREGULAR_HAZE_FRACTION = 0.45;

// How far the haze reaches, as a fraction of GALAXY_RADIUS. Kept in around the
// clumps so an irregular galaxy still reads as one object.
export const IRREGULAR_HAZE_EXTENT = 0.8;

// ─── Star generation ─────────────────────────────────────────────────────────

// Probability (0–1) that any given star ends up in the central bulge rather
// than on a spiral arm. 0.18 = 18% bulge stars.
export const BULGE_FRACTION = 0.18;

// Bulge stars are placed within this fraction of GALAXY_RADIUS from the center.
export const BULGE_RADIUS_FRACTION = 0.22;

// Y-axis squish applied specifically to the bulge cluster (slightly rounder
// than the arms, but still slightly elliptical).
export const BULGE_ELLIPSE = 0.7;

// Power curve applied to the random t value for arm star placement.
// Values < 1 push stars toward the outer regions; 1.0 = uniform distribution.
export const ARM_T_POWER = 0.65;

// Arm stars start at this fraction of GALAXY_RADIUS from the centre (not at 0
// so there's a gap between the bulge and the arm starts).
export const ARM_INNER_FRACTION = 0.08;

// Controls how wide (perpendicular to the arm centreline) stars can scatter.
// Higher = fatter, blurrier arms; lower = tighter, more distinct arms.
export const ARM_SPREAD = 0.07;

// Minimum spread multiplier at the arm's inner end (spread grows with t).
export const ARM_SPREAD_BASE = 0.3;

// Multiplier for the size of each star.
export const STAR_SIZE_MULTIPLIER = 0.5;

// Fraction of non-bulge stars placed as inter-arm disk stars (old, dim background population).
export const DISK_FRACTION = 0.4;

// How much angular scatter inter-arm disk stars get within their gap (fraction of half-gap width).
export const DISK_GAP_SCATTER = 0.7;

// Size multiplier applied to inter-arm disk stars to make them visibly dimmer.
export const DISK_SIZE_SCALE = 0.6;

// Number of brown dwarfs at the galactic edge (rare).
export const NUM_BROWN_DWARFS = 3;


// ─── Background starfield ────────────────────────────────────────────────────

// Total number of decorative background stars generated.
export const BACKGROUND_STAR_COUNT = 4800;

// Width and height of the area background stars are scattered across.
// Should be larger than the visible screen so stars fill the view while panning.
export const BACKGROUND_STAR_AREA_X = 5000;
export const BACKGROUND_STAR_AREA_Y = 4000;

// ─── Nebula ──────────────────────────────────────────────────────────────────

// Colours used in inner arm nebula (matching hot blue/white A and F stars).
export const INNER_NEBULA_COLORS = [
  [0x3366ff, 0x5533bb, 0x4488ee], // sapphire blue / violet
  [0x2255ff, 0x4433bb, 0x5550aa], // deep indigo
  [0x22aaff, 0x3355dd, 0x44bbee], // azure / cyan-blue
  [0x6633bb, 0x5522cc, 0x7744bb], // violet
  [0x4466ff, 0x5577aa, 0x2244cc], // electric blue
];

// Colours blended across outer arm nebula particles.
export const NEBULA_COLORS = [
    [0x661899, 0x882244, 0x4422bb], // Purplish red
    [0x661899, 0x3366cc, 0x4422bb], // Purplish blue
    [0xdd4411, 0xcc7722, 0xaa2200], // Ember orange
    [0x5544dd, 0x2211aa, 0x5544aa], // Deep indigo
    [0xcc8822, 0xdd5511, 0xbbaa00], // Golden amber
    [0x771166, 0x5511cc, 0x991144], // Violet crimson
];

// How many blob positions are sampled along each arm (before random skipping).
export const NEBULA_STEPS = 50;

// Probability (0–1) that any given step position is skipped, creating gaps.
export const NEBULA_SKIP_CHANCE = 0;

// Number of particles drawn per blob position.
export const NEBULA_PARTICLES_PER_STEP = 1000;

// Controls how wide each blob cloud is relative to GALAXY_RADIUS.
export const NEBULA_SPREAD = 0.15;

// Controls how large each blob is.
export const NEBULA_RADIUS_MULTIPLIER = 0.25;

// How many pixels the displacement filter shifts nebula pixels at peak.
export const NEBULA_DISPLACEMENT_SCALE = 22;

// Controls where nebula blobs start.
export const NEBULA_CLOUD_OFFSET = 100;

// ─── Galactic core glow ──────────────────────────────────────────────────────

// Number of particles in the central white-gold core glow.
export const CORE_PARTICLE_COUNT = 500;

export const CORE_COLORS = [0xffffff, 0xffe8c0]

// Half-width and half-height of the ellipse the core particles scatter within.
export const CORE_ELLIPSE_X = 180;
export const CORE_ELLIPSE_Y = 110;

// ─── Supercluster generation ─────────────────────────────────────────────────

// Half-width/height of the attractor placement area in world-space units.
export const SC_WORLD_HALF = 1800;
// Real-world scale: how many million light years SC_WORLD_HALF represents.
export const SC_WORLD_HALF_MLY = 450;

// How many galaxy-cluster "attractors" (dense nodes) to place in the supercluster.
export const SC_ATTRACTOR_COUNT = 12;

// Base number of galaxy dots placed in the Gaussian cluster around each attractor.
// Scaled by the attractor's strength, so stronger attractors get more dots.
export const SC_CLUSTER_DOTS_PER_ATTRACTOR = 2000;

// Standard deviation of the cluster Gaussian as a fraction of SC_WORLD_HALF.
export const SC_CLUSTER_SIGMA = 0.12;

// Max world-space distance from a dot to its nearest attractor for the attractor
// name to appear in the address breadcrumb. ~1.4× SC_CLUSTER_SIGMA × SC_WORLD_HALF.
export const SC_ATTRACTOR_LABEL_MAX_DIST = 300;

// Number of galaxy dots placed along each filament curve.
export const SC_FILAMENT_DOTS_PER_EDGE = 500;

// Base scatter width for filament dots as a fraction of SC_WORLD_HALF.
export const SC_FILAMENT_SCATTER = 0.025;

// 46 billion light years
export const OBS_UNIVERSE_RADIUS = 46_000_000_000;

// ─── Camera ──────────────────────────────────────────────────────────────────

// Starting zoom level. 1.0 = 1:1 pixels, < 1 = zoomed out.
export const CAMERA_INITIAL_SCALE = 0.65;
export const SC_CAMERA_INITIAL_SCALE = 0.55;

// Minimum and maximum allowed zoom levels.
export const CAMERA_MIN_SCALE = 0.12;
export const SYSTEM_CAMERA_MIN_SCALE = 0.03;
export const CAMERA_MAX_SCALE = 6;

// Zoom multiplier applied per scroll step (12% per tick).
export const CAMERA_ZOOM_FACTOR = 1.12;

// Pointer must move more than this many pixels before a press is treated as a
// drag rather than a click.
export const DRAG_THRESHOLD_PX = 4;

