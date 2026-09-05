import { Graphics } from 'pixi.js';
import type { PlanetLayout } from '../game/planetGen';
import { projectOrbitPointWithBasis, updateProjectionBasis, type Camera3D } from './projection';

const SYSTEM_SEGMENTS = 96;
const MOON_SEGMENTS = 48;
const DEPTH_BANDS = 16;

type Segment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  depth: number;
};

export function createSystemOrbitGraphics(planets: PlanetLayout[], camera: Camera3D): Graphics[] {
  const basis = updateProjectionBasis(camera);
  const segments: Segment[] = [];
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (const planet of planets) {
    let previous = projectOrbitPointWithBasis(0, planet.orbitRadius, basis);
    for (let index = 1; index <= SYSTEM_SEGMENTS; index++) {
      const current = projectOrbitPointWithBasis(index / SYSTEM_SEGMENTS * Math.PI * 2, planet.orbitRadius, basis);
      const depth = (previous.depth + current.depth) * 0.5;
      segments.push({ ax: previous.x, ay: previous.y, bx: current.x, by: current.y, depth });
      minDepth = Math.min(minDepth, depth);
      maxDepth = Math.max(maxDepth, depth);
      previous = current;
    }
  }

  if (segments.length === 0) return [];
  const span = Math.max(1, maxDepth - minDepth);
  const bands = Array.from({ length: DEPTH_BANDS }, () => new Graphics());
  for (const segment of segments) {
    const bandIndex = Math.min(DEPTH_BANDS - 1, Math.floor((segment.depth - minDepth) / span * DEPTH_BANDS));
    bands[bandIndex].moveTo(segment.ax, segment.ay).lineTo(segment.bx, segment.by);
  }
  for (let index = 0; index < bands.length; index++) {
    const nearAmount = index / (bands.length - 1);
    bands[index].stroke({ color: 0xffffff, width: 2, alpha: 0.16 + nearAmount * 0.12 });
    bands[index].zIndex = minDepth + (index + 0.5) / DEPTH_BANDS * span;
    bands[index].eventMode = 'none';
  }
  return bands;
}

export function createMoonOrbitGraphics(distances: number[], camera: Camera3D): { far: Graphics; near: Graphics } {
  const far = new Graphics();
  const near = new Graphics();
  const orthographicCamera = { ...camera, perspectiveStrength: 0 };
  const basis = updateProjectionBasis(orthographicCamera);

  for (const distance of distances) {
    let previous = projectOrbitPointWithBasis(0, distance, basis);
    for (let index = 1; index <= MOON_SEGMENTS; index++) {
      const current = projectOrbitPointWithBasis(index / MOON_SEGMENTS * Math.PI * 2, distance, basis);
      const target = previous.depth + current.depth < 0 ? far : near;
      target.moveTo(previous.x, previous.y).lineTo(current.x, current.y);
      previous = current;
    }
  }
  far.stroke({ color: 0xffffff, width: 2, alpha: 0.2 });
  near.stroke({ color: 0xffffff, width: 2, alpha: 0.28 });
  far.eventMode = 'none';
  near.eventMode = 'none';
  return { far, near };
}
