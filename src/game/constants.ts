import type { GalaxyType } from './types';
import type { AnomalyKind, CivilizationStage } from './anomalies';

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
export const BARRED_ARM_NEBULA_ALPHA_SCALE = 0.8;

// Nebula billows outward where each arm leaves the bar, then settles back to
// the regular barred-arm width over the inner part of the arm.
export const BARRED_ARM_ROOT_NEBULA_SPREAD_SCALE = 2.5;
export const BARRED_ARM_ROOT_NEBULA_SPREAD_EXTENT = 0.3;

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
export const BARRED_CORE_CENTER_ALPHA_SCALE = 1.3;

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
export const ELLIPTICAL_NEBULA_ALPHA_SCALE = 0.75;

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


// ─── Sky backdrop ────────────────────────────────────────────────────────────

// Nebula palettes for the sky: three cloud colours and a pale emission core, as 0–1 RGB.
export const SKY_PALETTES: readonly (readonly [number, number, number])[][] = [
  [[0.42, 0.16, 0.62], [0.12, 0.26, 0.72], [0.06, 0.52, 0.52], [0.85, 0.72, 1.0]],
  [[0.08, 0.22, 0.60], [0.05, 0.50, 0.62], [0.12, 0.55, 0.30], [0.70, 0.95, 1.0]],
  [[0.58, 0.12, 0.45], [0.32, 0.12, 0.65], [0.12, 0.30, 0.75], [1.0, 0.76, 0.92]],
  [[0.05, 0.45, 0.42], [0.10, 0.52, 0.25], [0.35, 0.15, 0.60], [0.80, 1.0, 0.90]],
  [[0.40, 0.12, 0.55], [0.60, 0.18, 0.32], [0.55, 0.36, 0.12], [1.0, 0.86, 0.72]],
  [[0.10, 0.12, 0.50], [0.36, 0.14, 0.58], [0.08, 0.50, 0.35], [0.80, 0.86, 1.0]],
];

// How much nebula, galactic band and star density each view's sky carries.
export const SKY_LOOKS = {
  supercluster: { nebula: 0.65, band: 0, stars: 0.8 },
  galaxy: { nebula: 0.5, band: 0.4, stars: 0.95 },
  system: { nebula: 1, band: 1, stars: 1 },
} as const;

// Background colour the nebula is laid over (matches the app background).
export const SKY_BASE_COLOR: readonly [number, number, number] = [0.02, 0.031, 0.063];

// Focal length in screen px of the flat views' sky; long enough that the sphere reads flat.
export const SKY_FLAT_FOCAL = 1400;

export const CMB_RESOLUTION = 0.35;
export const CMB_FREQUENCY = 3.2;
export const CMB_OCTAVES = 6;
export const CMB_WARM: readonly [number, number, number] = [0.085, 0.045, 0.03];
export const CMB_COLD: readonly [number, number, number] = [0.01, 0.03, 0.075];

export const WEB_GLOW_NEAR = 600;
export const WEB_GLOW_FADE = 2_500;
export const WEB_GLOW_FAR = 4_500;
export const WEB_GLOW_STEPS = 32;
// Powers of two, so the panorama can wrap in WebGL1.
export const WEB_GLOW_WIDTH = 256;
export const WEB_GLOW_HEIGHT = 128;
export const WEB_GLOW_REBAKE = 40;
export const WEB_GLOW_CROSSFADE_SECS = 0.15;
export const WEB_GLOW_WALL_WIDTH = 1_400;
export const WEB_GLOW_FILAMENT_WIDTH = 2_400;
export const WEB_GLOW_COLOR: readonly [number, number, number] = [0.5, 0.34, 0.72];
export const WEB_GLOW_INTENSITY = 0.25;

// The nebula renders at this fraction of screen resolution and is upscaled; it has no hard edges.
export const SKY_NEBULA_RESOLUTION = 0.5;

