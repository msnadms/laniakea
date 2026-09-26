import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createCollectorSwarm, type CollectorSwarmStyle } from './collectorSwarm';
import { orthonormalFrame } from './shellLattice';
import { drawTaper, makeSelectable, mixColor, TAU, toSystemDirection } from './shared';
import { SUN_PHOTOSPHERE_FRACTION } from '../sunBody';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const LIVING_COLLECTORS: CollectorSwarmStyle = {
  count: 360,
  minRings: 6,
  extraRings: 3,
  radiusSpread: 0.35,
  inclinationSpread: 2.6,
  size: 4,
  backColor: 0xd9c49a,
  backAlpha: 0.4,
  frontColor: 0xffe2b0,
  frontAlpha: 0.85,
};

const RUINED_COLLECTORS: CollectorSwarmStyle = {
  ...LIVING_COLLECTORS,
  count: 280,
  backColor: 0x3a322b,
  backAlpha: 0.5,
  frontColor: 0x6e604f,
  frontAlpha: 0.9,
};

const FOCUS_RAYS = 12;
const STREAM_SEGMENTS = 10;
const JET_SEGMENTS = 16;
const RING_POINTS = 28;
const STRUTS = 8;
const HULL_LIVING = 0xb8c0cc;
const HULL_RUINED = 0x3b3d42;
const EXHAUST_COLOR = 0xb8ffd0;
const COUNTER_COLOR = 0xff8aa8;
const STREAM_COLOR = 0xffb45a;

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

