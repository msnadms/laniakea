import { Graphics } from 'pixi.js';
import { ORBITAL_K } from '../../game/planetGen';
import type { Rng } from '../../game/types';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { makeSelectable, SHELL_Z, TAU } from './shared';

const COLLECTOR_COUNT = 300;
const COLLECTOR_SIZE = 5;

interface Collector {
  radius: number;
  cosInclination: number;
  sinInclination: number;
  cosNode: number;
  sinNode: number;
  phase: number;
  speed: number;
}

export interface CollectorSwarm {
  back: Graphics;
  front: Graphics;
  update(elapsed: number, basis: ProjectionBasis): void;
}

function wrapAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export function createCollectorSwarm(rng: Rng, swarmRadius: number, integrity: number, onSelect: () => void): CollectorSwarm {
  const collectors: Collector[] = [];
  const ringCount = 5 + Math.floor(rng() * 2);
  const perRing = Math.round(COLLECTOR_COUNT / ringCount);
  for (let ring = 0; ring < ringCount; ring++) {
    const radius = swarmRadius * (0.8 + rng() * 0.4);
    const inclination = (rng() - 0.5) * 2.2;
    const ascendingNode = rng() * TAU;
    const speed = 0.5 * ORBITAL_K / Math.pow(radius, 1.5);
    const gapCount = 1 + Math.floor(rng() * 3);
    const gaps = Array.from({ length: gapCount }, () => ({
      start: rng() * TAU,
      length: (1 - integrity) * TAU / gapCount * (0.6 + rng() * 0.8),
    }));
    for (let k = 0; k < perRing; k++) {
      const phase = k / perRing * TAU;
      if (gaps.some((gap) => wrapAngle(phase - gap.start) < gap.length)) continue;
      collectors.push({
        radius,
        cosInclination: Math.cos(inclination),
        sinInclination: Math.sin(inclination),
        cosNode: Math.cos(ascendingNode),
        sinNode: Math.sin(ascendingNode),
        phase,
        speed,
      });
    }
  }

  const back = new Graphics();
  back.zIndex = -SHELL_Z;
  const front = new Graphics();
  front.zIndex = SHELL_Z;
  makeSelectable(back, swarmRadius * 1.25, onSelect);
  makeSelectable(front, swarmRadius * 1.25, onSelect);

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

  return {
    back,
    front,
    update(elapsed: number, basis: ProjectionBasis) {
      back.clear();
      front.clear();
      let backCount = 0;
      let frontCount = 0;
      for (const collector of collectors) {
        const angle = collector.phase + collector.speed * elapsed;
        const px = Math.cos(angle) * collector.radius;
        const pz = Math.sin(angle) * collector.radius;
        const inclinedZ = pz * collector.cosInclination;
        point.x = px * collector.cosNode - inclinedZ * collector.sinNode;
        point.y = -pz * collector.sinInclination;
        point.z = px * collector.sinNode + inclinedZ * collector.cosNode;
        projectSystemPointWithBasis(point, basis, projected);
        const size = COLLECTOR_SIZE * projected.scale;
        if (projected.depth < 0) {
          back.rect(projected.x - size, projected.y - size * 0.5, size * 2, size);
          backCount++;
        } else {
          front.rect(projected.x - size, projected.y - size * 0.5, size * 2, size);
          frontCount++;
        }
      }
      if (backCount > 0) back.fill({ color: 0xd9c49a, alpha: 0.4 });
      if (frontCount > 0) front.fill({ color: 0xffe2b0, alpha: 0.85 });
    },
  };
}
