import { Circle, Container, Graphics } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createCollectorSwarm } from './collectorSwarm';
import { orthonormalFrame } from './shellLattice';
import { drawTaper, makeSelectable, mixColor, smoothstep, TAU, toSystemDirection } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const COIL_COUNT = 9;
const COIL_STEPS = 36;
const RAIL_COUNT = 4;
const PULSE_PERIOD = 11;
const PULSE_SPAN = 0.35;
const PULSE_WIDTH = 0.12;
const HOLD_LEVEL = 0.55;
const RUINED_CYCLE = 19;
const FIZZLE_RATE = 14;
const BROKEN_SWEEP = 0.62;
const BROKEN_HULL_ALPHA = 0.55;
const CHARGE_END = 0.72;
const HULL_COLOR = 0x353c48;
const COIL_COLOR = 0x6fa8ff;
const CORE_COLOR = 0xd4e8ff;
const FIELD_COLOR = 0x8a78ff;

interface Coil {
  node: Container;
  hull: Graphics;
  glow: Graphics;
  hit: Circle;
  along: number;
  radius: number;
}

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

export function createAlcubierreCannon({ anomaly, sunRadius, starColor, innermostOrbit, innermostClearance, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const axis = toSystemDirection(anomaly.direction);
  const { tangent, bitangent } = orthonormalFrame(axis);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.5);
  const breech = swarmRadius * 1.35;
  const muzzle = Math.min(innermostClearance, Math.max(innermostOrbit * 0.92, breech + sunRadius * 3));
  const barrel = muzzle - breech;
  const coilRadius = Math.max(sunRadius * 0.3, barrel * 0.085);
  const bubbleRadius = coilRadius * 0.75;
  const feedColor = mixColor(starColor, 0xffffff, 0.4);
  const living = anomaly.living;
  const period = living ? PULSE_PERIOD : RUINED_CYCLE;
  const timeOffset = rng() * period;
  const railOffset = rng() * TAU;
  const swarm = createCollectorSwarm(rng, swarmRadius, anomaly.integrity, onSelect);

  const coils: Coil[] = Array.from({ length: COIL_COUNT }, (_, index) => {
    const t = index / (COIL_COUNT - 1);
    const radius = coilRadius * (1 + 0.25 * t * t);
    const node = new Container();
    const hull = new Graphics();
    const glow = new Graphics();
    glow.blendMode = 'add';
    hull.eventMode = 'none';
    glow.eventMode = 'none';
    node.addChild(hull, glow);
    makeSelectable(node, radius * 1.3, onSelect);
    return { node, hull, glow, hit: node.hitArea as Circle, along: breech + barrel * t, radius };
  });

  const broken = coils.map((_, index) => !living && index > 0 && rng() > anomaly.integrity + 0.2);
  const tears = coils.map(() => rng() * TAU);
  const firstBroken = broken.indexOf(true);
  const chargeLimit = living
    ? COIL_COUNT
    : Math.min(firstBroken < 0 ? COIL_COUNT : firstBroken, Math.max(1, Math.ceil(COIL_COUNT * anomaly.integrity)));

  const feed = new Graphics();
  const bubble = new Graphics();
  for (const gfx of [feed, bubble]) {
    gfx.blendMode = 'add';
    gfx.eventMode = 'none';
  }

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const centre = emptyPoint();
  const from = emptyPoint();
  const to = emptyPoint();
  const nodes: Container[] = [swarm.back, swarm.front, feed, bubble, ...coils.map((coil) => coil.node)];

  const project = (along: number, radius: number, around: number, basis: ProjectionBasis, out: ProjectedPoint) => {
    const c = Math.cos(around) * radius;
    const s = Math.sin(around) * radius;
    point.x = axis.x * along + tangent.x * c + bitangent.x * s;
    point.y = axis.y * along + tangent.y * c + bitangent.y * s;
    point.z = axis.z * along + tangent.z * c + bitangent.z * s;
    return projectSystemPointWithBasis(point, basis, out);
  };

  const traceRing = (gfx: Graphics, along: number, radius: number, basis: ProjectionBasis, sweep = 1, startAngle = 0) => {
    const steps = Math.round(COIL_STEPS * sweep);
    for (let step = 0; step <= steps; step++) {
      const p = project(along, radius, startAngle + step / COIL_STEPS * TAU, basis, from);
      if (step === 0) gfx.moveTo(p.x, p.y);
      else gfx.lineTo(p.x, p.y);
    }
    return gfx;
  };

  return {
    nodes,
    extent: muzzle + coilRadius * 1.5,
    starAlpha: 1,
    coronaAlpha: 0.8,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);
      const time = elapsed + timeOffset;
      const cycle = (time % period) / period;
      const sweep = cycle / PULSE_SPAN;
      const charge = Math.min(1, cycle / CHARGE_END) * chargeLimit / COIL_COUNT;
      const fizzle = cycle >= CHARGE_END ? Math.exp(-(cycle - CHARGE_END) * FIZZLE_RATE) : 1;

      const coilLight = (index: number) => {
        if (!living) return index < chargeLimit ? smoothstep(index / COIL_COUNT, (index + 1.5) / COIL_COUNT, charge) * fizzle : 0;
        const t = index / (COIL_COUNT - 1);
        const pulse = sweep <= 1
          ? Math.exp(-(((t - sweep) / PULSE_WIDTH) ** 2))
          : index === COIL_COUNT - 1 ? Math.exp(-(sweep - 1) * 4) : 0;
        return HOLD_LEVEL + 0.08 * Math.sin(time * 0.9 + index * 0.7) + 0.45 * pulse;
      };

      coils.forEach((coil, index) => {
        const { hull, glow, hit, along, radius } = coil;
        project(along, 0, 0, basis, centre);
        const scale = centre.scale;
        const lit = coilLight(index);
        hull.clear();
        glow.clear();
        if (broken[index]) {
          traceRing(hull, along, radius, basis, BROKEN_SWEEP, tears[index]).stroke({ color: HULL_COLOR, width: radius * 0.22 * scale, alpha: BROKEN_HULL_ALPHA });
        } else {
          traceRing(hull, along, radius, basis).stroke({ color: HULL_COLOR, width: radius * 0.22 * scale, alpha: 0.95 });
        }
        const next = coils[index + 1];
        if (next && !broken[index] && !broken[index + 1]) {
          for (let rail = 0; rail < RAIL_COUNT; rail++) {
            const around = railOffset + rail / RAIL_COUNT * TAU;
            project(along, radius, around, basis, from);
            project(next.along, next.radius, around, basis, to);
            hull.moveTo(from.x, from.y).lineTo(to.x, to.y);
          }
          hull.stroke({ color: HULL_COLOR, width: 2.5 * scale, alpha: 0.9 });
        }
        if (!broken[index]) traceRing(glow, along, radius, basis).stroke({ color: COIL_COLOR, width: radius * 0.08 * scale, alpha: Math.min(1, (living ? 0.25 : 0.06) + 0.75 * lit) });
        if (lit > 0.01) traceRing(glow, along, radius, basis).stroke({ color: COIL_COLOR, width: radius * 0.45 * scale, alpha: 0.2 * lit });
        coil.node.zIndex = centre.depth;
        hit.x = centre.x;
        hit.y = centre.y;
        hit.radius = radius * 1.3 * scale;
      });

      feed.clear();
      project(sunRadius * 0.95, 0, 0, basis, from);
      project(breech, 0, 0, basis, to);
      const feedAlpha = living ? 0.35 + 0.1 * Math.sin(time * 1.3) : (0.12 + 0.5 * charge) * 0.3 * fizzle;
      drawTaper(feed, from.x, from.y, to.x, to.y, coilRadius * 0.45 * from.scale, coilRadius * 0.12 * to.scale, feedColor, feedAlpha * 0.3);
      drawTaper(feed, from.x, from.y, to.x, to.y, coilRadius * 0.14 * from.scale, coilRadius * 0.04 * to.scale, 0xffffff, feedAlpha);
      feed.zIndex = (from.depth + to.depth) / 2;

      bubble.clear();
      if (!living) return;
      project(breech, 0, 0, basis, centre);
      bubble.zIndex = centre.depth;
      const hum = 0.85 + 0.15 * Math.sin(time * 2.1);
      const radius = bubbleRadius * hum * centre.scale;
      bubble.circle(centre.x, centre.y, radius)
        .fill({ color: FIELD_COLOR, alpha: 0.08 })
        .stroke({ color: COIL_COLOR, width: 1.5 * centre.scale, alpha: 0.45 });
      bubble.circle(centre.x, centre.y, radius * 0.4).fill({ color: CORE_COLOR, alpha: 0.5 * hum });
    },
    destroy() {
      for (const node of nodes) node.destroy({ children: true });
    },
  };
}
