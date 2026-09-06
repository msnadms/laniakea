import { describe, expect, it } from 'vitest';
import { generateSystemLayout } from '../game/planetGen';
import { SOL_SYSTEM_LAYOUT } from '../game/hardcoded';
import {
  GALAXY_DEPTH_SLABS,
  GALAXY_RADIUS,
  GALAXY_TILT,
  SC_DEPTH_FADE,
  SC_DEPTH_HALF,
  SC_DEPTH_SIZE,
  SC_ORBIT_INITIAL_TILT,
  SC_ORBIT_MAX_TILT,
  SC_WORLD_HALF,
} from '../game/constants';
import {
  addSystemPoints,
  createGalaxyCamera,
  galaxyDepthAlpha,
  galaxyDepthSlab,
  clampOrbitTilt,
  createSuperclusterCamera,
  createSystemCamera,
  getSystemExtent,
  projectPlanePoint,
  projectSuperclusterField,
  superclusterDepthAlpha,
  superclusterDepthScale,
  orbitPoint,
  projectOrbitPoint,
  projectSystemPoint,
  projectSystemPointWithBasis,
  updateProjectionBasis,
  viewSpaceDirection,
  type Camera3D,
} from './projection';

const faceOnCamera: Camera3D = {
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

  it('reuses a projection basis and output object without changing the result', () => {
    const camera = createSystemCamera(SOL_SYSTEM_LAYOUT);
    const basis = updateProjectionBasis(camera);
    const point = { x: 120, y: -8, z: 45 };
    const output = { x: 0, y: 0, depth: 0, scale: 1 };
    expect(projectSystemPointWithBasis(point, basis, output)).toBe(output);
    expect(output).toEqual(projectSystemPoint(point, camera));
  });
});

describe('galaxy camera', () => {
  const camera = createGalaxyCamera();

  it('has no yaw, so screen x is a plane axis', () => {
    expect(camera.yaw).toBe(0);
    expect(camera.tilt).toBe(GALAXY_TILT);
  });

  // Perspective makes the linear world-pixel-to-light-year factor exact only where
  // depth is zero. That is the horizontal line through the galactic centre, which
  // is the axis the scale bar measures.
  it('keeps the scale bar axis free of perspective', () => {
    for (const x of [-GALAXY_RADIUS, -1, 0, 1, GALAXY_RADIUS]) {
      const projected = projectSystemPoint({ x, y: 0, z: 0 }, camera);
      expect(projected.x).toBe(x);
      expect(projected.y).toBe(0);
      expect(projected.scale).toBe(1);
    }
  });

  it('keeps focal length clear of the deepest point in the galaxy', () => {
    const deepest = projectSystemPoint({ x: 0, y: GALAXY_RADIUS, z: GALAXY_RADIUS }, camera).depth;
    expect(camera.focalLength).toBeGreaterThan(deepest * 1.5);
  });

  it('projects the galactic centre to the origin', () => {
    expect(projectSystemPoint({ x: 0, y: 0, z: 0 }, camera)).toEqual({ x: 0, y: 0, depth: 0, scale: 1 });
  });

  it('leaves plane coordinates untouched at zero tilt', () => {
    const faceOn = { ...camera, tilt: 0 };
    const projected = projectSystemPoint({ x: 137, y: 0, z: -42 }, faceOn);
    expect(projected.x).toBeCloseTo(137);
    expect(projected.y).toBeCloseTo(-42);
    expect(projected.scale).toBe(1);
  });

  it('compresses plane depth by cos(tilt) and leaves plane x exact before perspective', () => {
    const projected = projectSystemPoint({ x: 300, y: 0, z: 200 }, camera);
    expect(projected.x / projected.scale).toBeCloseTo(300);
    expect(projected.y / projected.scale).toBeCloseTo(200 * Math.cos(GALAXY_TILT));
  });

  it('lifts height up-screen and forward in depth', () => {
    const above = projectSystemPoint({ x: 0, y: 50, z: 0 }, camera);
    const below = projectSystemPoint({ x: 0, y: -50, z: 0 }, camera);
    expect(above.y / above.scale).toBeCloseTo(-50 * Math.sin(GALAXY_TILT));
    expect(above.y).toBeLessThan(0);
    expect(above.depth).toBeGreaterThan(below.depth);
  });

  it('orders the near disk edge in front of the far edge', () => {
    const near = projectSystemPoint({ x: 0, y: 0, z: GALAXY_RADIUS }, camera);
    const far = projectSystemPoint({ x: 0, y: 0, z: -GALAXY_RADIUS }, camera);
    expect(near.depth).toBeGreaterThan(far.depth);
    expect(near.y).toBeGreaterThan(far.y);
  });

  it('draws the near edge of the disk larger than the far edge', () => {
    const near = projectSystemPoint({ x: 0, y: 0, z: GALAXY_RADIUS }, camera);
    const far = projectSystemPoint({ x: 0, y: 0, z: -GALAXY_RADIUS }, camera);
    expect(near.scale).toBeGreaterThan(1.1);
    expect(far.scale).toBeLessThan(0.95);
    expect(near.scale / far.scale).toBeGreaterThan(1.25);
  });

  it('never inverts, however deep the point', () => {
    for (const z of [0, GALAXY_RADIUS * 10, -GALAXY_RADIUS * 10]) {
      expect(projectSystemPoint({ x: 100, y: 0, z }, camera).scale).toBeGreaterThan(0);
    }
  });

  it('fades and bands stars from the far edge to the near edge', () => {
    const near = projectSystemPoint({ x: 0, y: 0, z: GALAXY_RADIUS }, camera).depth;
    const far = projectSystemPoint({ x: 0, y: 0, z: -GALAXY_RADIUS }, camera).depth;
    expect(galaxyDepthAlpha(near)).toBeGreaterThan(galaxyDepthAlpha(far));
    expect(galaxyDepthAlpha(near)).toBeCloseTo(1);
    expect(galaxyDepthSlab(far)).toBe(0);
    expect(galaxyDepthSlab(0)).toBe(Math.floor(GALAXY_DEPTH_SLABS / 2));
    expect(galaxyDepthSlab(near)).toBe(GALAXY_DEPTH_SLABS - 1);
  });

  it('is deterministic for the same point and camera', () => {
    const point = { x: 12, y: -3, z: 88 };
    expect(projectSystemPoint(point, camera)).toEqual(projectSystemPoint(point, createGalaxyCamera()));
  });
});

