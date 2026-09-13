import { describe, expect, it } from 'vitest';
import {
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
  projectSkyDirection,
  projectUniverseField,
  projectUniversePoint,
  universeFog,
  updateFlyBasis,
} from './flyProjection';
import type { ProjectedPoint } from './projection';

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

  it('projects a whole field exactly as it projects one point', () => {
    const points = [[0, 0, 900], [300, -200, 4000], [0, 0, -500], [-9000, 4000, 12000], [50, 60, 70], [0, 0, 40_000]];
    const x = Float32Array.from(points.map((p) => p[0]));
    const y = Float32Array.from(points.map((p) => p[1]));
    const z = Float32Array.from(points.map((p) => p[2]));
    const outX = new Float32Array(points.length);
    const outY = new Float32Array(points.length);
    const outDepth = new Float32Array(points.length);
    const outSize = new Float32Array(points.length);
    const outAlpha = new Float32Array(points.length);
    const camera = { x: 120, y: -40, z: -300, yaw: 0.2, pitch: -0.1 };
    const basis = basisFor(camera);
    projectUniverseField(x, y, z, basis, outX, outY, outDepth, outSize, outAlpha);
    let visible = 0;
    for (let i = 0; i < points.length; i++) {
      const projected = point();
      const alpha = projectUniversePoint(x[i], y[i], z[i], basis, projected);
      expect(outAlpha[i]).toBeCloseTo(alpha, 5);
      expect(outDepth[i]).toBeCloseTo(projected.depth, 1);
      if (alpha === 0) continue;
      visible++;
      expect(outX[i]).toBeCloseTo(projected.x, 2);
      expect(outY[i]).toBeCloseTo(projected.y, 2);
      expect(outSize[i]).toBeCloseTo(projected.scale, 3);
    }
    expect(visible).toBeGreaterThan(1);
    expect(visible).toBeLessThan(points.length);
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

  it('turns the sky with the view but ignores position', () => {
    const here = point();
    const there = point();
    expect(projectSkyDirection(0.1, 0.05, 1, basisFor(origin), here)).toBe(true);
    projectSkyDirection(0.1, 0.05, 1, basisFor({ ...origin, x: 40_000, z: -9000 }), there);
    expect(there.x).toBeCloseTo(here.x);
    expect(there.y).toBeCloseTo(here.y);
    expect(projectSkyDirection(0, 0, -1, basisFor(origin), point())).toBe(false);
  });
});
