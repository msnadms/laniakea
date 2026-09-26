import type { FlyCamera } from '../game/types';
import type { ProjectedPoint } from './projection';
import { CLUSTER_MAX_OFFSET, CLUSTER_SIZE, CLUSTER_X, CLUSTER_Y, CLUSTER_Z, clusterRadius } from './clusterStars';
import {
  UNIVERSE_CLUSTER_MAX_STARS,
  UNIVERSE_CULL_MARGIN_PX,
  UNIVERSE_DOT_MAX_PX,
  UNIVERSE_DOT_MIN_PX,
  UNIVERSE_DOT_SIZE,
  UNIVERSE_FOG_FAR,
  UNIVERSE_FOV,
  UNIVERSE_MAX_PITCH,
  UNIVERSE_NEAR,
  UNIVERSE_NEAR_FADE,
  UNIVERSE_STAR_MAX_PX,
  UNIVERSE_STAR_MIN_PX,
  UNIVERSE_STAR_SIZE,
  UNIVERSE_START_BACKOFF,
} from '../game/constants';

export interface FlyBasis {
  x: number;
  y: number;
  z: number;
  cosYaw: number;
  sinYaw: number;
  cosPitch: number;
  sinPitch: number;
  focal: number;
  halfWidth: number;
  halfHeight: number;
}

export function createUniverseCamera(): FlyCamera {
  return { x: 0, y: 0, z: -UNIVERSE_START_BACKOFF, yaw: 0, pitch: 0 };
}

export function clampPitch(pitch: number): number {
  return Math.min(UNIVERSE_MAX_PITCH, Math.max(-UNIVERSE_MAX_PITCH, pitch));
}

export function faceTarget(camera: FlyCamera, tx: number, ty: number, tz: number): void {
  const dx = tx - camera.x;
  const dy = ty - camera.y;
  const dz = tz - camera.z;
  if (dx * dx + dy * dy + dz * dz < 1) return;
  camera.yaw = Math.atan2(dx, dz);
  camera.pitch = clampPitch(Math.atan2(dy, Math.hypot(dx, dz)));
}

export function updateFlyBasis(camera: FlyCamera, width: number, height: number, out?: FlyBasis): FlyBasis {
  const basis = out ?? {
    x: 0, y: 0, z: 0, cosYaw: 1, sinYaw: 0, cosPitch: 1, sinPitch: 0, focal: 1, halfWidth: 0, halfHeight: 0,
  };
  basis.x = camera.x;
  basis.y = camera.y;
  basis.z = camera.z;
  basis.cosYaw = Math.cos(camera.yaw);
  basis.sinYaw = Math.sin(camera.yaw);
  basis.cosPitch = Math.cos(camera.pitch);
  basis.sinPitch = Math.sin(camera.pitch);
  basis.focal = height / (2 * Math.tan(UNIVERSE_FOV / 2));
  basis.halfWidth = width / 2;
  basis.halfHeight = height / 2;
  return basis;
}

export function flyForward(camera: FlyCamera, out: { x: number; y: number; z: number }) {
  const cosPitch = Math.cos(camera.pitch);
  out.x = Math.sin(camera.yaw) * cosPitch;
  out.y = Math.sin(camera.pitch);
  out.z = Math.cos(camera.yaw) * cosPitch;
  return out;
}

export function flyRight(camera: FlyCamera, out: { x: number; y: number; z: number }) {
  out.x = Math.cos(camera.yaw);
  out.y = 0;
  out.z = -Math.sin(camera.yaw);
  return out;
}

export function flyUp(camera: FlyCamera, out: { x: number; y: number; z: number }) {
  const sinPitch = Math.sin(camera.pitch);
  out.x = -Math.sin(camera.yaw) * sinPitch;
  out.y = Math.cos(camera.pitch);
  out.z = -Math.cos(camera.yaw) * sinPitch;
  return out;
}

export function universeFog(distance: number): number {
  const t = distance / UNIVERSE_FOG_FAR;
  return t >= 1 ? 0 : (1 - t) * (1 - t);
}

export function universeNearFade(depth: number): number {
  return Math.min(1, Math.max(0, (depth - UNIVERSE_NEAR) / UNIVERSE_NEAR_FADE));
}

export function universeDotAlpha(distance: number, depth: number, rawPx: number): number {
  return universeFog(distance) * universeNearFade(depth) * Math.min(1, rawPx / UNIVERSE_DOT_MIN_PX);
}

export function universeDotPx(rawPx: number): number {
  return Math.min(UNIVERSE_DOT_MAX_PX, Math.max(UNIVERSE_DOT_MIN_PX, rawPx));
}

export function projectUniversePoint(px: number, py: number, pz: number, basis: FlyBasis, out: ProjectedPoint): number {
  const rx = px - basis.x;
  const ry = py - basis.y;
  const rz = pz - basis.z;
  const x1 = rx * basis.cosYaw - rz * basis.sinYaw;
  const z1 = rx * basis.sinYaw + rz * basis.cosYaw;
  const y2 = ry * basis.cosPitch - z1 * basis.sinPitch;
  const depth = z1 * basis.cosPitch + ry * basis.sinPitch;
  out.depth = -1;
  out.scale = 0;
  if (depth < UNIVERSE_NEAR) return 0;
  const inv = basis.focal / depth;
  const sx = x1 * inv;
  const sy = -y2 * inv;
  if (Math.abs(sx) > basis.halfWidth + UNIVERSE_CULL_MARGIN_PX || Math.abs(sy) > basis.halfHeight + UNIVERSE_CULL_MARGIN_PX) return 0;
  const rawPx = UNIVERSE_DOT_SIZE * inv;
  const alpha = universeDotAlpha(Math.sqrt(rx * rx + ry * ry + rz * rz), depth, rawPx);
  if (alpha <= 0) return 0;
  out.x = sx;
  out.y = sy;
  out.depth = depth;
  out.scale = universeDotPx(rawPx);
  return alpha;
}