// Star blink: angular speed in radians per second (each star runs at 0.5–1.5x) and the deepest dip in brightness.
export const SKY_TWINKLE_SPEED = 1.6;
export const SKY_TWINKLE_DEPTH = 0.45;

// Screen px the system-view sky is rendered beyond each edge, and how far the camera drags it.
export const SKY_PARALLAX_MARGIN = 48;
export const SKY_PARALLAX_FACTOR = 0.02;

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

// Flatten the centre-biased particle distribution without changing its bounds,
// then soften the combined glow slightly.
export const CORE_DISTRIBUTION_POWER = 0.8;
export const CORE_ALPHA_SCALE = 0.85;

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
export const SC_DOT_SEED_MIX = 2654435761;
export const SC_MAX_FILAMENTS = 3 * SC_ATTRACTOR_COUNT;
export const SC_MAX_GALAXY_DOTS = SC_ATTRACTOR_COUNT * SC_CLUSTER_DOTS_PER_ATTRACTOR + SC_MAX_FILAMENTS * SC_FILAMENT_DOTS_PER_EDGE;

// Base scatter width for filament dots as a fraction of SC_WORLD_HALF.
export const SC_FILAMENT_SCATTER = 0.025;

// ─── Supercluster projection ─────────────────────────────────────────────────

// The cosmic web is turned in place rather than flown through, so the projection
// stays orthographic and a world pixel keeps a fixed light-year value.
export const SC_ORBIT_INITIAL_YAW = 0;
export const SC_ORBIT_INITIAL_TILT = 22 * Math.PI / 180;

// Past this the web reads as an edge-on smear with no usable click targets.
export const SC_ORBIT_MAX_TILT = 72 * Math.PI / 180;

// Radians of rotation per pixel dragged.
export const SC_ORBIT_SENSITIVITY = 0.005;

// Fraction of the remaining rotation covered per 60fps frame.
export const SC_ORBIT_EASE = 0.18;

// Radians of rotation per second while Q or E is held.
export const SC_ORBIT_KEY_YAW_SPEED = 0.8;

// Half-depth that the aerial-perspective cues normalize against.
export const SC_DEPTH_HALF = SC_WORLD_HALF * 1.2;

// How much of a far dot's alpha the depth haze takes.
export const SC_DEPTH_FADE = 0.45;

// Orthographic keeps every dot the same size, so this size swing is a stylistic
// depth cue rather than perspective.
export const SC_DEPTH_SIZE = 0.22;

// Radius the shared dot sprite is rasterised at, in texture pixels.
export const SC_DOT_TEXTURE_RADIUS = 16;

export const UNIVERSE_SEED = 0x6a09e667;
// Generation lengths are lattice units, frozen so no acceptance moves; UNIVERSE_SCALE turns them into Mly.
export const UNIVERSE_VOID_CELL = 11_000;
export const UNIVERSE_CHUNK_AXIS_BITS = 7;
export const UNIVERSE_CHUNK_TRIAL_BITS = 11;
export const UNIVERSE_CHUNK_SPAN = 1 << (UNIVERSE_CHUNK_AXIS_BITS - 1);
export const UNIVERSE_CHUNK_TRIALS = 1 << UNIVERSE_CHUNK_TRIAL_BITS;
export const UNIVERSE_LATTICE_RADIUS = (UNIVERSE_CHUNK_SPAN - 1) * UNIVERSE_VOID_CELL;
export const UNIVERSE_RADIUS = 46_500;
export const UNIVERSE_SCALE = UNIVERSE_RADIUS / UNIVERSE_LATTICE_RADIUS;
export const UNIVERSE_CHUNK_CACHE = 1024;
export const UNIVERSE_CHUNK_BUDGET_MS = 6;
export const UNIVERSE_CHUNK_REFRESH = 100;
export const UNIVERSE_VOID_JITTER = 0.8;
export const UNIVERSE_WALL_WIDTH = 520;
export const UNIVERSE_WALL_WEIGHT = 0.3;
export const UNIVERSE_FILAMENT_WIDTH = 900;
export const UNIVERSE_ANCHOR_RADIUS = 2500;
export const UNIVERSE_ANCHOR_SAMPLES = 4000;

