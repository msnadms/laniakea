import {
  DEPTH_FADE,
  GALAXY_DEPTH_SIZE,
  GALAXY_GAS_SLABS,
  GALAXY_ORBIT_INITIAL_YAW,
  GALAXY_ORBIT_MAX_TILT,
  GALAXY_ORBIT_MIN_TILT,
  GALAXY_RADIUS,
  GALAXY_TILT,
  SC_DEPTH_FADE,
  SC_DEPTH_HALF,
  SC_DEPTH_SIZE,
  SC_ORBIT_INITIAL_TILT,
  SC_ORBIT_INITIAL_YAW,
  SC_ORBIT_MAX_TILT,
} from '../game/constants';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

export interface Camera3D {
  yaw: number;
  tilt: number;
  focalLength: number;
  perspectiveStrength: number;
}

export interface ProjectionBasis {
  cosYaw: number;
  sinYaw: number;
  cosTilt: number;
  sinTilt: number;
  focalLength: number;
  perspectiveStrength: number;
}

interface ProjectionLayout {
  planets: Array<{
    orbitRadius: number;
    moons: Array<{ dist: number }>;
  }>;
}

// A point level with or behind the focus would invert, so depth is clamped short of it.
const MIN_FOCAL_FRACTION = 0.1;

const DEFAULT_EXTENT = 1000;
const DEFAULT_TILT = 58 * Math.PI / 180;
const DEFAULT_YAW = -18 * Math.PI / 180;
const projectionBasisScratch: ProjectionBasis = {
  cosYaw: 1,
  sinYaw: 0,
  cosTilt: 1,
  sinTilt: 0,
  focalLength: 1,
  perspectiveStrength: 0,
};

export function updateProjectionBasis(camera: Camera3D, out?: ProjectionBasis): ProjectionBasis {
  const basis = out ?? {
    cosYaw: 1,
    sinYaw: 0,
    cosTilt: 1,
    sinTilt: 0,
    focalLength: camera.focalLength,
    perspectiveStrength: camera.perspectiveStrength,
  };
  basis.cosYaw = Math.cos(camera.yaw);
  basis.sinYaw = Math.sin(camera.yaw);
  basis.cosTilt = Math.cos(camera.tilt);
  basis.sinTilt = Math.sin(camera.tilt);
  basis.focalLength = camera.focalLength;
  basis.perspectiveStrength = camera.perspectiveStrength;
  return basis;
}

export function orbitPoint(angle: number, radius: number, height = 0, out?: Point3D): Point3D {
  const point = out ?? { x: 0, y: 0, z: 0 };
  point.x = Math.cos(angle) * radius;
  point.y = height;
  point.z = Math.sin(angle) * radius;
  return point;
}

export function addSystemPoints(a: Point3D, b: Point3D, out?: Point3D): Point3D {
  const point = out ?? { x: 0, y: 0, z: 0 };
  point.x = a.x + b.x;
  point.y = a.y + b.y;
  point.z = a.z + b.z;
  return point;
}

export function projectSystemPoint(
  point: Point3D,
  camera: Camera3D,
  out?: ProjectedPoint,
): ProjectedPoint {
  return projectSystemPointWithBasis(point, updateProjectionBasis(camera, projectionBasisScratch), out);
}

export function projectSystemPointWithBasis(
  point: Point3D,
  basis: ProjectionBasis,
  out?: ProjectedPoint,
): ProjectedPoint {
  const projected = out ?? { x: 0, y: 0, depth: 0, scale: 1 };
  const rotatedX = point.x * basis.cosYaw - point.z * basis.sinYaw;
  const rotatedZ = point.x * basis.sinYaw + point.z * basis.cosYaw;
  const screenY = rotatedZ * basis.cosTilt - point.y * basis.sinTilt;
  const depth = rotatedZ * basis.sinTilt + point.y * basis.cosTilt;
  const perspective = basis.focalLength / Math.max(basis.focalLength - depth, basis.focalLength * MIN_FOCAL_FRACTION);
  const scale = 1 + (perspective - 1) * basis.perspectiveStrength;
  projected.x = rotatedX * scale;
  projected.y = screenY * scale;
  projected.depth = depth;
  projected.scale = scale;
  return projected;
}

