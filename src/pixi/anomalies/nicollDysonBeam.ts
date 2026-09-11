import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { ORBITAL_K } from '../../game/planetGen';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { drawTaper, makeSelectable, mixColor, SHELL_Z, sputter, TAU, toSystemDirection } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const COLLECTOR_COUNT = 300;
const COLLECTOR_SIZE = 5;
const BEAM_SEGMENTS = 14;
const BEAM_WIDTH = 16;
const LENS_RADIUS = 26;

interface Collector {
  radius: number;
  cosInclination: number;
  sinInclination: number;
  cosNode: number;
  sinNode: number;
  phase: number;
  speed: number;
}

function wrapAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export function createNicollDysonBeam({ anomaly, sunRadius, starColor, innermostOrbit, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const axis = toSystemDirection(anomaly.direction);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.72);
  const lensDistance = Math.min(swarmRadius * 1.35, innermostOrbit * 0.9);
  const beamLength = planetExtent * 3;
  const coreColor = mixColor(starColor, 0xffffff, 0.65);
  const glowColor = mixColor(starColor, 0xff9a50, 0.3);
  const timeOffset = rng() * 100;

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
      length: (1 - anomaly.integrity) * TAU / gapCount * (0.6 + rng() * 0.8),
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
  const nodes: Container[] = [back, front, lens, ...segments];

  return {
    nodes,
    extent: lensDistance + LENS_RADIUS,
    starAlpha: 1,
    coronaAlpha: 0.6,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
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