describe('supercluster camera', () => {
  const camera = createSuperclusterCamera();

  it('is orthographic, so a world pixel keeps a fixed light-year value', () => {
    expect(camera.perspectiveStrength).toBe(0);
    for (const depth of [-SC_WORLD_HALF, 0, SC_WORLD_HALF]) {
      expect(projectSystemPoint({ x: 100, y: 0, z: depth }, camera).scale).toBe(1);
    }
  });

  it('opens tilted off the plane', () => {
    expect(camera.tilt).toBe(SC_ORBIT_INITIAL_TILT);
    expect(camera.yaw).toBe(0);
  });

  it('reproduces the flat layout exactly when turned face-on', () => {
    const faceOn = { ...camera, tilt: 0 };
    const projected = projectPlanePoint(300, -120, 400, faceOn);
    expect(projected.x).toBeCloseTo(300);
    expect(projected.y).toBeCloseTo(-120);
    expect(projected.depth).toBeCloseTo(400);
  });

  it('turns the plane about the height axis with yaw', () => {
    const turned = projectPlanePoint(100, 0, 0, { ...camera, tilt: 0, yaw: Math.PI / 2 });
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(100);
  });

  it('lifts height up-screen and forward in depth', () => {
    const above = projectPlanePoint(0, 0, 200, camera);
    const below = projectPlanePoint(0, 0, -200, camera);
    expect(above.y).toBeLessThan(0);
    expect(above.y).toBeCloseTo(-200 * Math.sin(SC_ORBIT_INITIAL_TILT));
    expect(above.depth).toBeGreaterThan(below.depth);
  });

  it('clamps tilt short of edge-on in both directions', () => {
    expect(clampOrbitTilt(0.3)).toBe(0.3);
    expect(clampOrbitTilt(Math.PI)).toBe(SC_ORBIT_MAX_TILT);
    expect(clampOrbitTilt(-Math.PI)).toBe(-SC_ORBIT_MAX_TILT);
    expect(SC_ORBIT_MAX_TILT).toBeLessThan(Math.PI / 2);
  });

  it('hazes and shrinks dots toward the far side of the field', () => {
    expect(superclusterDepthAlpha(SC_DEPTH_HALF)).toBeCloseTo(1);
    expect(superclusterDepthAlpha(0)).toBeCloseTo(1 - SC_DEPTH_FADE / 2);
    expect(superclusterDepthAlpha(-SC_DEPTH_HALF)).toBeCloseTo(1 - SC_DEPTH_FADE);
    expect(superclusterDepthScale(SC_DEPTH_HALF)).toBeCloseTo(1 + SC_DEPTH_SIZE);
    expect(superclusterDepthScale(0)).toBeCloseTo(1);
    expect(superclusterDepthScale(-SC_DEPTH_HALF)).toBeCloseTo(1 - SC_DEPTH_SIZE);
  });

  it('projects a whole field exactly as it projects one point', () => {
    const points = [
      [0, 0, 0], [SC_WORLD_HALF, -SC_WORLD_HALF, 120], [-40, 900, -SC_WORLD_HALF], [17, 3, 250],
    ];
    const planeX = Float32Array.from(points.map((p) => p[0]));
    const planeY = Float32Array.from(points.map((p) => p[1]));
    const height = Float32Array.from(points.map((p) => p[2]));
    const outX = new Float32Array(points.length);
    const outY = new Float32Array(points.length);
    const outAlpha = new Float32Array(points.length);
    const outScale = new Float32Array(points.length);
    const turned = { ...camera, yaw: 0.9, tilt: -0.4 };
    projectSuperclusterField(planeX, planeY, height, updateProjectionBasis(turned), outX, outY, outAlpha, outScale);
    for (let i = 0; i < points.length; i++) {
      const expected = projectPlanePoint(points[i][0], points[i][1], points[i][2], turned);
      expect(outX[i]).toBeCloseTo(expected.x, 2);
      expect(outY[i]).toBeCloseTo(expected.y, 2);
      expect(outAlpha[i]).toBeCloseTo(superclusterDepthAlpha(expected.depth), 5);
      expect(outScale[i]).toBeCloseTo(superclusterDepthScale(expected.depth), 5);
    }
  });

  it('never fades or shrinks past its limits, however deep the point', () => {
    expect(superclusterDepthAlpha(SC_DEPTH_HALF * 10)).toBeCloseTo(1);
    expect(superclusterDepthAlpha(-SC_DEPTH_HALF * 10)).toBeCloseTo(1 - SC_DEPTH_FADE);
    expect(superclusterDepthScale(-SC_DEPTH_HALF * 10)).toBeGreaterThan(0);
  });
});
