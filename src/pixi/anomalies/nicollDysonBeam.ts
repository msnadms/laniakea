import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createCollectorSwarm } from './collectorSwarm';
import { drawTaper, makeSelectable, mixColor, sputter, toSystemDirection } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const BEAM_SEGMENTS = 14;
const BEAM_WIDTH = 16;
const LENS_RADIUS = 26;

export function createNicollDysonBeam({ anomaly, sunRadius, starColor, innermostOrbit, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const axis = toSystemDirection(anomaly.direction);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.72);
  const lensDistance = Math.min(swarmRadius * 1.35, innermostOrbit * 0.9);
  const beamLength = planetExtent * 3;
  const coreColor = mixColor(starColor, 0xffffff, 0.65);
  const glowColor = mixColor(starColor, 0xff9a50, 0.3);
  const timeOffset = rng() * 100;

  const swarm = createCollectorSwarm(rng, swarmRadius, anomaly.integrity, onSelect);

  const lens = new Graphics()
    .circle(0, 0, LENS_RADIUS).fill({ color: glowColor, alpha: 0.14 })
    .circle(0, 0, LENS_RADIUS * 0.45).fill({ color: coreColor, alpha: 0.4 })
    .circle(0, 0, LENS_RADIUS * 0.18).fill({ color: 0xffffff, alpha: 0.95 });
  lens.blendMode = 'add';
  makeSelectable(lens, LENS_RADIUS, onSelect);

  const segments = Array.from({ length: BEAM_SEGMENTS }, () => {
    const gfx = new Graphics();
    gfx.blendMode = 'add';
    gfx.eventMode = 'none';
    return gfx;
  });
  const beamPoints: ProjectedPoint[] = Array.from({ length: BEAM_SEGMENTS + 1 }, () => ({ x: 0, y: 0, depth: 0, scale: 1 }));

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const nodes: Container[] = [swarm.back, swarm.front, lens, ...segments];

  return {
    nodes,
    extent: lensDistance + LENS_RADIUS,
    starAlpha: 1,
    coronaAlpha: 0.6,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);

      const time = elapsed + timeOffset;
      const burst = 0.06 + 0.94 * sputter(time);

      point.x = axis.x * lensDistance;
      point.y = axis.y * lensDistance;
      point.z = axis.z * lensDistance;
      projectSystemPointWithBasis(point, basis, projected);
      lens.position.set(projected.x, projected.y);
      lens.scale.set(projected.scale * (0.85 + 0.3 * burst));
      lens.zIndex = projected.depth;
      lens.alpha = 0.45 + 0.55 * burst;

      for (let i = 0; i <= BEAM_SEGMENTS; i++) {
        const reach = lensDistance + beamLength * i / BEAM_SEGMENTS;
        point.x = axis.x * reach;
        point.y = axis.y * reach;
        point.z = axis.z * reach;
        projectSystemPointWithBasis(point, basis, beamPoints[i]);
      }
      segments.forEach((gfx, i) => {
        const from = beamPoints[i];
        const to = beamPoints[i + 1];
        const startReach = i / BEAM_SEGMENTS;
        const endReach = (i + 1) / BEAM_SEGMENTS;
        const middle = (startReach + endReach) / 2;
        const packet = 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin((middle * 9 - time * 2.4) * Math.PI)), 3);
        const intensity = burst * packet * Math.pow(1 - middle, 0.7);
        const startWidth = BEAM_WIDTH * (1 - 0.75 * startReach) * from.scale;
        const endWidth = BEAM_WIDTH * (1 - 0.75 * endReach) * to.scale;
        gfx.clear();
        drawTaper(gfx, from.x, from.y, to.x, to.y, startWidth * 3.2, endWidth * 3.2, glowColor, intensity * 0.16);
        drawTaper(gfx, from.x, from.y, to.x, to.y, startWidth, endWidth, coreColor, intensity * 0.85);
        gfx.zIndex = (from.depth + to.depth) / 2;
      });
    },
    destroy() {
      for (const node of nodes) node.destroy();
    },
  };
}