function traceRing(gfx: Graphics, ring: readonly ProjectedPoint[], origin: ProjectedPoint, skip: (angle: number) => boolean) {
  for (let k = 0; k < ring.length; k++) {
    if (skip(k / ring.length * TAU)) continue;
    const from = ring[k];
    const to = ring[(k + 1) % ring.length];
    gfx.moveTo(from.x - origin.x, from.y - origin.y).lineTo(to.x - origin.x, to.y - origin.y);
  }
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
  const engineLength = engineRadius * 1.8;
  const engineDistance = Math.min(Math.max(sunRadius * 2.6, swarmOuter + engineLength), innermostOrbit * 0.9 - engineLength / 2);
  const intakeDistance = engineDistance - engineLength / 2;
  const nozzleDistance = engineDistance + engineLength / 2;
  const hotspotDistance = sunRadius * SUN_PHOTOSPHERE_FRACTION * 1.02;
  const jetLength = planetExtent * 2.5;
  const timeOffset = rng() * 100;
  const hullColor = living ? mixColor(HULL_LIVING, starColor, 0.2) : HULL_RUINED;
  const rayColor = mixColor(starColor, 0xffffff, 0.5);

  const swarm = createCollectorSwarm(rng, swarmRadius, integrity, onSelect, style);

  const focusRays: FocusRay[] = Array.from({ length: FOCUS_RAYS }, () => ({
    spread: 0.35 + rng() * 0.6,
    around: rng() * TAU,
    drift: 0.05 + rng() * 0.1,
    alpha: 0.12 + rng() * 0.18,
  }));
  const gapStart = rng() * TAU;
  const gapLength = living ? 0 : (1 - integrity) * TAU * 0.8;
  const brokenStruts = Array.from({ length: STRUTS }, () => !living && rng() > integrity);
  const inGap = (angle: number) => ((angle - gapStart) % TAU + TAU) % TAU < gapLength;

  const hull = new Graphics();
  makeSelectable(hull, engineRadius * 1.6, onSelect);
  const engineGlow = additive()
    .circle(0, 0, 1).fill({ color: EXHAUST_COLOR, alpha: 0.22 })
    .circle(0, 0, 0.4).fill({ color: 0xffffff, alpha: 0.9 });
  const hotspot = additive()
    .circle(0, 0, 1).fill({ color: mixColor(starColor, 0xffffff, 0.3), alpha: 0.3 })
    .circle(0, 0, 0.45).fill({ color: 0xffffff, alpha: 0.85 });
  const focus = additive();
  const streamSegments = living ? Array.from({ length: STREAM_SEGMENTS }, additive) : [];
  const jetSegments = living ? Array.from({ length: JET_SEGMENTS }, additive) : [];
  const nodes: Container[] = [swarm.back, swarm.front, hull];
  if (living) nodes.push(engineGlow, hotspot, focus, ...streamSegments, ...jetSegments);
  else for (const node of [engineGlow, hotspot, focus]) node.destroy();

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const center = emptyPoint();
  const hotspotPoint = emptyPoint();
  const rayStart = emptyPoint();
  const intakeRing = Array.from({ length: RING_POINTS }, emptyPoint);
  const nozzleRing = Array.from({ length: RING_POINTS }, emptyPoint);
  const streamPoints = Array.from({ length: STREAM_SEGMENTS + 1 }, emptyPoint);
  const jetPoints = Array.from({ length: JET_SEGMENTS + 1 }, emptyPoint);

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
    extent: nozzleDistance + engineRadius,
    starAlpha: 1,
    coronaAlpha: living ? 0.75 : 0.9,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);
      const time = elapsed + timeOffset;

      project(engineDistance, basis, center);
      for (let k = 0; k < RING_POINTS; k++) {
        const angle = k / RING_POINTS * TAU;
        project(intakeDistance, basis, intakeRing[k], engineRadius, angle);
        project(nozzleDistance, basis, nozzleRing[k], engineRadius * 0.55, angle);
      }
      hull.position.set(center.x, center.y);
      hull.zIndex = center.depth;
      hull.clear();
      traceRing(hull, intakeRing, center, inGap);
      traceRing(hull, nozzleRing, center, () => false);
      for (let s = 0; s < STRUTS; s++) {
        if (brokenStruts[s]) continue;
        const k = Math.floor(s * RING_POINTS / STRUTS);
        hull.moveTo(intakeRing[k].x - center.x, intakeRing[k].y - center.y).lineTo(nozzleRing[k].x - center.x, nozzleRing[k].y - center.y);
      }
      hull.stroke({ color: hullColor, width: 1.8 * center.scale, alpha: 0.95 });
      if (!living) return;

      engineGlow.position.set(center.x, center.y);
      engineGlow.scale.set(engineRadius * 0.9 * center.scale * (0.9 + 0.1 * Math.sin(time * 5.3)));
      engineGlow.zIndex = center.depth;

      project(hotspotDistance, basis, hotspotPoint);
      hotspot.position.set(hotspotPoint.x, hotspotPoint.y);
      hotspot.scale.set(sunRadius * 0.24 * hotspotPoint.scale * (0.85 + 0.15 * Math.sin(time * 3.1)));
      hotspot.zIndex = hotspotPoint.depth;

      focus.clear();
      for (const ray of focusRays) {
        project(Math.cos(ray.spread) * swarmRadius, basis, rayStart, Math.sin(ray.spread) * swarmRadius, ray.around + ray.drift * time);
        focus.moveTo(rayStart.x, rayStart.y).lineTo(hotspotPoint.x, hotspotPoint.y).stroke({ color: rayColor, width: 1.2 * rayStart.scale, alpha: ray.alpha });
      }
      focus.zIndex = hotspotPoint.depth;

      for (let i = 0; i <= STREAM_SEGMENTS; i++) {
        project(hotspotDistance + (intakeDistance - hotspotDistance) * i / STREAM_SEGMENTS, basis, streamPoints[i]);
      }
      streamSegments.forEach((gfx, i) => {
        const from = streamPoints[i];
        const to = streamPoints[i + 1];
        const start = i / STREAM_SEGMENTS;
        const end = (i + 1) / STREAM_SEGMENTS;
        const middle = (start + end) / 2;
        const inflow = 0.55 + 0.45 * Math.pow(Math.max(0, Math.sin((middle * 6 - time * 1.6) * Math.PI)), 2);
        const counterflow = 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin((middle * 10 + time * 3.2) * Math.PI)), 4);
        const startWidth = sunRadius * 0.22 + (engineRadius * 0.45 - sunRadius * 0.22) * start;
        const endWidth = sunRadius * 0.22 + (engineRadius * 0.45 - sunRadius * 0.22) * end;
        gfx.clear();
        drawTaper(gfx, from.x, from.y, to.x, to.y, startWidth * from.scale, endWidth * to.scale, STREAM_COLOR, 0.12 * inflow);
        drawTaper(gfx, from.x, from.y, to.x, to.y, 1.2 * from.scale, 1.2 * to.scale, COUNTER_COLOR, 0.7 * counterflow);
        gfx.zIndex = (from.depth + to.depth) / 2;
      });

      for (let i = 0; i <= JET_SEGMENTS; i++) {
        project(nozzleDistance + jetLength * i / JET_SEGMENTS, basis, jetPoints[i]);
      }
      jetSegments.forEach((gfx, i) => {
        const from = jetPoints[i];
        const to = jetPoints[i + 1];
        const start = i / JET_SEGMENTS;
        const end = (i + 1) / JET_SEGMENTS;
        const middle = (start + end) / 2;
        const intensity = (0.6 + 0.4 * Math.pow(Math.max(0, Math.sin((middle * 14 - time * 4) * Math.PI)), 2)) * Math.pow(1 - middle, 0.8);
        const startWidth = engineRadius * 0.35 * (1 + 0.6 * start) * from.scale;
        const endWidth = engineRadius * 0.35 * (1 + 0.6 * end) * to.scale;
        gfx.clear();
        drawTaper(gfx, from.x, from.y, to.x, to.y, startWidth * 3, endWidth * 3, EXHAUST_COLOR, 0.14 * intensity);
        drawTaper(gfx, from.x, from.y, to.x, to.y, startWidth, endWidth, mixColor(EXHAUST_COLOR, 0xffffff, 0.5), 0.85 * intensity);
        gfx.zIndex = (from.depth + to.depth) / 2;
      });
    },
    destroy() {
      for (const node of nodes) node.destroy();
    },
  };
}