export const UNIVERSE_START_BACKOFF = 120;
export const UNIVERSE_FOV = 70 * Math.PI / 180;
export const UNIVERSE_NEAR = 4;
export const UNIVERSE_NEAR_FADE = 16;
export const UNIVERSE_FOG_FAR = 2_000;
export const UNIVERSE_CULL_MARGIN_PX = 80;
export const UNIVERSE_DOT_SIZE = 6;
export const UNIVERSE_DOT_MIN_PX = 0.9;
export const UNIVERSE_DOT_MAX_PX = 60;

export const UNIVERSE_CLUSTER_TEMPLATES = 128;
export const UNIVERSE_CLUSTER_MAX_STARS = 40;
export const UNIVERSE_CLUSTER_MIN_STARS = 12;
export const UNIVERSE_CLUSTER_RADIUS = 30;
export const UNIVERSE_CLUSTER_REVEAL_MIN_STARS = 1;
export const UNIVERSE_CLUSTER_REVEAL_FULL_STARS = 4;
export const UNIVERSE_CLUSTER_STARS_PER_PX = 1.2;
export const UNIVERSE_CLUSTER_PICK_FRACTION = 0.9;
export const UNIVERSE_STAR_SIZE = 1.4;
export const UNIVERSE_STAR_MIN_PX = 1.1;
export const UNIVERSE_STAR_MAX_PX = 5;

export const UNIVERSE_LOOK_SENSITIVITY = 0.004;
export const UNIVERSE_KEY_YAW_SPEED = 0.9;
export const UNIVERSE_LOOK_EASE = 0.25;
export const UNIVERSE_MAX_PITCH = 85 * Math.PI / 180;
export const UNIVERSE_SPEED_DEFAULT = 80;
export const UNIVERSE_SPEED_MIN = 2.5;
export const UNIVERSE_SPEED_MAX = 1_000;
export const UNIVERSE_SPEED_STEP = 1.25;
export const UNIVERSE_BOOST = 4;
export const UNIVERSE_FLIGHT_EASE = 0.08;

export const UNIVERSE_PICK_SCREEN_PX = 14;
export const UNIVERSE_PICK_MIN_ALPHA = 0.12;

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

export const CAMERA_KEY_PAN_SPEED = 900;
export const CAMERA_KEY_PAN_BOOST = 3;
export const CAMERA_KEY_PAN_EASE = 0.18;

export const GALAXY_TILT = 50 * Math.PI / 180;

// The disk is turned in place rather than flown through, so the projection stays
// orthographic: gas geometry is baked flat and re-oriented by a container
// transform, which only agrees with the stars' own projection without perspective.
export const GALAXY_ORBIT_INITIAL_YAW = 0;

// Past the upper bound the disk reads as an edge-on smear with no usable click
// targets; past the lower one the tilt stops carrying any depth at all.
export const GALAXY_ORBIT_MIN_TILT = 15 * Math.PI / 180;
export const GALAXY_ORBIT_MAX_TILT = 78 * Math.PI / 180;

// Radians of rotation per pixel dragged, and fraction of the remaining rotation
// covered per 60fps frame.
export const GALAXY_ORBIT_SENSITIVITY = 0.005;
export const GALAXY_ORBIT_EASE = 0.12;

// Stand-in for the perspective the orthographic camera gives up: near stars are
// drawn larger than far ones without their positions moving off the gas.
export const GALAXY_DEPTH_SIZE = 0.22;

// Height bands the gas is baked into so the disk keeps some thickness as it
// turns. They share one filter pass, so this is cheap to raise.
export const GALAXY_GAS_SLABS = 5;

