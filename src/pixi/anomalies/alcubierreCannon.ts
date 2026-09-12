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
const CYCLE = 8;
const CHARGE_END = 0.72;
const CAP_RINGS = 5;
const CAP_ANGLE = 60 * Math.PI / 180;
const PARTICLES = 90;
const HULL_COLOR = 0x353c48;
const COIL_COLOR = 0x6fa8ff;
const BOW_COLOR = 0xd4e8ff;
const SHOCK_COLOR = 0x8a78ff;

interface Coil {
  node: Container;
  hull: Graphics;
  glow: Graphics;
  hit: Circle;
  along: number;
  radius: number;
}

interface Particle {
  angle: number;
  around: number;
  length: number;
}

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

export function createAlcubierreCannon({ anomaly, sunRadius, starColor, innermostOrbit, innermostClearance, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const axis = toSystemDirection(anomaly.direction);
  const { tangent, bitangent } = orthonormalFrame(axis);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.5);
  const breech = swarmRadius * 1.35;
  const muzzle = Math.min(innermostClearance, Math.max(innermostOrbit * 0.92, breech + sunRadius * 3));
  const barrel = muzzle - breech;
  const coilRadius = Math.max(sunRadius * 0.3, barrel * 0.085);
  const bubbleRadius = coilRadius * 0.75;
  const travel = barrel + planetExtent * 2.5;
  const feedColor = mixColor(starColor, 0xffffff, 0.4);
  const timeOffset = rng() * CYCLE;
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

  const particles: Particle[] = Array.from({ length: PARTICLES }, () => ({
    angle: CAP_ANGLE * Math.sqrt(rng()),
    around: rng() * TAU,
    length: 0.3 + rng() * 0.9,
  }));

  const feed = new Graphics();
  const wake = new Graphics();
  const bubble = new Graphics();
  for (const gfx of [feed, wake, bubble]) {
    gfx.blendMode = 'add';
    gfx.eventMode = 'none';
  }

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const centre = emptyPoint();
  const from = emptyPoint();
  const to = emptyPoint();
  const nodes: Container[] = [swarm.back, swarm.front, feed, wake, bubble, ...coils.map((coil) => coil.node)];

  const project = (along: number, radius: number, around: number, basis: ProjectionBasis, out: ProjectedPoint) => {
    const c = Math.cos(around) * radius;
    const s = Math.sin(around) * radius;
    point.x = axis.x * along + tangent.x * c + bitangent.x * s;
    point.y = axis.y * along + tangent.y * c + bitangent.y * s;
    point.z = axis.z * along + tangent.z * c + bitangent.z * s;
    return projectSystemPointWithBasis(point, basis, out);
  };

  const traceRing = (gfx: Graphics, along: number, radius: number, basis: ProjectionBasis) => {
    for (let step = 0; step <= COIL_STEPS; step++) {
      const p = project(along, radius, step / COIL_STEPS * TAU, basis, from);
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
      const cycle = ((elapsed + timeOffset) % CYCLE) / CYCLE;
      const charge = Math.min(1, cycle / CHARGE_END);
      const firing = cycle >= CHARGE_END;
      const fire = firing ? (cycle - CHARGE_END) / (1 - CHARGE_END) : 0;
      const afterglow = firing ? Math.exp(-fire * 5) : 0;

      coils.forEach((coil, index) => {
        const { hull, glow, hit, along, radius } = coil;
        project(along, 0, 0, basis, centre);
        const scale = centre.scale;
        const lit = firing ? afterglow : smoothstep(index / COIL_COUNT, (index + 1.5) / COIL_COUNT, charge);
        hull.clear();
        glow.clear();
        traceRing(hull, along, radius, basis).stroke({ color: HULL_COLOR, width: radius * 0.22 * scale, alpha: 0.95 });
        const next = coils[index + 1];
        if (next) {
          for (let rail = 0; rail < RAIL_COUNT; rail++) {
            const around = railOffset + rail / RAIL_COUNT * TAU;
            project(along, radius, around, basis, from);
            project(next.along, next.radius, around, basis, to);
            hull.moveTo(from.x, from.y).lineTo(to.x, to.y);
          }
          hull.stroke({ color: HULL_COLOR, width: 2.5 * scale, alpha: 0.9 });
        }
        traceRing(glow, along, radius, basis).stroke({ color: COIL_COLOR, width: radius * 0.08 * scale, alpha: 0.25 + 0.75 * lit });
        if (lit > 0.01) traceRing(glow, along, radius, basis).stroke({ color: COIL_COLOR, width: radius * 0.45 * scale, alpha: 0.2 * lit });
        coil.node.zIndex = centre.depth;
        hit.x = centre.x;
        hit.y = centre.y;
        hit.radius = radius * 1.3 * scale;
      });

      feed.clear();
      project(sunRadius * 0.95, 0, 0, basis, from);
      project(breech, 0, 0, basis, to);
      const feedAlpha = firing ? 0.45 * afterglow : 0.12 + 0.5 * charge;
      drawTaper(feed, from.x, from.y, to.x, to.y, coilRadius * 0.45 * from.scale, coilRadius * 0.12 * to.scale, feedColor, feedAlpha * 0.3);
      drawTaper(feed, from.x, from.y, to.x, to.y, coilRadius * 0.14 * from.scale, coilRadius * 0.04 * to.scale, 0xffffff, feedAlpha);
      feed.zIndex = (from.depth + to.depth) / 2;

      const along = firing ? breech + travel * fire * fire : breech;
      const radius = firing ? bubbleRadius : bubbleRadius * smoothstep(0.35, 1, charge);
      const fade = firing ? 1 - smoothstep(0.65, 1, fire) : smoothstep(0.35, 1, charge);

      wake.clear();
      if (firing) {
        project(breech, 0, 0, basis, from);
        project(Math.min(along, muzzle), 0, 0, basis, to);
        drawTaper(wake, from.x, from.y, to.x, to.y, coilRadius * 0.3 * from.scale, coilRadius * 0.3 * to.scale, BOW_COLOR, 0.5 * afterglow);
        const tail = along - radius;
        if (tail > muzzle) {
          project(muzzle, 0, 0, basis, from);
          project(tail, 0, 0, basis, to);
          drawTaper(wake, from.x, from.y, to.x, to.y, coilRadius * 0.2 * from.scale, radius * 0.6 * to.scale, SHOCK_COLOR, 0.22 * fade);
        }
        wake.zIndex = (from.depth + to.depth) / 2;
      }

      bubble.clear();
      project(along, 0, 0, basis, centre);
      bubble.zIndex = centre.depth;
      if (radius < 0.5 || fade < 0.01) return;
      const cx = centre.x;
      const cy = centre.y;
      const scale = centre.scale;
      bubble.circle(cx, cy, radius * scale)
        .fill({ color: SHOCK_COLOR, alpha: 0.08 * fade })
        .stroke({ color: COIL_COLOR, width: 1.5 * scale, alpha: 0.45 * fade });
      if (!firing) {
        bubble.circle(cx, cy, radius * 0.4 * scale).fill({ color: BOW_COLOR, alpha: 0.5 * fade });
        return;
      }

      const bow = smoothstep(0, 0.12, fire) * fade;
      for (let ring = CAP_RINGS; ring >= 1; ring--) {
        const t = ring / CAP_RINGS;
        const angle = CAP_ANGLE * t;
        traceRing(bubble, along + radius * Math.cos(angle), radius * Math.sin(angle), basis)
          .stroke({ color: mixColor(BOW_COLOR, SHOCK_COLOR, t), width: (1 + 2 * (1 - t)) * scale, alpha: bow * (1 - 0.6 * t) });
      }
      const streak = radius * (0.4 + fire * 2.5);
      for (const particle of particles) {
        const reach = along + radius * Math.cos(particle.angle);
        const ringRadius = radius * Math.sin(particle.angle);
        project(reach, ringRadius, particle.around, basis, from);
        project(reach - streak * particle.length, ringRadius, particle.around, basis, to);
        bubble.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
      bubble.stroke({ color: BOW_COLOR, width: scale, alpha: 0.6 * bow });
      project(along + radius, 0, 0, basis, from);
      bubble.circle(from.x, from.y, radius * 0.18 * from.scale).fill({ color: 0xffffff, alpha: bow });
    },
    destroy() {
      for (const node of nodes) node.destroy({ children: true });
    },
  };
}
