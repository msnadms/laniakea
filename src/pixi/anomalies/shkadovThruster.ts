import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { applyIntegrity, buildCapLattice, createPanelSet, drawShellHalf, orientShell, orthonormalFrame, type PanelShader } from './shellLattice';
import { depthComponent, makeSelectable, mixColor, scaleColor, SHELL_Z, TAU, toSystemDirection } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const MIRROR_PANELS = 380;
const MIRROR_HALF_ANGLE = 60 * Math.PI / 180;
const PLUME_RAYS = 28;
const PLUME_HALF_ANGLE = 22 * Math.PI / 180;
const OUTER_DARK = 0x15161a;
const OUTER_LIGHT = 0x272a31;
const MIRROR_BASE = 0x9aa0aa;

interface PlumeRay {
  direction: Point3D;
  length: number;
  width: number;
  alpha: number;
  frequency: number;
  phase: number;
  white: boolean;
}

export function createShkadovThruster({ anomaly, sunRadius, starColor, innermostOrbit, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const radius = Math.min(sunRadius * 2.2, innermostOrbit * 0.88);
  const axis = toSystemDirection(anomaly.direction);
  const mirror = createPanelSet(applyIntegrity(buildCapLattice(MIRROR_PANELS, MIRROR_HALF_ANGLE, axis, rng), anomaly.integrity, rng), radius);
  const mirrorColor = mixColor(MIRROR_BASE, starColor, 0.4);

  const shade: PanelShader = (panel, facing, out) => {
    if (facing > 0) {
      const rim = Math.pow(1 - facing, 3);
      out.color = mixColor(mixColor(OUTER_DARK, OUTER_LIGHT, panel.shade), starColor, rim * 0.35);
      out.alpha = 0.96;
      return;
    }
    out.color = mixColor(scaleColor(mirrorColor, 0.55 + 0.35 * panel.shade), 0xffffff, Math.pow(-facing, 6) * 0.6);
    out.alpha = 0.9;
  };

  const exhaust = { x: -axis.x, y: -axis.y, z: -axis.z };
  const { tangent, bitangent } = orthonormalFrame(exhaust);
  const rays: PlumeRay[] = Array.from({ length: PLUME_RAYS }, () => {
    const spread = PLUME_HALF_ANGLE * Math.sqrt(rng());
    const around = rng() * TAU;
    const along = Math.cos(spread);
    const across = Math.sin(spread);
    return {
      direction: {
        x: exhaust.x * along + (tangent.x * Math.cos(around) + bitangent.x * Math.sin(around)) * across,
        y: exhaust.y * along + (tangent.y * Math.cos(around) + bitangent.y * Math.sin(around)) * across,
        z: exhaust.z * along + (tangent.z * Math.cos(around) + bitangent.z * Math.sin(around)) * across,
      },
      length: sunRadius * (2.6 + rng() * 3.2),
      width: 1 + rng() * 2.4,
      alpha: 0.1 + rng() * 0.2,
      frequency: 0.4 + rng() * 1.2,
      phase: rng() * TAU,
      white: rng() < 0.35,
    };
  });

  const back = new Graphics();
  back.zIndex = -SHELL_Z;
  const front = new Graphics();
  front.zIndex = SHELL_Z;
  const plume = new Graphics();
  plume.blendMode = 'screen';
  plume.eventMode = 'none';
  makeSelectable(back, radius, onSelect);
  makeSelectable(front, radius, onSelect);

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const start: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const end: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const nodes: Container[] = [back, plume, front];

  return {
    nodes,
    extent: radius,
    starAlpha: 1,
    coronaAlpha: 1,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      orientShell(mirror, basis);
      back.clear();
      front.clear();
      drawShellHalf(back, mirror, shade, 'back');
      drawShellHalf(front, mirror, shade, 'front');

      plume.clear();
      for (const ray of rays) {
        const reach = ray.length * (1 + 0.15 * Math.sin(elapsed * ray.frequency + ray.phase));
        point.x = ray.direction.x * sunRadius * 0.9;
        point.y = ray.direction.y * sunRadius * 0.9;
        point.z = ray.direction.z * sunRadius * 0.9;
        projectSystemPointWithBasis(point, basis, start);
        point.x = ray.direction.x * reach;
        point.y = ray.direction.y * reach;
        point.z = ray.direction.z * reach;
        projectSystemPointWithBasis(point, basis, end);
        plume
          .moveTo(start.x, start.y)
          .lineTo(end.x, end.y)
          .stroke({ color: ray.white ? 0xffffff : starColor, width: ray.width * start.scale, alpha: ray.alpha });
      }
      plume.zIndex = depthComponent(exhaust, basis) > 0 ? SHELL_Z / 2 : -SHELL_Z / 2;
    },
    destroy() {
      for (const node of nodes) node.destroy();
    },
  };
}
