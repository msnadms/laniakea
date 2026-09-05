export interface SystemPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface ProjectedSystemPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

export interface SystemCamera3D {
  yaw: number;
  tilt: number;
  focalLength: number;
  perspectiveStrength: number;
}

interface ProjectionLayout {
  planets: Array<{
    orbitRadius: number;
    moons: Array<{ dist: number }>;
  }>;
}

const DEFAULT_EXTENT = 1000;
const DEFAULT_TILT = 58 * Math.PI / 180;
const DEFAULT_YAW = -18 * Math.PI / 180;

export function orbitPoint(angle: number, radius: number, height = 0, out?: SystemPoint3D): SystemPoint3D {
  const point = out ?? { x: 0, y: 0, z: 0 };
  point.x = Math.cos(angle) * radius;
  point.y = height;
  point.z = Math.sin(angle) * radius;
  return point;
}

export function addSystemPoints(a: SystemPoint3D, b: SystemPoint3D, out?: SystemPoint3D): SystemPoint3D {
  const point = out ?? { x: 0, y: 0, z: 0 };
  point.x = a.x + b.x;
  point.y = a.y + b.y;
  point.z = a.z + b.z;
  return point;
}

export function projectSystemPoint(
  point: SystemPoint3D,
  camera: SystemCamera3D,
  out?: ProjectedSystemPoint,
): ProjectedSystemPoint {
  const projected = out ?? { x: 0, y: 0, depth: 0, scale: 1 };
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosTilt = Math.cos(camera.tilt);
  const sinTilt = Math.sin(camera.tilt);
  const rotatedX = point.x * cosYaw - point.z * sinYaw;
  const rotatedZ = point.x * sinYaw + point.z * cosYaw;
  const screenY = rotatedZ * cosTilt - point.y * sinTilt;
  const depth = rotatedZ * sinTilt + point.y * cosTilt;
  const perspective = camera.focalLength / (camera.focalLength - depth);
  const scale = 1 + (perspective - 1) * camera.perspectiveStrength;
  projected.x = rotatedX * scale;
  projected.y = screenY * scale;
  projected.depth = depth;
  projected.scale = scale;
  return projected;
}

export function projectOrbitPoint(
  angle: number,
  radius: number,
  camera: SystemCamera3D,
  out?: ProjectedSystemPoint,
): ProjectedSystemPoint {
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosTilt = Math.cos(camera.tilt);
  const sinTilt = Math.sin(camera.tilt);
  const rotatedX = (cosAngle * cosYaw - sinAngle * sinYaw) * radius;
  const rotatedZ = (cosAngle * sinYaw + sinAngle * cosYaw) * radius;
  const depth = rotatedZ * sinTilt;
  const perspective = camera.focalLength / (camera.focalLength - depth);
  const scale = 1 + (perspective - 1) * camera.perspectiveStrength;
  const projected = out ?? { x: 0, y: 0, depth: 0, scale: 1 };
  projected.x = rotatedX * scale;
  projected.y = rotatedZ * cosTilt * scale;
  projected.depth = depth;
  projected.scale = scale;
  return projected;
}

export function viewSpaceDirection(
  vector: SystemPoint3D,
  camera: SystemCamera3D,
  out?: SystemPoint3D,
): SystemPoint3D {
  const direction = out ?? { x: 0, y: 0, z: 0 };
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosTilt = Math.cos(camera.tilt);
  const sinTilt = Math.sin(camera.tilt);
  const rotatedX = vector.x * cosYaw - vector.z * sinYaw;
  const rotatedZ = vector.x * sinYaw + vector.z * cosYaw;
  const viewY = rotatedZ * cosTilt - vector.y * sinTilt;
  const viewZ = rotatedZ * sinTilt + vector.y * cosTilt;
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

export function createSystemCamera(layout: ProjectionLayout): SystemCamera3D {
  return {
    yaw: DEFAULT_YAW,
    tilt: DEFAULT_TILT,
    focalLength: getSystemExtent(layout) * 4,
    perspectiveStrength: 0.35,
  };
}