export function projectOrbitPoint(
  angle: number,
  radius: number,
  camera: Camera3D,
  out?: ProjectedPoint,
): ProjectedPoint {
  return projectOrbitPointWithBasis(angle, radius, updateProjectionBasis(camera, projectionBasisScratch), out);
}

export function projectOrbitPointWithBasis(
  angle: number,
  radius: number,
  basis: ProjectionBasis,
  out?: ProjectedPoint,
): ProjectedPoint {
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const rotatedX = (cosAngle * basis.cosYaw - sinAngle * basis.sinYaw) * radius;
  const rotatedZ = (cosAngle * basis.sinYaw + sinAngle * basis.cosYaw) * radius;
  const depth = rotatedZ * basis.sinTilt;
  const perspective = basis.focalLength / Math.max(basis.focalLength - depth, basis.focalLength * MIN_FOCAL_FRACTION);
  const scale = 1 + (perspective - 1) * basis.perspectiveStrength;
  const projected = out ?? { x: 0, y: 0, depth: 0, scale: 1 };
  projected.x = rotatedX * scale;
  projected.y = rotatedZ * basis.cosTilt * scale;
  projected.depth = depth;
  projected.scale = scale;
  return projected;
}

export function viewSpaceDirection(
  vector: Point3D,
  camera: Camera3D,
  out?: Point3D,
): Point3D {
  return viewSpaceDirectionWithBasis(vector, updateProjectionBasis(camera, projectionBasisScratch), out);
}

export function viewSpaceDirectionWithBasis(
  vector: Point3D,
  basis: ProjectionBasis,
  out?: Point3D,
): Point3D {
  const direction = out ?? { x: 0, y: 0, z: 0 };
  const rotatedX = vector.x * basis.cosYaw - vector.z * basis.sinYaw;
  const rotatedZ = vector.x * basis.sinYaw + vector.z * basis.cosYaw;
  const viewY = rotatedZ * basis.cosTilt - vector.y * basis.sinTilt;
  const viewZ = rotatedZ * basis.sinTilt + vector.y * basis.cosTilt;
  const length = Math.hypot(rotatedX, viewY, viewZ);
  if (length === 0) {
    direction.x = 0;
    direction.y = 0;
    direction.z = 0;
    return direction;
  }
  direction.x = rotatedX / length;
  direction.y = viewY / length;
  direction.z = viewZ / length;
  return direction;
}

export function getSystemExtent(layout: ProjectionLayout): number {
  let extent = 0;
  for (const planet of layout.planets) {
    let largestMoonDistance = 0;
    for (const moon of planet.moons) largestMoonDistance = Math.max(largestMoonDistance, moon.dist);
    extent = Math.max(extent, planet.orbitRadius + largestMoonDistance);
  }
  return extent > 0 ? extent : DEFAULT_EXTENT;
}

export function createSystemCamera(layout: ProjectionLayout): Camera3D {
  return {
    yaw: DEFAULT_YAW,
    tilt: DEFAULT_TILT,
    focalLength: getSystemExtent(layout) * 4,
    perspectiveStrength: 0.35,
  };
}

const planeScratch: Point3D = { x: 0, y: 0, z: 0 };

// Generation works in plane coordinates, so a point's y is a plane axis and its
// z is the height the projection expects to find in y.
export function projectPlanePoint(
  planeX: number,
  planeY: number,
  height: number,
  camera: Camera3D,
  out?: ProjectedPoint,
): ProjectedPoint {
  planeScratch.x = planeX;
  planeScratch.y = height;
  planeScratch.z = planeY;
  return projectSystemPoint(planeScratch, camera, out);
}

export function projectPlanePointWithBasis(
  planeX: number,
  planeY: number,
  height: number,
  basis: ProjectionBasis,
  out?: ProjectedPoint,
): ProjectedPoint {
  planeScratch.x = planeX;
  planeScratch.y = height;
  planeScratch.z = planeY;
  return projectSystemPointWithBasis(planeScratch, basis, out);
}

