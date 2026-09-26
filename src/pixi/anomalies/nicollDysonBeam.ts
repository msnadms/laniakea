import { Graphics, type Circle, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createPanelBatch, createPanelShader, type PanelInstance, type PanelLook } from './collectorPanels';
import { BEAM_COLLECTORS, createCollectorSwarm, RUINED_BEAM_COLLECTORS } from './collectorSwarm';
import { createPlasmaStrip } from './plasmaStrip';
import { orthonormalFrame } from './shellLattice';
import { makeSelectable, mixColor, sputter, toSystemDirection } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const BEAM_SEGMENTS = 14;
const FEED_RAYS = 18;

const LENS_LOOK: PanelLook = {
  outline: 'disc',
  transmission: 0.1,
  mirror: true,
  cells: 9,
  aspect: 1,
  face: 0xa4acb8,
  reflectivity: 1,
  hull: 0x585d66,
  heat: 0xff7a3a,
  heatStrength: 0.18,
  lights: true,
  ambient: 0.14,
};

export function createNicollDysonBeam({ anomaly, sunRadius, starColor, innermostOrbit, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const axis = toSystemDirection(anomaly.direction);
  const { tangent, bitangent } = orthonormalFrame(axis);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.72);
  const lensDistance = Math.min(swarmRadius * 1.35, innermostOrbit * 0.9);
  const lensRadius = Math.min(sunRadius * 0.22, lensDistance * 0.2);
  const beamLength = planetExtent * 3;
  const beamWidth = lensRadius * 0.4;
  const coreColor = mixColor(starColor, 0xffffff, 0.65);
  const glowColor = mixColor(starColor, 0xff9a50, 0.3);
  const timeOffset = rng() * 100;

  const swarm = createCollectorSwarm(rng, swarmRadius, anomaly.integrity, starColor, onSelect, anomaly.living ? BEAM_COLLECTORS : RUINED_BEAM_COLLECTORS);
  const feedSources = Array.from({ length: FEED_RAYS }, () => Math.floor(rng() * swarm.count));

  const lensCenter: Point3D = { x: axis.x * lensDistance, y: axis.y * lensDistance, z: axis.z * lensDistance };
  const lensPanel: PanelInstance = {
    center: lensCenter,
    normal: { x: -axis.x, y: -axis.y, z: -axis.z },
    tangent,
    bitangent,
    size: lensRadius,
    seed: rng() * 100,
    damage: anomaly.living ? 0 : (1 - anomaly.integrity) * 0.6,
  };
  const lensShader = createPanelShader(LENS_LOOK, starColor);
  const lens = createPanelBatch(1, lensShader.shader, 1);
  makeSelectable(lens.mesh, lensRadius, onSelect);
  const hit = lens.mesh.hitArea as Circle;

  const aperture = new Graphics()
    .circle(0, 0, 1).fill({ color: glowColor, alpha: 0.18 })
    .circle(0, 0, 0.4).fill({ color: coreColor, alpha: 0.45 })
    .circle(0, 0, 0.14).fill({ color: 0xffffff, alpha: 0.95 });
  aperture.blendMode = 'add';
  aperture.eventMode = 'none';
  const feed = new Graphics();
  feed.blendMode = 'add';
  feed.eventMode = 'none';

  const beam = createPlasmaStrip(BEAM_SEGMENTS, {
    core: coreColor,
    coreWidth: 0.3,
    sheath: glowColor,
    sheathStrength: 0.35,
    sheathFar: glowColor,
    flowScale: 18,
    flowSpeed: 6,
    knots: 0,
    knotStrength: 0,
    turbulence: 0.15,
  });
  const beamPoints: ProjectedPoint[] = Array.from({ length: BEAM_SEGMENTS + 1 }, () => ({ x: 0, y: 0, depth: 0, scale: 1 }));
  const beamAlong = Array.from({ length: BEAM_SEGMENTS + 1 }, (_, i) => i / BEAM_SEGMENTS);
  const beamWidths = new Float32Array(BEAM_SEGMENTS + 1);
  const beamIntensity = new Float32Array(BEAM_SEGMENTS + 1);

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const source: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const order = [0];
  const nodes: Container[] = [swarm.back, swarm.front, lens.mesh, aperture, feed, ...beam.segments];

  return {
    nodes,
    extent: lensDistance + lensRadius,
    starAlpha: 1,
    coronaAlpha: 0.6,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);

      const time = elapsed + timeOffset;
      const burst = 0.06 + 0.94 * sputter(time);

      projectSystemPointWithBasis(lensCenter, basis, projected);
      lens.write([lensPanel], order, 1, basis);
      lensShader.setTime(elapsed);
      lens.mesh.zIndex = projected.depth - 0.001;
      hit.x = projected.x;
      hit.y = projected.y;
      hit.radius = lensRadius * projected.scale;

      aperture.position.set(projected.x, projected.y);
      aperture.scale.set(lensRadius * 0.55 * projected.scale * (0.85 + 0.3 * burst));
      aperture.zIndex = projected.depth;
      aperture.alpha = 0.3 + 0.7 * burst;

      feed.clear();
      for (let i = 0; i < FEED_RAYS; i++) {
        swarm.position(feedSources[i], elapsed, point);
        projectSystemPointWithBasis(point, basis, source);
        const flicker = 0.5 + 0.5 * Math.sin(time * 3.7 + i * 1.9);
        feed.moveTo(source.x, source.y).lineTo(projected.x, projected.y)
          .stroke({ color: coreColor, width: 0.9 * source.scale, alpha: (0.05 + 0.12 * flicker) * burst });
      }
      feed.zIndex = projected.depth;

      for (let i = 0; i <= BEAM_SEGMENTS; i++) {
        const t = i / BEAM_SEGMENTS;
        const reach = lensDistance + beamLength * t;
        point.x = axis.x * reach;
        point.y = axis.y * reach;
        point.z = axis.z * reach;
        const p = projectSystemPointWithBasis(point, basis, beamPoints[i]);
        const packet = 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin((t * 9 - time * 2.4) * Math.PI)), 3);
        beamIntensity[i] = burst * packet * Math.pow(1 - t, 0.7) * 1.3;
        beamWidths[i] = beamWidth * 2.6 * (1 - 0.75 * t) * p.scale;
      }
      beam.update(beamPoints, beamWidths, beamAlong, beamIntensity, time);
    },
    destroy() {
      swarm.destroy();
      lens.destroy();
      lensShader.destroy();
      beam.destroy();
      aperture.destroy();
      feed.destroy();
    },
  };
}
