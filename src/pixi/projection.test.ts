import { describe, expect, it } from 'vitest';
import { generateSystemLayout } from '../game/planetGen';
import { SOL_SYSTEM_LAYOUT } from '../game/hardcoded';
import {
  GALAXY_DEPTH_SIZE,
  GALAXY_GAS_SLABS,
  GALAXY_ORBIT_MAX_TILT,
  GALAXY_ORBIT_MIN_TILT,
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
  clampGalaxyTilt,
  galaxyDepthAlpha,
  galaxyDepthScale,
  galaxyGasSlab,
  galaxyGasSlabHeight,
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

  // Gas is baked flat and turned by a container transform, which is affine; a
  // perspective divide is not, so the two would drift apart as the disk turned.
  it('is orthographic, so a world pixel keeps a fixed light-year value', () => {
    expect(camera.perspectiveStrength).toBe(0);
    for (const z of [-GALAXY_RADIUS, 0, GALAXY_RADIUS]) {
      expect(projectSystemPoint({ x: 100, y: 0, z }, camera).scale).toBe(1);
    }
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
    const near = projectSystemPoint({ x: 0, y: 0, z: GALAXY_RADIUS }, camera).depth;
    const far = projectSystemPoint({ x: 0, y: 0, z: -GALAXY_RADIUS }, camera).depth;
    expect(galaxyDepthScale(near)).toBeCloseTo(1 + GALAXY_DEPTH_SIZE);
    expect(galaxyDepthScale(0)).toBeCloseTo(1);
    expect(galaxyDepthScale(far)).toBeCloseTo(1 - GALAXY_DEPTH_SIZE);
    expect(galaxyDepthScale(far * 10)).toBeGreaterThan(0);
  });

  it('fades stars from the far edge to the near edge', () => {
    const near = projectSystemPoint({ x: 0, y: 0, z: GALAXY_RADIUS }, camera).depth;
    const far = projectSystemPoint({ x: 0, y: 0, z: -GALAXY_RADIUS }, camera).depth;
    expect(galaxyDepthAlpha(near)).toBeGreaterThan(galaxyDepthAlpha(far));
    expect(galaxyDepthAlpha(near)).toBeCloseTo(1);
  });

  it('bands gas by height, so a yaw turn cannot move a particle between bands', () => {
    const half = 40;
    expect(galaxyGasSlab(-half, half)).toBe(0);
    expect(galaxyGasSlab(0, half)).toBe(Math.floor(GALAXY_GAS_SLABS / 2));
    expect(galaxyGasSlab(half, half)).toBe(GALAXY_GAS_SLABS - 1);
    expect(galaxyGasSlab(half * 10, half)).toBe(GALAXY_GAS_SLABS - 1);
    for (let slab = 0; slab < GALAXY_GAS_SLABS; slab++) {
      expect(galaxyGasSlab(galaxyGasSlabHeight(slab, half), half)).toBe(slab);
    }
    expect(galaxyGasSlabHeight(Math.floor(GALAXY_GAS_SLABS / 2), half)).toBeCloseTo(0);
  });

  it('clamps orbit tilt clear of both edge-on and face-on', () => {
    expect(clampGalaxyTilt(GALAXY_TILT)).toBe(GALAXY_TILT);
    expect(clampGalaxyTilt(Math.PI)).toBe(GALAXY_ORBIT_MAX_TILT);
    expect(clampGalaxyTilt(-Math.PI)).toBe(GALAXY_ORBIT_MIN_TILT);
    expect(GALAXY_ORBIT_MAX_TILT).toBeLessThan(Math.PI / 2);
    expect(GALAXY_ORBIT_MIN_TILT).toBeGreaterThan(0);
  });

  // The gas keeps its baked plane geometry and is re-oriented by a rotation inside
  // a vertical squash, so the star projection has to agree with exactly that.
  it('projects a flat point as a yaw rotation inside a cos(tilt) squash', () => {
    for (const tilt of [GALAXY_ORBIT_MIN_TILT, GALAXY_TILT, GALAXY_ORBIT_MAX_TILT]) {
      for (const yaw of [-1.2, 0, 0.7]) {
        const turned = { ...camera, yaw, tilt };
        const [planeX, planeY] = [230, -640];
        const projected = projectPlanePoint(planeX, planeY, 0, turned);
        const spunX = planeX * Math.cos(yaw) - planeY * Math.sin(yaw);
        const spunY = planeX * Math.sin(yaw) + planeY * Math.cos(yaw);
        expect(projected.x).toBeCloseTo(spunX);
        expect(projected.y).toBeCloseTo(spunY * Math.cos(tilt));
      }
    }
  });

  it('offsets a band of fixed height by its height alone', () => {
    const turned = { ...camera, yaw: 0.7, tilt: 1.1 };
    const flat = projectPlanePoint(230, -640, 0, turned);
    const lifted = projectPlanePoint(230, -640, 30, turned);
    expect(lifted.x).toBeCloseTo(flat.x);
    expect(lifted.y).toBeCloseTo(flat.y - 30 * Math.sin(1.1));
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
