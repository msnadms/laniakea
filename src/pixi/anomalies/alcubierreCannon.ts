import { Graphics, type Circle, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { BEAM_COLLECTORS, createCollectorSwarm, RUINED_BEAM_COLLECTORS } from './collectorSwarm';
import { createPlasmaStrip, STREAM_LOOK, type PlasmaLook } from './plasmaStrip';
import { orthonormalFrame } from './shellLattice';
import { makeSelectable, mixColor, smoothstep, TAU, toSystemDirection } from './shared';
import { createThrusterHull, type HullFrame, type HullLook, type HullPoint, type HullRail, type HullShape, type ThrusterHull } from './thrusterHull';
import { SUN_PHOTOSPHERE_FRACTION } from '../sunBody';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const COIL_COUNT = 9;
const RAIL_COUNT = 4;
const PULSE_PERIOD = 11;
const PULSE_SPAN = 0.35;
const PULSE_WIDTH = 0.12;
const HOLD_LEVEL = 0.55;
const RUINED_CYCLE = 19;
const FIZZLE_RATE = 14;
const BROKEN_SWEEP = 0.62;
const BROKEN_TILT = 0.5;
const CHARGE_END = 0.72;
const FOCUS_RAYS = 12;
const STREAM_SEGMENTS = 10;
const BORE_SEGMENTS = 18;
const RING_STEPS = 40;
const COIL_WIDTH = 0.42;
const HOUSING_LENGTH = 1.8;
const HOUSING_RADIUS = 1.1;
const BARREL_COIL_RADII = 8.5;
const COIL_COLOR = 0x6fa8ff;
const FIELD_COLOR = 0x8a78ff;

const COIL_PROFILE: readonly HullPoint[] = [
  [0, 1.06], [0.12, 1.12], [0.88, 1.12], [1, 1.06],
  [1, 1.06], [1, 0.86],
  [1, 0.86, 1], [0.88, 0.8, 1], [0.12, 0.8, 1], [0, 0.86],
  [0, 0.86], [0, 1.06],
];

const HOUSING_PROFILE: readonly HullPoint[] = [
  [0.1, 0], [0, 0.95],
  [0, 0.95], [0.04, 1.0], [0.16, 0.9], [0.3, 0.62], [0.7, 0.62], [0.78, 0.7], [0.9, 0.7], [1, 0.5],
  [1, 0.5], [1, 0.3],
];

const LIVING_COIL: HullLook = {
  hull: 0x6d7480,
  ambient: 0.14,
  exhaust: 0,
  exhaustStrength: 0,
  intake: 0,
  intakeStrength: 0,
  radiator: 0xff4a1a,
  radiatorStrength: 0,
  damage: 0,
  lights: true,
  charge: COIL_COLOR,
};

const RUINED_COIL: HullLook = {
  ...LIVING_COIL,
  hull: 0x34363b,
  ambient: 0.1,
  lights: false,
};

const LIVING_HOUSING: HullLook = {
  ...LIVING_COIL,
  hull: 0x8a919c,
  intakeStrength: 0.8,
  radiatorStrength: 0.4,
};

const RUINED_HOUSING: HullLook = {
  ...RUINED_COIL,
  hull: 0x3b3d42,
};

const BORE_LOOK: PlasmaLook = {
  core: 0xe4ecff,
  coreWidth: 0.24,
  sheath: FIELD_COLOR,
  sheathStrength: 0.45,
  sheathFar: COIL_COLOR,
  flowScale: 10,
  flowSpeed: 3,
  knots: 0,
  knotStrength: 0,
  turbulence: 0.25,
};

interface FocusRay {
  spread: number;
  around: number;
  drift: number;
  alpha: number;
}

interface Coil {
  hull: ThrusterHull;
  hit: Circle;
  frame: HullFrame;
  radius: number;
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

function scaled(v: Point3D, amount: number): Point3D {
  return { x: v.x * amount, y: v.y * amount, z: v.z * amount };
}

export function createAlcubierreCannon({ anomaly, sunRadius, starColor, innermostOrbit, innermostClearance, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const { living, integrity } = anomaly;
  const axis = toSystemDirection(anomaly.direction);
  const { tangent, bitangent } = orthonormalFrame(axis);
  const swarmRadius = Math.min(sunRadius * 1.9, innermostOrbit * 0.5);
  const breech = swarmRadius * 1.35;
  const muzzle = Math.min(innermostClearance, Math.max(innermostOrbit * 0.92, breech + sunRadius * 3));
  const coilRadius = Math.min(Math.max(sunRadius * 0.3, (muzzle - breech) * 0.085), (muzzle - breech) / BARREL_COIL_RADII);
  const coilWidth = coilRadius * COIL_WIDTH;
  const housingLength = coilRadius * HOUSING_LENGTH;
  const housingRadius = coilRadius * HOUSING_RADIUS;
  const firstCoil = breech + housingLength + coilRadius * 0.5;
  const bubbleRadius = coilRadius * 0.62;
  const railWidth = coilRadius * 0.1;
  const rayColor = mixColor(starColor, 0xffffff, 0.5);
  const period = living ? PULSE_PERIOD : RUINED_CYCLE;
  const timeOffset = rng() * period;
  const railOffset = rng() * TAU;
  const swarm = createCollectorSwarm(rng, swarmRadius, integrity, starColor, onSelect, living ? BEAM_COLLECTORS : RUINED_BEAM_COLLECTORS);
  const hotspotDistance = sunRadius * SUN_PHOTOSPHERE_FRACTION * 1.02;
  const focusRays: FocusRay[] = Array.from({ length: FOCUS_RAYS }, () => ({
    spread: 0.35 + rng() * 0.6,
    around: rng() * TAU,
    drift: 0.05 + rng() * 0.1,
    alpha: 0.12 + rng() * 0.18,
  }));

  const alongs = Array.from({ length: COIL_COUNT }, (_, index) => firstCoil + (muzzle - firstCoil) * index / (COIL_COUNT - 1));
  const radii = alongs.map((_, index) => coilRadius * (1 + 0.25 * (index / (COIL_COUNT - 1)) ** 2));
  const broken = alongs.map((_, index) => !living && index > 0 && rng() > integrity + 0.2);
  const tears = alongs.map(() => rng() * TAU);
  const firstBroken = broken.indexOf(true);
  const chargeLimit = living
    ? COIL_COUNT
    : Math.min(firstBroken < 0 ? COIL_COUNT : firstBroken, Math.max(1, Math.ceil(COIL_COUNT * integrity)));
  const damage = living ? 0 : (1 - integrity) * 0.8;

  const railsBetween = (from: number, to: number, radiusFrom: number, radiusTo: number): HullRail[] =>
    Array.from({ length: RAIL_COUNT }, (_, rail) => ({
      angle: railOffset + rail / RAIL_COUNT * TAU,
      from,
      to,
      radiusFrom: radiusFrom + railWidth / 2,
      radiusTo: radiusTo + railWidth / 2,
      width: railWidth,
    }));

  const housingShape: HullShape = {
    profile: HOUSING_PROFILE,
    fins: { count: 4, span: [0.3, 0.7], inner: 0.62, reach: 1.7 },
    rails: railsBetween(housingLength * 0.4, firstCoil - coilWidth / 2 - breech - housingLength / 2, housingRadius * 0.7, radii[0] * 1.12),
  };
  const housing = createThrusterHull(
    { origin: scaled(axis, breech + housingLength / 2), axis, tangent, bitangent },
    housingRadius,
    housingLength,
    { ...(living ? LIVING_HOUSING : RUINED_HOUSING), intake: rayColor, damage },
    starColor,
    () => false,
    housingShape,
  );
  makeSelectable(housing.mesh, housingRadius * 1.6, onSelect);
  const housingHit = housing.mesh.hitArea as Circle;

  const coils: Coil[] = alongs.map((along, index) => {
    const radius = radii[index];
    let frame: HullFrame = { origin: scaled(axis, along), axis, tangent, bitangent };
    if (broken[index]) {
      const lean = (rng() - 0.5) * BROKEN_TILT;
      const turn = (rng() - 0.5) * BROKEN_TILT;
      const leaning = {
        x: axis.x + tangent.x * lean + bitangent.x * turn,
        y: axis.y + tangent.y * lean + bitangent.y * turn,
        z: axis.z + tangent.z * lean + bitangent.z * turn,
      };
      const size = Math.hypot(leaning.x, leaning.y, leaning.z);
      const tilted = scaled(leaning, 1 / size);
      const drift = (rng() - 0.5) * radius * 0.4;
      frame = {
        origin: { x: axis.x * along + tangent.x * drift, y: axis.y * along + tangent.y * drift, z: axis.z * along + tangent.z * drift },
        axis: tilted,
        ...orthonormalFrame(tilted),
      };
    }
    const next = index + 1;
    const rails = next < COIL_COUNT && !broken[index] && !broken[next]
      ? railsBetween(coilWidth / 2, alongs[next] - along - coilWidth / 2, radius * 1.12, radii[next] * 1.12)
      : [];
    const tearStart = tears[index];
    const inTear = (around: number) => ((around - tearStart) % TAU + TAU) % TAU > BROKEN_SWEEP * TAU;
    const hull = createThrusterHull(
      frame,
      radius,
      coilWidth,
      { ...(living ? LIVING_COIL : RUINED_COIL), damage },
      starColor,
      (around) => broken[index] && inTear(around),
      { profile: COIL_PROFILE, fins: null, rails },
    );
    makeSelectable(hull.mesh, radius * 1.3, onSelect);
    return { hull, hit: hull.mesh.hitArea as Circle, frame, radius };
  });

  const boreEnd = living ? muzzle + coilRadius * 0.6 : alongs[chargeLimit - 1];
  const bore = createPlasmaStrip(BORE_SEGMENTS, BORE_LOOK);
  const boreAlong = Array.from({ length: BORE_SEGMENTS + 1 }, (_, i) => i / BORE_SEGMENTS);
  const borePoints = Array.from({ length: BORE_SEGMENTS + 1 }, emptyPoint);
  const boreWidths = new Float32Array(BORE_SEGMENTS + 1);
  const boreIntensity = new Float32Array(BORE_SEGMENTS + 1);

  const stream = createPlasmaStrip(STREAM_SEGMENTS, STREAM_LOOK);
  const streamAlong = Array.from({ length: STREAM_SEGMENTS + 1 }, (_, i) => i / STREAM_SEGMENTS);
  const streamPoints = Array.from({ length: STREAM_SEGMENTS + 1 }, emptyPoint);
  const streamWidths = new Float32Array(STREAM_SEGMENTS + 1);
  const streamIntensity = new Float32Array(STREAM_SEGMENTS + 1);

  const halos = coils.map(additive);
  const focus = additive();
  const bubble = additive();

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const hotspot = emptyPoint();
  const rayStart = emptyPoint();
  const bubbleCentre = emptyPoint();
  const ring = emptyPoint();
  const nodes: Container[] = [swarm.back, swarm.front, housing.mesh, focus, ...stream.segments, bubble, ...bore.segments, ...coils.map((coil) => coil.hull.mesh), ...halos];

  const projectOnAxis = (along: number, basis: ProjectionBasis, out: ProjectedPoint, radius = 0, angle = 0) => {
    const across = Math.cos(angle) * radius;
    const up = Math.sin(angle) * radius;
    point.x = axis.x * along + tangent.x * across + bitangent.x * up;
    point.y = axis.y * along + tangent.y * across + bitangent.y * up;
    point.z = axis.z * along + tangent.z * across + bitangent.z * up;
    return projectSystemPointWithBasis(point, basis, out);
  };

  const traceRing = (gfx: Graphics, frame: HullFrame, radius: number, basis: ProjectionBasis) => {
    const { origin, tangent: t, bitangent: b } = frame;
    for (let step = 0; step <= RING_STEPS; step++) {
      const angle = step / RING_STEPS * TAU;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      point.x = origin.x + t.x * c + b.x * s;
      point.y = origin.y + t.y * c + b.y * s;
      point.z = origin.z + t.z * c + b.z * s;
      const p = projectSystemPointWithBasis(point, basis, ring);
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

      const pulseAt = (t: number) => {
        if (sweep <= 1) return Math.exp(-(((t - sweep) / PULSE_WIDTH) ** 2));
        return t >= 1 ? Math.exp(-(sweep - 1) * 4) : 0;
      };
      const coilLight = (index: number) => {
        if (!living) return index < chargeLimit ? smoothstep(index / COIL_COUNT, (index + 1.5) / COIL_COUNT, charge) * fizzle : 0;
        return HOLD_LEVEL + 0.08 * Math.sin(time * 0.9 + index * 0.7) + 0.45 * pulseAt(index / (COIL_COUNT - 1));
      };

      const housingCentre = housing.update(basis, time);
      housingHit.x = housingCentre.x;
      housingHit.y = housingCentre.y;
      housingHit.radius = housingRadius * 1.6 * housingCentre.scale;

      coils.forEach((coil, index) => {
        const lit = coilLight(index);
        coil.hull.setCharge(lit * 1.2);
        const centre = coil.hull.update(basis, time);
        coil.hit.x = centre.x;
        coil.hit.y = centre.y;
        coil.hit.radius = coil.radius * 1.3 * centre.scale;
        const halo = halos[index];
        halo.clear();
        halo.zIndex = centre.depth + 0.001;
        if (lit > 0.01) traceRing(halo, coil.frame, coil.radius * 0.95, basis).stroke({ color: COIL_COLOR, width: coil.radius * 0.4 * centre.scale, alpha: 0.12 * lit });
      });

      const feedLevel = living ? 0.85 + 0.15 * Math.sin(time * 1.3) : charge * fizzle * 0.6;
      const rayCount = living ? FOCUS_RAYS : Math.ceil(FOCUS_RAYS * integrity * 0.5);
      projectOnAxis(hotspotDistance, basis, hotspot);
      focus.clear();
      for (let i = 0; i < rayCount && feedLevel > 0.01; i++) {
        const ray = focusRays[i];
        projectOnAxis(Math.cos(ray.spread) * swarmRadius, basis, rayStart, Math.sin(ray.spread) * swarmRadius, ray.around + ray.drift * time);
        focus.moveTo(rayStart.x, rayStart.y).lineTo(hotspot.x, hotspot.y).stroke({ color: rayColor, width: 1.2 * rayStart.scale, alpha: ray.alpha * feedLevel });
      }
      focus.zIndex = hotspot.depth;

      for (let i = 0; i <= STREAM_SEGMENTS; i++) {
        const t = i / STREAM_SEGMENTS;
        const p = projectOnAxis(hotspotDistance + (breech - hotspotDistance) * t, basis, streamPoints[i]);
        const width = sunRadius * 0.22 + (housingRadius * 0.45 - sunRadius * 0.22) * t;
        streamWidths[i] = width * 1.6 * p.scale;
        streamIntensity[i] = 0.55 * feedLevel * Math.min(1, t * 8) * Math.min(1, (1 - t) * 10 + 0.4);
      }
      stream.update(streamPoints, streamWidths, streamAlong, streamIntensity, time);

      const front = charge * COIL_COUNT / chargeLimit;
      for (let i = 0; i <= BORE_SEGMENTS; i++) {
        const t = i / BORE_SEGMENTS;
        const along = firstCoil + (boreEnd - firstCoil) * t;
        const p = projectOnAxis(along, basis, borePoints[i]);
        const reach = (along - firstCoil) / (muzzle - firstCoil);
        boreWidths[i] = bubbleRadius * 0.7 * p.scale;
        boreIntensity[i] = living
          ? (0.1 + 1.1 * pulseAt(Math.min(1, reach))) * (reach > 1 ? Math.exp(-(reach - 1) * 12) : 1)
          : 0.35 * (1 - smoothstep(front - 0.05, front + 0.1, t)) * fizzle * (0.7 + 0.3 * Math.sin(time * 23 + i * 2.1));
      }
      bore.update(borePoints, boreWidths, boreAlong, boreIntensity, time);

      bubble.clear();
      if (!living) return;
      const hum = 0.85 + 0.15 * Math.sin(time * 2.1);
      const coil = coils[0];
      projectOnAxis(firstCoil, basis, bubbleCentre);
      bubble.zIndex = bubbleCentre.depth + 0.0005;
      bubble.circle(bubbleCentre.x, bubbleCentre.y, bubbleRadius * hum * bubbleCentre.scale)
        .fill({ color: FIELD_COLOR, alpha: 0.05 })
        .stroke({ color: COIL_COLOR, width: 1.2 * bubbleCentre.scale, alpha: 0.3 });
      traceRing(bubble, coil.frame, bubbleRadius * hum, basis).stroke({ color: FIELD_COLOR, width: bubbleRadius * 0.3 * bubbleCentre.scale, alpha: 0.25 * hum });
      traceRing(bubble, coil.frame, bubbleRadius * hum, basis).stroke({ color: 0xe4ecff, width: 1.2 * bubbleCentre.scale, alpha: 0.6 * hum });
      bubble.circle(bubbleCentre.x, bubbleCentre.y, bubbleRadius * 0.22 * bubbleCentre.scale).fill({ color: 0xe4ecff, alpha: 0.4 * hum });
    },
    destroy() {
      swarm.destroy();
      housing.destroy();
      for (const coil of coils) coil.hull.destroy();
      bore.destroy();
      stream.destroy();
      for (const gfx of [focus, bubble, ...halos]) gfx.destroy();
    },
  };
}
