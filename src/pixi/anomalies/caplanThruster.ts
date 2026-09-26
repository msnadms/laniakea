import { Graphics, type Circle, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createCollectorSwarm, PHOTOVOLTAIC_LOOK, RUINED_PHOTOVOLTAIC_LOOK, type CollectorSwarmStyle } from './collectorSwarm';
import { createPlasmaStrip, STREAM_LOOK, type PlasmaLook } from './plasmaStrip';
import { orthonormalFrame } from './shellLattice';
import { makeSelectable, mixColor, TAU, toSystemDirection } from './shared';
import { CAPLAN_SHAPE, createThrusterHull, type HullLook } from './thrusterHull';
import { SUN_PHOTOSPHERE_FRACTION } from '../sunBody';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const LIVING_COLLECTORS: CollectorSwarmStyle = {
  count: 360,
  minRings: 6,
  extraRings: 3,
  radiusSpread: 0.35,
  inclinationSpread: 2.6,
  size: 6,
  tumble: false,
  look: PHOTOVOLTAIC_LOOK,
};

const RUINED_COLLECTORS: CollectorSwarmStyle = {
  ...LIVING_COLLECTORS,
  count: 280,
  tumble: true,
  look: RUINED_PHOTOVOLTAIC_LOOK,
};

const LIVING_HULL: HullLook = {
  hull: 0x8a919c,
  ambient: 0.14,
  exhaust: 0xc8d8ff,
  exhaustStrength: 1.1,
  intake: 0xff9a48,
  intakeStrength: 0.7,
  radiator: 0xff4a1a,
  radiatorStrength: 0.45,
  damage: 0,
  lights: true,
};

const RUINED_HULL: HullLook = {
  ...LIVING_HULL,
  hull: 0x3b3d42,
  ambient: 0.1,
  exhaustStrength: 0,
  intakeStrength: 0,
  radiatorStrength: 0,
  lights: false,
};

const COUNTER_LOOK: PlasmaLook = {
  core: 0xfff2f6,
  coreWidth: 0.22,
  sheath: 0xff6a98,
  sheathStrength: 0.35,
  sheathFar: 0xff6a98,
  flowScale: 14,
  flowSpeed: -3.2,
  knots: 0,
  knotStrength: 0,
  turbulence: 0.3,
};

const EXHAUST_LOOK: PlasmaLook = {
  core: 0xf0f4ff,
  coreWidth: 0.28,
  sheath: 0xa8c0ff,
  sheathStrength: 0.5,
  sheathFar: 0x3fd8c0,
  flowScale: 7,
  flowSpeed: 4,
  knots: 9,
  knotStrength: 0.9,
  turbulence: 0.5,
};

const FOCUS_RAYS = 12;
const STREAM_SEGMENTS = 10;
const JET_SEGMENTS = 16;
const ENGINE_LENGTH = 2.2;

interface FocusRay {
  spread: number;
  around: number;
  drift: number;
  alpha: number;
}

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

function additive(): Graphics {
  const gfx = new Graphics();
  gfx.blendMode = 'add';
  gfx.eventMode = 'none';
  return gfx;
}

