import { anomalyVisualRng } from '../../game/anomalies';
import { BLACK_HOLE_HORIZON_RADIUS } from '../../game/constants';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { BLACK_HOLE_EXTENT, createBlackHoleBody, type BlackHoleAxes, type BlackHoleLook } from './blackHoleBody';
import { makeSelectable, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const MAX_DISK_TILT = 0.3;

const ACTIVE_LOOK: BlackHoleLook = {
  innerRadius: 3,
  outerRadius: 7.5,
  peakTemperature: 4.6,
  opacity: 0.92,
  spin: 0.5,
  flowCycle: 14,
  exposure: 4,
};

const QUIESCENT_LOOK: BlackHoleLook = {
  innerRadius: 3,
  outerRadius: 6.5,
  peakTemperature: 2.8,
  opacity: 0.55,
  spin: 0.35,
  flowCycle: 18,
  exposure: 2.6,
};

function normalize(point: Point3D): Point3D {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

function diskAxes(tilt: number, heading: number): BlackHoleAxes {
  const normal = { x: Math.sin(tilt) * Math.cos(heading), y: Math.cos(tilt), z: Math.sin(tilt) * Math.sin(heading) };
  const x = normalize({ x: 1 - normal.x * normal.x, y: -normal.x * normal.y, z: -normal.x * normal.z });
  const z = {
    x: x.y * normal.z - x.z * normal.y,
    y: x.z * normal.x - x.x * normal.z,
    z: x.x * normal.y - x.y * normal.x,
  };
  return { x, normal, z };
}

export function createBlackHole({ anomaly, skyLens, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const active = anomaly.active;
  const look = active ? ACTIVE_LOOK : QUIESCENT_LOOK;
  const flickerPhase = rng() * TAU;
  const axes = diskAxes(rng() * MAX_DISK_TILT, rng() * TAU);
  const body = createBlackHoleBody(look, axes, [rng() * 97, rng() * 97, rng() * 97]);
  makeSelectable(body.mesh, look.outerRadius, onSelect);

  const centre: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };

  return {
    nodes: [body.mesh],
    extent: BLACK_HOLE_HORIZON_RADIUS * BLACK_HOLE_EXTENT,
    starAlpha: 0,
    coronaAlpha: 0,
    nebulaColor: 0x000000,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      projectSystemPointWithBasis(centre, basis, projected);
      body.mesh.position.set(projected.x, projected.y);
      body.mesh.scale.set(projected.scale * BLACK_HOLE_HORIZON_RADIUS);
      body.mesh.zIndex = projected.depth;
      const flicker = active
        ? 1 + 0.08 * Math.sin(elapsed * 7.3 + flickerPhase) + 0.05 * Math.sin(elapsed * 2.9 + flickerPhase * 2)
        : 1;
      body.update(elapsed, look.exposure * flicker, basis, skyLens.current);
    },
    destroy() {
      body.mesh.destroy();
      body.destroy();
    },
  };
}
