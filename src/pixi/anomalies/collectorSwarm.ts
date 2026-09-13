import { Graphics } from 'pixi.js';
import { ORBITAL_K } from '../../game/planetGen';
import type { Rng } from '../../game/types';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { makeSelectable, SHELL_Z, TAU } from './shared';

export interface CollectorSwarmStyle {
  count: number;
  minRings: number;
  extraRings: number;
  radiusSpread: number;
  inclinationSpread: number;
  size: number;
  backColor: number;
  backAlpha: number;
  frontColor: number;
  frontAlpha: number;
}

export const BEAM_COLLECTORS: CollectorSwarmStyle = {
  count: 300,
  minRings: 5,
  extraRings: 2,
  radiusSpread: 0.4,
  inclinationSpread: 2.2,
  size: 5,
  backColor: 0xd9c49a,
  backAlpha: 0.4,
  frontColor: 0xffe2b0,
  frontAlpha: 0.85,
};

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

export function createCollectorSwarm(
  rng: Rng,
  swarmRadius: number,
  integrity: number,
  onSelect: () => void,
  style: CollectorSwarmStyle = BEAM_COLLECTORS,
): CollectorSwarm {
  const collectors: Collector[] = [];
  const ringCount = style.minRings + Math.floor(rng() * style.extraRings);
  const perRing = Math.round(style.count / ringCount);
  for (let ring = 0; ring < ringCount; ring++) {
    const radius = swarmRadius * (1 - style.radiusSpread / 2 + rng() * style.radiusSpread);
    const inclination = (rng() - 0.5) * style.inclinationSpread;
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
  const reach = swarmRadius * (1 + style.radiusSpread / 2) * 1.1;
  makeSelectable(back, reach, onSelect);
  makeSelectable(front, reach, onSelect);

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
        const size = style.size * projected.scale;
        if (projected.depth < 0) {
          back.rect(projected.x - size, projected.y - size * 0.5, size * 2, size);
          backCount++;
        } else {
          front.rect(projected.x - size, projected.y - size * 0.5, size * 2, size);
          frontCount++;
        }
      }
      if (backCount > 0) back.fill({ color: style.backColor, alpha: style.backAlpha });
      if (frontCount > 0) front.fill({ color: style.frontColor, alpha: style.frontAlpha });
    },
  };
}