export function projectUniverseMark(px: number, py: number, pz: number, basis: FlyBasis, out: ProjectedPoint): boolean {
  const rx = px - basis.x;
  const ry = py - basis.y;
  const rz = pz - basis.z;
  const x1 = rx * basis.cosYaw - rz * basis.sinYaw;
  const z1 = rx * basis.sinYaw + rz * basis.cosYaw;
  const y2 = ry * basis.cosPitch - z1 * basis.sinPitch;
  const depth = z1 * basis.cosPitch + ry * basis.sinPitch;
  if (depth < UNIVERSE_NEAR) return false;
  const inv = basis.focal / depth;
  out.x = x1 * inv;
  out.y = -y2 * inv;
  out.depth = depth;
  out.scale = inv;
  return true;
}

export function universeMarkDepth(px: number, py: number, pz: number, basis: FlyBasis): number {
  const rx = px - basis.x;
  const ry = py - basis.y;
  const rz = pz - basis.z;
  const z1 = rx * basis.sinYaw + rz * basis.cosYaw;
  return z1 * basis.cosPitch + ry * basis.sinPitch;
}

export function projectUniverseClusters(
  x: Float32Array,
  y: Float32Array,
  z: Float32Array,
  brightness: Float32Array,
  basis: FlyBasis,
  outX: Float32Array,
  outY: Float32Array,
  outDepth: Float32Array,
  outRadius: Float32Array,
  outFog: Float32Array,
): void {
  const { cosYaw, sinYaw, cosPitch, sinPitch, focal } = basis;
  const slopeX = (basis.halfWidth + UNIVERSE_CULL_MARGIN_PX) / focal;
  const slopeY = (basis.halfHeight + UNIVERSE_CULL_MARGIN_PX) / focal;
  const growX = Math.sqrt(1 + slopeX * slopeX);
  const growY = Math.sqrt(1 + slopeY * slopeY);
  for (let i = 0; i < x.length; i++) {
    const rx = x[i] - basis.x;
    const ry = y[i] - basis.y;
    const rz = z[i] - basis.z;
    const x1 = rx * cosYaw - rz * sinYaw;
    const z1 = rx * sinYaw + rz * cosYaw;
    const up = ry * cosPitch - z1 * sinPitch;
    const depth = z1 * cosPitch + ry * sinPitch;
    const fog = universeFog(Math.sqrt(rx * rx + ry * ry + rz * rz));
    const radius = clusterRadius(brightness[i]);
    const extent = radius * CLUSTER_MAX_OFFSET;
    if (
      fog <= 0
      || depth < -extent
      || Math.abs(x1) > depth * slopeX + extent * growX
      || Math.abs(up) > depth * slopeY + extent * growY
    ) {
      outFog[i] = 0;
      continue;
    }
    outFog[i] = fog;
    outDepth[i] = depth;
    if (depth < UNIVERSE_NEAR) {
      outRadius[i] = Infinity;
      continue;
    }
    const inv = focal / depth;
    outX[i] = x1 * inv;
    outY[i] = -up * inv;
    outRadius[i] = radius * inv;
  }
}

export function projectClusterStars(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  template: number,
  shown: number,
  basis: FlyBasis,
  outX: Float32Array,
  outY: Float32Array,
  outSize: Float32Array,
  outAlpha: Float32Array,
): number {
  const { cosYaw, sinYaw, cosPitch, sinPitch, focal } = basis;
  const limitX = basis.halfWidth + UNIVERSE_CULL_MARGIN_PX;
  const limitY = basis.halfHeight + UNIVERSE_CULL_MARGIN_PX;
  const count = Math.min(UNIVERSE_CLUSTER_MAX_STARS, Math.ceil(shown));
  const base = template * UNIVERSE_CLUSTER_MAX_STARS;
  for (let k = 0; k < count; k++) {
    const rx = cx + CLUSTER_X[base + k] * radius - basis.x;
    const ry = cy + CLUSTER_Y[base + k] * radius - basis.y;
    const rz = cz + CLUSTER_Z[base + k] * radius - basis.z;
    const x1 = rx * cosYaw - rz * sinYaw;
    const z1 = rx * sinYaw + rz * cosYaw;
    const depth = z1 * cosPitch + ry * sinPitch;
    if (depth < UNIVERSE_NEAR) {
      outAlpha[k] = 0;
      continue;
    }
    const inv = focal / depth;
    const sx = x1 * inv;
    const sy = -(ry * cosPitch - z1 * sinPitch) * inv;
    if (sx > limitX || sx < -limitX || sy > limitY || sy < -limitY) {
      outAlpha[k] = 0;
      continue;
    }
    const rawPx = UNIVERSE_STAR_SIZE * CLUSTER_SIZE[base + k] * inv;
    outX[k] = sx;
    outY[k] = sy;
    outSize[k] = Math.min(UNIVERSE_STAR_MAX_PX, Math.max(UNIVERSE_STAR_MIN_PX, rawPx));
    outAlpha[k] = universeNearFade(depth) * Math.min(1, rawPx / UNIVERSE_STAR_MIN_PX, shown - k);
  }
  return count;
}