// Scale heights are a fraction of GALAXY_RADIUS, and far past physical: a real
// disk is a hundred times wider than it is thick, which a tilt cannot show.
export const POPULATION_SCALE_HEIGHT = {
  arm: 0.055,
  bar: 0.045,
  disk: 0.075,
  starburst: 0.090,
  bulge: 0.160,
  halo: 0.220,
} as const;

export const SPHEROID_FLOOR = 0.25;

export const NEBULA_SCALE_HEIGHT = 0.045;

export const CORE_HEIGHT_SCALE = 0.85;

export const BARRED_CORE_FLATTENING = 0.7;

export const IRREGULAR_CORE_FLATTENING = 0.6;

export const DEPTH_FADE = 0.35;

export const GALAXY_INTRO_TILT_OFFSET = 8 * Math.PI / 180;

export const GALAXY_PICK_SCREEN_PX = 15;

export const GALAXY_PICK_MAX_WORLD = 25;

// Pointer must move more than this many pixels before a press is treated as a
// drag rather than a click.
export const DRAG_THRESHOLD_PX = 4;

export const ANOMALY_CIVILIZATION_CHANCE = 1 / 1500000;
export const ANOMALY_HOME_RADIUS = 0.25 * GALAXY_RADIUS;
export const ANOMALY_HOME_OUTER_ARM_FRACTION = 0.45;

export const ANOMALY_DYSON_MIN = 1;
export const ANOMALY_DYSON_MAX = 3;
export const ANOMALY_DYSON_EDGE_WEIGHT = 0.15;

export const ANOMALY_STAGE_WEIGHTS: Record<CivilizationStage, number> = { 1: 30, 2: 25, 3: 18, 4: 13, 5: 9, 6: 5 };
export const ANOMALY_RUINED_MIN_STAGE: CivilizationStage = 2;
export const ANOMALY_STAGE_POPULATED: Record<CivilizationStage, readonly [number, number]> = {
  1: [0, 0],
  2: [0, 0],
  3: [1, 2],
  4: [2, 3],
  5: [2, 3],
  6: [2, 3],
};
export const ANOMALY_MEGASTRUCTURES_SOME_MIN = 1;
export const ANOMALY_MEGASTRUCTURES_SOME_MAX = 2;

export const ANOMALY_THRUSTER_HEIGHT_FRACTION = 0.05;

export const ANOMALY_BEAM_RIM_MIN = 0.8;
export const ANOMALY_BEAM_RIM_MAX = 1.2;

export const ANOMALY_BRAIN_MIN_DYSON_SPHERES = 2;

export const ANOMALY_BLACK_HOLE_REACH = 0.12 * GALAXY_RADIUS;
export const ANOMALY_BLACK_HOLE_CHANCE = 0.012;
export const ANOMALY_BLACK_HOLE_ACTIVE_CHANCE = 0.35;

export const ANOMALY_INTEGRITY: Record<AnomalyKind, readonly [number, number]> = {
  blackHole: [1, 1],
  dysonSphere: [0.25, 0.6],
  caplanThruster: [0.4, 0.75],
  nicollDysonBeam: [0.4, 0.7],
  matrioshkaBrain: [0.85, 0.97],
  homeworld: [0.3, 0.65],
  aldersonDisk: [0.45, 0.8],
  alcubierreCannon: [0.35, 0.7],
};

export const ANOMALY_LIVING_CHANCE = 0.2;

export const ANOMALY_INTEGRITY_LIVING: Partial<Record<AnomalyKind, readonly [number, number]>> = {
  aldersonDisk: [0.96, 1],
  alcubierreCannon: [0.94, 1],
  dysonSphere: [0.9, 1],
  homeworld: [0.92, 1],
  caplanThruster: [0.85, 0.98],
  nicollDysonBeam: [0.85, 0.98],
  matrioshkaBrain: [0.95, 1],
};

