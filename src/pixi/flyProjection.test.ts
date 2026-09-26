import { describe, expect, it } from 'vitest';
import {
  UNIVERSE_CLUSTER_MAX_STARS,
  UNIVERSE_CULL_MARGIN_PX,
  UNIVERSE_DOT_MAX_PX,
  UNIVERSE_DOT_SIZE,
  UNIVERSE_FOG_FAR,
  UNIVERSE_MAX_PITCH,
  UNIVERSE_NEAR,
} from '../game/constants';
import type { FlyCamera } from '../game/types';
import {
  clampPitch,
  createUniverseCamera,
  faceTarget,
  flyForward,
  flyRight,
  flyUp,
  projectClusterStars,
  projectUniverseClusters,
  projectUniverseMark,
  projectUniversePoint,
  universeFog,
  updateFlyBasis,
} from './flyProjection';
import type { ProjectedPoint } from './projection';
import { CLUSTER_MAX_OFFSET, CLUSTER_X, CLUSTER_Y, CLUSTER_Z, clusterRadius, clusterTemplate } from './clusterStars';

const WIDTH = 1600;
const HEIGHT = 900;
const origin: FlyCamera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

const basisFor = (camera: FlyCamera) => updateFlyBasis(camera, WIDTH, HEIGHT);
const point = (): ProjectedPoint => ({ x: 0, y: 0, depth: 0, scale: 0 });

