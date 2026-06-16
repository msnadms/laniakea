// ─── Galaxy shape ────────────────────────────────────────────────────────────

// Outer radius of the galaxy in world-space pixels.
// Increasing this makes the galaxy larger and stars more spread out.
export const GALAXY_RADIUS = 720;

// How many radians the spiral rotates from centre to edge.
// Higher = tighter/more wound spiral. Used in both star gen and nebula placement.
export const SPIRAL_TWISTS: Record<number, number> = {
    2: 3.5,
    3: 2.7,
    4: 2,
    5: 1.7
}

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


// ─── Hyperlanes ──────────────────────────────────────────────────────────────

// Maximum distance for hyperlanes between stars on the same spiral arm.
export const MAX_LANE_DIST_ARM = 500;

// Maximum distance for hyperlanes involving disk or bulge stars (cross-arm / radial links).
export const MAX_LANE_DIST = 100;

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
  [0x3366ff, 0x6644cc, 0x4488ee], // sapphire blue / violet
  [0x2255ff, 0x4433bb, 0x7766ff], // deep indigo
  [0x22aaff, 0x3355dd, 0x44bbee], // azure / cyan-blue
  [0x8844ff, 0x5522cc, 0xaa66ff], // violet
  [0x4466ff, 0x88aaff, 0x2244cc], // electric blue
];

// Colours blended across outer arm nebula particles.
export const NEBULA_COLORS = [
    [0x8822cc, 0xcc3366, 0x4422bb], // Purplish red
    [0x8822cc, 0x3366cc, 0x4422bb], // Purplish blue
    [0xdd4411, 0xcc7722, 0xaa2200], // Ember orange
    [0x5544dd, 0x2211aa, 0x8866ff], // Deep indigo
    [0xcc8822, 0xdd5511, 0xbbaa00], // Golden amber
    [0xaa2288, 0x5511cc, 0xdd1166], // Violet crimson
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

// ─── Camera ──────────────────────────────────────────────────────────────────

// Starting zoom level. 1.0 = 1:1 pixels, < 1 = zoomed out.
export const CAMERA_INITIAL_SCALE = 0.65;

// Minimum and maximum allowed zoom levels.
export const CAMERA_MIN_SCALE = 0.12;
export const CAMERA_MAX_SCALE = 6;

// Zoom multiplier applied per scroll step (12% per tick).
export const CAMERA_ZOOM_FACTOR = 1.12;

// Pointer must move more than this many pixels before a press is treated as a
// drag rather than a click.
export const DRAG_THRESHOLD_PX = 4;
