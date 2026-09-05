import { describe, expect, it } from 'vitest';
import { generateSystemLayout } from '../game/planetGen';
import { SOL_SYSTEM_LAYOUT } from '../game/hardcoded';
import {
  addSystemPoints,
  createSystemCamera,
  getSystemExtent,
  orbitPoint,
  projectOrbitPoint,
  projectSystemPoint,
  viewSpaceDirection,
  type SystemCamera3D,
} from './systemProjection';

const faceOnCamera: SystemCamera3D = {
  yaw: 0,
  tilt: 0,
  focalLength: 10000,
  perspectiveStrength: 0,
};

describe('system projection', () => {
  it('projects the origin without changing its scale', () => {
    expect(projectSystemPoint({ x: 0, y: 0, z: 0 }, faceOnCamera)).toEqual({ x: 0, y: 0, depth: 0, scale: 1 });
  });

  it('projects face-on cardinal orbit points', () => {
    expect(projectOrbitPoint(0, 100, faceOnCamera)).toMatchObject({ x: 100, y: 0, depth: 0, scale: 1 });
    expect(projectOrbitPoint(Math.PI / 2, 100, faceOnCamera).y).toBeCloseTo(100);
    expect(projectOrbitPoint(Math.PI, 100, faceOnCamera).x).toBeCloseTo(-100);
    expect(projectOrbitPoint(Math.PI * 1.5, 100, faceOnCamera).y).toBeCloseTo(-100);
  });

  it('turns a tilted orbit into an orthographic ellipse', () => {
    const camera = { ...faceOnCamera, tilt: Math.PI / 3 };
    expect(projectOrbitPoint(0, 100, camera)).toMatchObject({ x: 100, y: 0 });
    expect(projectOrbitPoint(Math.PI / 2, 100, camera).y).toBeCloseTo(50);
  });

  it('gives near points greater depth and scale', () => {
    const camera = { ...faceOnCamera, tilt: Math.PI / 3, perspectiveStrength: 0.35 };
    const near = projectOrbitPoint(Math.PI / 2, 100, camera);
    const center = projectOrbitPoint(0, 100, camera);
    const far = projectOrbitPoint(Math.PI * 1.5, 100, camera);
    expect(near.depth).toBeGreaterThan(center.depth);
    expect(center.depth).toBeGreaterThan(far.depth);
    expect(near.scale).toBeGreaterThan(center.scale);
    expect(center.scale).toBeGreaterThan(far.scale);
    expect(near.scale).toBeGreaterThanOrEqual(1);
    expect(far.scale).toBeLessThanOrEqual(1);
  });

  it('applies yaw before tilt', () => {
    const camera = { ...faceOnCamera, yaw: Math.PI / 2 };
    const point = projectOrbitPoint(0, 100, camera);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(100);
  });

  it('keeps focal length safely outside representative layouts', () => {
    const layouts = [
      generateSystemLayout(12345, 'G'),
      generateSystemLayout(54321, 'L'),
      generateSystemLayout(98765, 'N'),
      SOL_SYSTEM_LAYOUT,
    ];
    for (const layout of layouts) {
      const camera = createSystemCamera(layout);
      expect(camera.focalLength).toBeGreaterThan(getSystemExtent(layout) * 3);
      expect(camera.focalLength).toBe(getSystemExtent(layout) * 4);
      for (const planet of layout.planets) {
        expect(camera.focalLength - planet.orbitRadius).toBeGreaterThan(0);
      }
    }
  });

  it('composes moon positions in absolute system space', () => {
    const planet = orbitPoint(0, 100);
    const moon = orbitPoint(Math.PI / 2, 20);
    expect(addSystemPoints(planet, moon)).toEqual({ x: 100, y: 0, z: 20 });
  });

  it('normalizes view-space light directions', () => {
    const camera = createSystemCamera(SOL_SYSTEM_LAYOUT);
    const direction = viewSpaceDirection({ x: -10, y: 2, z: 7 }, camera);
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1);
  });
});