export const ANOMALY_SIGN_MIN_SCALE = 1.1;
export const ANOMALY_BEAM_SIGN_MIN_SCALE = 0.45;
export const ANOMALY_SIGN_FADE_SPAN = 0.5;
export const ANOMALY_BEAM_SIGN_LENGTH = 0.8 * GALAXY_RADIUS;
export const ANOMALY_BEAM_SIGN_SEGMENTS = 12;

export const SC_CIVILIZATION_TINT = 0xff4a2a;
export const SC_CIVILIZATION_TINT_STRENGTH = 0.6;
export const SC_CIVILIZATION_TINT_MIN_SCALE = 1.4;
export const SC_CIVILIZATION_TINT_FULL_SCALE = 2.6;

export const CONDENSATE_START = 16;
export const CONDENSATE_PER_HOMEWORLD = 10;

export const SCAN_COST_MIN = 2;
export const SCAN_COST_UNIVERSE_SPAN = 10;
export const SCAN_COST_SUPERCLUSTER_SPAN = 7;
// Sub-cubic, so widening a wave is far cheaper per volume than launching another one.
export const SCAN_COST_RADIUS_EXPONENT = 1.5;

export const SCAN_UNIVERSE_MIN_RADIUS = 60;
export const SCAN_UNIVERSE_FULL_RADIUS = 0.5 * UNIVERSE_FOG_FAR;
export const SCAN_UNIVERSE_MAX_RADIUS = SCAN_UNIVERSE_FULL_RADIUS;
export const SCAN_SUPERCLUSTER_MIN_RADIUS = 80;
export const SCAN_SUPERCLUSTER_FULL_RADIUS = SC_WORLD_HALF;
export const SCAN_PRECISION_FRACTION = 0.35;

export const SCAN_MIN_DRAG_PX = 24;
export const SCAN_SUPERCLUSTER_ANCHOR_PX = 15;
export const SCAN_BUDGET_MS = 10;
export const SCAN_UNIVERSE_MAX_TARGETS = 8000;
export const SCAN_SEEDS_PER_STEP = 4000;
export const SCAN_SHELL_COLOR = 0x00e8ff;
export const SCAN_SHELL_DENIED_COLOR = 0xff5a3c;
export const SCAN_AIM_BACK_ALPHA = 0.38;
export const SCAN_AIM_FRONT_ALPHA = 1;
export const SCAN_SHELL_LINE_PX = 1.5;
export const SCAN_GRAPH_MAX_NODES = 2500;
export const SCAN_WEB_GRADIENT_MAX_NODES = 250;
export const SCAN_HEAT_COLORS = [0x3d7fa8, 0x37b6d8, 0x50e39c, 0xffcc4a, 0xff5a38];
export const SCAN_HEAT_STEPS = 8;
export const SCAN_HEAT_BLOOM_SCALE = 0.6;
export const SCAN_HEAT_NOISE_AMOUNT = 0.55;
export const SCAN_HEAT_DECOY_THRESHOLD = 0.55;
export const SCAN_HEAT_NOISE_DECAY = 0.4;
export const SCAN_HEAT_OVERLAP_SHARPEN = 0.8;
export const SCAN_MARK_COLOR = 0xff6a3c;
export const SCAN_MARK_LINE_PX = 1.6;
export const SCAN_HEAT_REACH_MIN = 0.7;
export const SCAN_HEAT_REACH_MAX = 1.7;
export const SCAN_HEAT_NOISE_CELL = 0.55;
export const SCAN_WEB_LINE_PX = 2.2;
export const SCAN_WEB_MIN_ALPHA = 0.5;
export const SCAN_WEB_BACK_ALPHA = 0.62;
export const SCAN_WEB_FRONT_ALPHA = 1;
export const SCAN_WEB_SEGMENTS = 4;
export const SCAN_WEB_NODE_RADIUS_PX = 5;