export function createCaplanThruster({ anomaly, sunRadius, starColor, innermostOrbit, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const { living, integrity } = anomaly;
  const style = living ? LIVING_COLLECTORS : RUINED_COLLECTORS;
  const heading = toSystemDirection(anomaly.direction);
  const back: Point3D = { x: -heading.x, y: -heading.y, z: -heading.z };
  const { tangent, bitangent } = orthonormalFrame(back);

  const swarmRadius = Math.min(sunRadius * 1.6, innermostOrbit * 0.5);
  const swarmOuter = swarmRadius * (1 + style.radiusSpread / 2);
  const engineRadius = sunRadius * 0.3;
  const engineLength = engineRadius * ENGINE_LENGTH;
  const engineDistance = Math.min(Math.max(sunRadius * 2.6, swarmOuter + engineLength), innermostOrbit * 0.9 - engineLength / 2);
  const intakeDistance = engineDistance - engineLength / 2;
  const nozzleDistance = engineDistance + engineLength / 2;
  const hotspotDistance = sunRadius * SUN_PHOTOSPHERE_FRACTION * 1.02;
  const jetLength = planetExtent * 2.5;
  const timeOffset = rng() * 100;
  const rayColor = mixColor(starColor, 0xffffff, 0.5);

  const swarm = createCollectorSwarm(rng, swarmRadius, integrity, starColor, onSelect, style);

  const focusRays: FocusRay[] = Array.from({ length: FOCUS_RAYS }, () => ({
    spread: 0.35 + rng() * 0.6,
    around: rng() * TAU,
    drift: 0.05 + rng() * 0.1,
    alpha: 0.12 + rng() * 0.18,
  }));
  const gapStart = rng() * TAU;
  const gapLength = living ? 0 : (1 - integrity) * TAU * 0.8;
  const inGap = (angle: number) => ((angle - gapStart) % TAU + TAU) % TAU < gapLength;
  const finCount = CAPLAN_SHAPE.fins?.count ?? 0;
  const brokenFins = Array.from({ length: finCount }, () => !living && rng() > integrity);

  const hull = createThrusterHull(
    {
      origin: { x: back.x * engineDistance, y: back.y * engineDistance, z: back.z * engineDistance },
      axis: back,
      tangent,
      bitangent,
    },
    engineRadius,
    engineLength,
    { ...(living ? LIVING_HULL : RUINED_HULL), damage: living ? 0 : (1 - integrity) * 0.8 },
    starColor,
    (around, along, fin) => fin ? brokenFins[Math.floor(around / TAU * finCount)] : along < 0.3 && inGap(around),
  );
  makeSelectable(hull.mesh, engineRadius * 1.6, onSelect);
  const hit = hull.mesh.hitArea as Circle;

  const flow = living
    ? {
      focus: additive(),
      stream: createPlasmaStrip(STREAM_SEGMENTS, STREAM_LOOK),
      counter: createPlasmaStrip(STREAM_SEGMENTS, COUNTER_LOOK),
      jet: createPlasmaStrip(JET_SEGMENTS, EXHAUST_LOOK),
    }
    : null;
  const nodes: Container[] = [swarm.back, swarm.front, hull.mesh];
  if (flow) nodes.push(flow.focus, ...flow.stream.segments, ...flow.counter.segments, ...flow.jet.segments);

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const hotspotPoint = emptyPoint();
  const rayStart = emptyPoint();
  const streamPoints = Array.from({ length: STREAM_SEGMENTS + 1 }, emptyPoint);
  const jetPoints = Array.from({ length: JET_SEGMENTS + 1 }, emptyPoint);
  const streamAlong = Array.from({ length: STREAM_SEGMENTS + 1 }, (_, i) => i / STREAM_SEGMENTS);
  const jetAlong = Array.from({ length: JET_SEGMENTS + 1 }, (_, i) => i / JET_SEGMENTS);
  const streamWidths = new Float32Array(STREAM_SEGMENTS + 1);
  const counterWidths = new Float32Array(STREAM_SEGMENTS + 1);
  const streamIntensity = new Float32Array(STREAM_SEGMENTS + 1);
  const counterIntensity = new Float32Array(STREAM_SEGMENTS + 1);
  const jetWidths = new Float32Array(JET_SEGMENTS + 1);
  const jetIntensity = new Float32Array(JET_SEGMENTS + 1);

  const project = (distance: number, basis: ProjectionBasis, out: ProjectedPoint, radius = 0, angle = 0) => {
    const across = Math.cos(angle) * radius;
    const up = Math.sin(angle) * radius;
    point.x = back.x * distance + tangent.x * across + bitangent.x * up;
    point.y = back.y * distance + tangent.y * across + bitangent.y * up;
    point.z = back.z * distance + tangent.z * across + bitangent.z * up;
    return projectSystemPointWithBasis(point, basis, out);
  };

  return {
    nodes,
    extent: nozzleDistance + engineRadius * 1.6,
    starAlpha: 1,
    coronaAlpha: living ? 0.75 : 0.9,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);
      const time = elapsed + timeOffset;

      const center = hull.update(basis, time);
      hit.x = center.x;
      hit.y = center.y;
      hit.radius = engineRadius * 1.6 * center.scale;
      if (!flow) return;
      const { focus, stream, counter, jet } = flow;

      project(hotspotDistance, basis, hotspotPoint);

      focus.clear();
      for (const ray of focusRays) {
        project(Math.cos(ray.spread) * swarmRadius, basis, rayStart, Math.sin(ray.spread) * swarmRadius, ray.around + ray.drift * time);
        focus.moveTo(rayStart.x, rayStart.y).lineTo(hotspotPoint.x, hotspotPoint.y).stroke({ color: rayColor, width: 1.2 * rayStart.scale, alpha: ray.alpha });
      }
      focus.zIndex = hotspotPoint.depth;

      for (let i = 0; i <= STREAM_SEGMENTS; i++) {
        const t = i / STREAM_SEGMENTS;
        const p = project(hotspotDistance + (intakeDistance - hotspotDistance) * t, basis, streamPoints[i]);
        const width = sunRadius * 0.22 + (engineRadius * 0.45 - sunRadius * 0.22) * t;
        streamWidths[i] = width * 1.6 * p.scale;
        counterWidths[i] = engineRadius * 0.12 * p.scale;
        streamIntensity[i] = 0.55 * Math.min(1, t * 8) * Math.min(1, (1 - t) * 10 + 0.4);
        counterIntensity[i] = 0.9 * Math.min(1, t * 12);
      }
      stream.update(streamPoints, streamWidths, streamAlong, streamIntensity, time);
      counter.update(streamPoints, counterWidths, streamAlong, counterIntensity, time);

      for (let i = 0; i <= JET_SEGMENTS; i++) {
        const t = i / JET_SEGMENTS;
        const p = project(nozzleDistance + jetLength * t, basis, jetPoints[i]);
        jetWidths[i] = engineRadius * 0.62 * (1 + 1.2 * t) * p.scale;
        jetIntensity[i] = Math.pow(1 - t, 0.8) * (0.85 + 0.15 * Math.sin(time * 5.3 - t * 9));
      }
      jet.update(jetPoints, jetWidths, jetAlong, jetIntensity, time);
    },
    destroy() {
      swarm.destroy();
      hull.destroy();
      if (!flow) return;
      flow.stream.destroy();
      flow.counter.destroy();
      flow.jet.destroy();
      flow.focus.destroy();
    },
  };
}