describe('universe fly camera', () => {
  it('projects a point straight ahead to the screen centre', () => {
    const projected = point();
    expect(projectUniversePoint(0, 0, 1000, basisFor(origin), projected)).toBeGreaterThan(0);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.y).toBeCloseTo(0);
    expect(projected.depth).toBeCloseTo(1000);
  });

  it('culls points behind the camera and inside the near plane', () => {
    const projected = point();
    expect(projectUniversePoint(0, 0, -1000, basisFor(origin), projected)).toBe(0);
    expect(projected.depth).toBe(-1);
    expect(projectUniversePoint(0, 0, UNIVERSE_NEAR / 2, basisFor(origin), projected)).toBe(0);
    expect(projectUniversePoint(100_000, 0, 1000, basisFor(origin), projected)).toBe(0);
  });

  it('draws world right on the right of the screen and world up at the top', () => {
    const projected = point();
    projectUniversePoint(100, 0, 1000, basisFor(origin), projected);
    expect(projected.x).toBeGreaterThan(0);
    projectUniversePoint(0, 100, 1000, basisFor(origin), projected);
    expect(projected.y).toBeLessThan(0);
  });

  it('brings +x to the front at a quarter turn of yaw', () => {
    const projected = point();
    projectUniversePoint(1000, 0, 0, basisFor({ ...origin, yaw: Math.PI / 2 }), projected);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.depth).toBeCloseTo(1000);
  });

  it('looks up with positive pitch', () => {
    const projected = point();
    projectUniversePoint(0, 1000, 1000, basisFor({ ...origin, pitch: Math.PI / 4 }), projected);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.y).toBeCloseTo(0);
  });

  it('flies along axes that agree with the projection', () => {
    const forward = { x: 0, y: 0, z: 0 };
    const right = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 0, z: 0 };
    const projected = point();
    for (const yaw of [-2.1, 0, 0.8]) {
      for (const pitch of [-1.2, 0, 0.6]) {
        const camera = { x: 400, y: -300, z: 2500, yaw, pitch };
        flyForward(camera, forward);
        flyRight(camera, right);
        flyUp(camera, up);
        const dot = (a: typeof forward, b: typeof forward) => a.x * b.x + a.y * b.y + a.z * b.z;
        expect(dot(forward, forward)).toBeCloseTo(1);
        expect(dot(right, right)).toBeCloseTo(1);
        expect(dot(up, up)).toBeCloseTo(1);
        expect(dot(forward, right)).toBeCloseTo(0);
        expect(dot(forward, up)).toBeCloseTo(0);
        expect(dot(right, up)).toBeCloseTo(0);

        const basis = basisFor(camera);
        const ahead = (offset: typeof forward, amount: number) => projectUniversePoint(
          camera.x + forward.x * 1000 + offset.x * amount,
          camera.y + forward.y * 1000 + offset.y * amount,
          camera.z + forward.z * 1000 + offset.z * amount,
          basis, projected,
        );
        ahead(right, 0);
        expect(projected.x).toBeCloseTo(0);
        expect(projected.y).toBeCloseTo(0);
        ahead(right, 100);
        expect(projected.x).toBeGreaterThan(0);
        expect(projected.y).toBeCloseTo(0);
        ahead(up, 100);
        expect(projected.x).toBeCloseTo(0);
        expect(projected.y).toBeLessThan(0);
      }
    }
  });

  it('shrinks dots with distance and clamps them up close', () => {
    const basis = basisFor(origin);
    const near = point();
    const far = point();
    const nearDepth = UNIVERSE_FOG_FAR / 8;
    projectUniversePoint(0, 0, nearDepth, basis, near);
    projectUniversePoint(0, 0, nearDepth * 4, basis, far);
    expect(near.scale).toBeCloseTo(UNIVERSE_DOT_SIZE * basis.focal / nearDepth);
    expect(far.scale).toBeCloseTo(near.scale / 4);
    const touching = point();
    projectUniversePoint(0, 0, UNIVERSE_NEAR + 1, basis, touching);
    expect(touching.scale).toBe(UNIVERSE_DOT_MAX_PX);
  });

  it('fogs dots out by the far distance', () => {
    expect(universeFog(0)).toBe(1);
    expect(universeFog(UNIVERSE_FOG_FAR / 2)).toBeGreaterThan(0);
    expect(universeFog(UNIVERSE_FOG_FAR)).toBe(0);
    expect(projectUniversePoint(0, 0, UNIVERSE_FOG_FAR + 10, basisFor(origin), point())).toBe(0);
    const basis = basisFor(origin);
    expect(projectUniversePoint(0, 0, UNIVERSE_FOG_FAR / 10, basis, point()))
      .toBeGreaterThan(projectUniversePoint(0, 0, UNIVERSE_FOG_FAR * 0.6, basis, point()));
  });

  it('culls a cluster as a sphere of its star extent, keeping one whose centre is off screen or behind', () => {
    const basis = basisFor(origin);
    const brightness = 0.6;
    const extent = clusterRadius(brightness) * CLUSTER_MAX_OFFSET;
    const slopeX = (basis.halfWidth + UNIVERSE_CULL_MARGIN_PX) / basis.focal;
    const depth = 300;
    const edge = depth * slopeX;
    const reach = extent * Math.sqrt(1 + slopeX * slopeX);
    const points = [[0, 0, depth], [edge + reach * 0.95, 0, depth], [edge + reach * 1.05, 0, depth], [0, 0, -extent * 0.5], [0, 0, -extent * 2]];
    const out = points.map(() => 0);
    const outX = new Float32Array(points.length);
    const outY = new Float32Array(points.length);
    const outDepth = new Float32Array(points.length);
    const outRadius = new Float32Array(points.length);
    const outFog = new Float32Array(points.length);
    projectUniverseClusters(
      Float32Array.from(points.map((p) => p[0])),
      Float32Array.from(points.map((p) => p[1])),
      Float32Array.from(points.map((p) => p[2])),
      Float32Array.from(out.map(() => brightness)),
      basis, outX, outY, outDepth, outRadius, outFog,
    );
    expect(outX[0]).toBeCloseTo(0);
    expect(outY[0]).toBeCloseTo(0);
    expect(outRadius[0]).toBeCloseTo(clusterRadius(brightness) * basis.focal / depth, 3);
    expect(outFog[0]).toBeCloseTo(universeFog(depth), 5);
    expect(outFog[1]).toBeGreaterThan(0);
    expect(outFog[2]).toBe(0);
    expect(outFog[3]).toBeGreaterThan(0);
    expect(outRadius[3]).toBe(Infinity);
    expect(outFog[4]).toBe(0);
  });

  it('culls a cluster past the fog', () => {
    const outFog = new Float32Array(1);
    const empty = () => new Float32Array(1);
    projectUniverseClusters(
      Float32Array.of(0), Float32Array.of(0), Float32Array.of(UNIVERSE_FOG_FAR + 10), Float32Array.of(0.5),
      basisFor(origin), empty(), empty(), empty(), empty(), outFog,
    );
    expect(outFog[0]).toBe(0);
  });

  it("projects a cluster's template stars and fades in the last one shown", () => {
    const basis = basisFor(origin);
    const template = clusterTemplate(12345);
    const radius = clusterRadius(0.8);
    const centre = [20, -10, 400];
    const outX = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const outY = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const outSize = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const outAlpha = new Float32Array(UNIVERSE_CLUSTER_MAX_STARS);
    const count = projectClusterStars(centre[0], centre[1], centre[2], radius, template, 6.25, basis, outX, outY, outSize, outAlpha);
    expect(count).toBe(7);
    const base = template * UNIVERSE_CLUSTER_MAX_STARS;
    for (let k = 0; k < count; k++) {
      const projected = point();
      projectUniverseMark(
        centre[0] + CLUSTER_X[base + k] * radius,
        centre[1] + CLUSTER_Y[base + k] * radius,
        centre[2] + CLUSTER_Z[base + k] * radius,
        basis, projected,
      );
      expect(outX[k]).toBeCloseTo(projected.x, 2);
      expect(outY[k]).toBeCloseTo(projected.y, 2);
    }
    expect(outAlpha[6]).toBeCloseTo(0.25, 5);
    expect(outAlpha[0]).toBe(1);
  });

  it('turns to face a target', () => {
    const camera = { x: 500, y: 300, z: -2000, yaw: 1, pitch: 0.4 };
    faceTarget(camera, -800, 1200, 3000);
    const projected = point();
    projectUniversePoint(-800, 1200, 3000, basisFor(camera), projected);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.y).toBeCloseTo(0);
  });

  it('clamps pitch short of straight up and down', () => {
    expect(clampPitch(0.3)).toBe(0.3);
    expect(clampPitch(Math.PI)).toBe(UNIVERSE_MAX_PITCH);
    expect(clampPitch(-Math.PI)).toBe(-UNIVERSE_MAX_PITCH);
    expect(UNIVERSE_MAX_PITCH).toBeLessThan(Math.PI / 2);
  });

  it('opens near the centre looking at Laniakea', () => {
    const camera = createUniverseCamera();
    const projected = point();
    expect(projectUniversePoint(0, 0, 0, basisFor(camera), projected)).toBeGreaterThan(0);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.y).toBeCloseTo(0);
  });
});