// Fixed rather than taken from the live tilt, so turning the disk changes how much
// depth there is to fade over instead of rescaling the fade itself.
export const GALAXY_DEPTH_HALF = GALAXY_RADIUS * Math.sin(GALAXY_TILT);

function normalizedDepth(depth: number): number {
  return Math.min(1, Math.max(0, depth / (2 * GALAXY_DEPTH_HALF) + 0.5));
}

// Aerial perspective: the far edge of the disk sits back behind the near edge.
export function galaxyDepthAlpha(depth: number): number {
  return 1 - DEPTH_FADE * (1 - normalizedDepth(depth));
}

// Orthographic draws every star at its true size, so this is a readability cue
// rather than perspective.
export function galaxyDepthScale(depth: number): number {
  return 1 + GALAXY_DEPTH_SIZE * (normalizedDepth(depth) * 2 - 1);
}

// Gas is bucketed by height, not depth: height is what a yaw turn leaves alone, so
// a band's geometry survives the turn and only its screen offset has to move.
function normalizedHeight(height: number, halfHeight: number): number {
  return Math.min(1, Math.max(0, height / (2 * halfHeight) + 0.5));
}

export function galaxyGasSlab(height: number, halfHeight: number): number {
  return Math.min(GALAXY_GAS_SLABS - 1, Math.floor(normalizedHeight(height, halfHeight) * GALAXY_GAS_SLABS));
}

export function galaxyGasSlabHeight(slab: number, halfHeight: number): number {
  return ((slab + 0.5) / GALAXY_GAS_SLABS - 0.5) * 2 * halfHeight;
}

export function createGalaxyCamera(): Camera3D {
  return {
    yaw: GALAXY_ORBIT_INITIAL_YAW,
    tilt: GALAXY_TILT,
    focalLength: 1,
    perspectiveStrength: 0,
  };
}

export function clampGalaxyTilt(tilt: number): number {
  return Math.min(GALAXY_ORBIT_MAX_TILT, Math.max(GALAXY_ORBIT_MIN_TILT, tilt));
}

export function createSuperclusterCamera(): Camera3D {
  return {
    yaw: SC_ORBIT_INITIAL_YAW,
    tilt: SC_ORBIT_INITIAL_TILT,
    focalLength: 1,
    perspectiveStrength: 0,
  };
}

export function clampOrbitTilt(tilt: number): number {
  return Math.min(SC_ORBIT_MAX_TILT, Math.max(-SC_ORBIT_MAX_TILT, tilt));
}

function superclusterDepthT(depth: number): number {
  return Math.min(1, Math.max(0, depth / (2 * SC_DEPTH_HALF) + 0.5));
}

export function superclusterDepthAlpha(depth: number): number {
  return 1 - SC_DEPTH_FADE * (1 - superclusterDepthT(depth));
}

// Orthographic draws every dot at its true size, so this is a readability cue
// rather than perspective.
export function superclusterDepthScale(depth: number): number {
  return 1 + SC_DEPTH_SIZE * (superclusterDepthT(depth) * 2 - 1);
}

// The supercluster camera is orthographic, so the whole dot field reduces to one
// fused pass. Per-point calls through the scratch objects cost more than the
// projection arithmetic itself at this many dots.
export function projectSuperclusterField(
  planeX: Float32Array,
  planeY: Float32Array,
  height: Float32Array,
  basis: ProjectionBasis,
  outX: Float32Array,
  outY: Float32Array,
  outAlpha: Float32Array,
  outScale: Float32Array,
): void {
  const { cosYaw, sinYaw, cosTilt, sinTilt } = basis;
  for (let i = 0; i < planeX.length; i++) {
    const x = planeX[i];
    const y = planeY[i];
    const h = height[i];
    const rotatedX = x * cosYaw - y * sinYaw;
    const rotatedZ = x * sinYaw + y * cosYaw;
    const depth = rotatedZ * sinTilt + h * cosTilt;
    outX[i] = rotatedX;
    outY[i] = rotatedZ * cosTilt - h * sinTilt;
    outAlpha[i] = superclusterDepthAlpha(depth);
    outScale[i] = superclusterDepthScale(depth);
  }
}
