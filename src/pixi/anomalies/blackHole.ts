import { Container, Graphics } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { ORBITAL_K } from '../../game/planetGen';
import { orbitPoint, projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { drawTaper, makeSelectable, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const HORIZON_RADIUS = 30;
const DISK_INNER = HORIZON_RADIUS * 1.9;
const DISK_OUTER = HORIZON_RADIUS * 6.5;
const DISK_MIDDLE = (DISK_INNER + DISK_OUTER) / 2;
const WEDGE_COUNT = 16;
const DISK_SPIN = 0.35;
const DOPPLER = 0.45;
const JET_LENGTH = HORIZON_RADIUS * 28;
const DISK_COLORS = [0xfff1d6, 0xffae55, 0xc2451c];

interface Wedge {
  squash: Container;
  gfx: Graphics;
  midAngle: number;
}

export function createBlackHole({ anomaly, planetExtent, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const active = anomaly.active;
  const orbitRadius = planetExtent * 1.3;
  const orbitSpeed = ORBITAL_K / Math.pow(orbitRadius, 1.5);
  let orbitAngle = rng() * TAU;
  let spin = rng() * TAU;
  const flickerPhase = rng() * TAU;

  const body = new Container();
  const horizon = new Graphics().circle(0, 0, HORIZON_RADIUS).fill({ color: 0x000000, alpha: 1 });
  const photonRing = new Graphics()
    .circle(0, 0, HORIZON_RADIUS * 1.55).stroke({ color: 0xff9a52, width: 3, alpha: active ? 0.3 : 0.14 })
    .circle(0, 0, HORIZON_RADIUS * 1.12).stroke({ color: 0xfff0d8, width: 1.6, alpha: active ? 0.95 : 0.65 });
  photonRing.blendMode = 'add';
  body.addChild(horizon, photonRing);
  makeSelectable(body, DISK_OUTER, onSelect);

  const wedgeBatches = Array.from({ length: WEDGE_COUNT }, () => new Map<number, Array<[number, number, number]>>());
  const particleCount = active ? 1100 : 650;
  for (let i = 0; i < particleCount; i++) {
    const t = Math.pow(rng(), 1.7);
    const radius = DISK_INNER + (DISK_OUTER - DISK_INNER) * t;
    const theta = rng() * TAU;
    const color = DISK_COLORS[t < 0.2 ? 0 : t < 0.5 ? 1 : 2];
    const batches = wedgeBatches[Math.floor(theta / TAU * WEDGE_COUNT) % WEDGE_COUNT];
    const batch = batches.get(color) ?? [];
    batch.push([Math.cos(theta) * radius, Math.sin(theta) * radius, 0.8 + rng() * 1.8]);
    batches.set(color, batch);
  }

  const diskAlpha = active ? 0.8 : 0.4;
  const wedges: Wedge[] = wedgeBatches.map((batches, index) => {
    const gfx = new Graphics();
    for (const [color, particles] of batches) {
      for (const [x, y, r] of particles) gfx.circle(x, y, r);
      gfx.fill({ color, alpha: diskAlpha });
    }
    const squash = new Container();
    squash.blendMode = 'add';
    squash.eventMode = 'none';
    squash.addChild(gfx);
    return { squash, gfx, midAngle: (index + 0.5) / WEDGE_COUNT * TAU };
  });

  const jets = active ? [new Graphics(), new Graphics()] : [];
  for (const jet of jets) {
    jet.blendMode = 'add';
    jet.eventMode = 'none';
  }

  const centre: Point3D = { x: 0, y: 0, z: 0 };
  const jetPoint: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const jetStart: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const jetEnd: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const nodes: Container[] = [body, ...wedges.map((wedge) => wedge.squash), ...jets];

  return {
    nodes,
    extent: orbitRadius + DISK_OUTER,
    starAlpha: 1,
    coronaAlpha: 1,
    update(dt: number, elapsed: number, basis: ProjectionBasis) {
      orbitAngle += orbitSpeed * dt;
      spin += DISK_SPIN * dt;
      orbitPoint(orbitAngle, orbitRadius, 0, centre);
      projectSystemPointWithBasis(centre, basis, projected);
      body.position.set(projected.x, projected.y);
      body.scale.set(projected.scale);
      body.zIndex = projected.depth;

      const yaw = Math.atan2(basis.sinYaw, basis.cosYaw);
      const flicker = active ? 0.85 + 0.15 * Math.sin(elapsed * 7.3 + flickerPhase) : 1;
      for (const wedge of wedges) {
        const phase = wedge.midAngle + yaw + spin;
        wedge.gfx.rotation = yaw + spin;
        wedge.squash.position.set(projected.x, projected.y);
        wedge.squash.scale.set(projected.scale, projected.scale * basis.cosTilt);
        wedge.squash.zIndex = projected.depth + DISK_MIDDLE * Math.sin(phase) * basis.sinTilt;
        wedge.squash.alpha = flicker * (1 + DOPPLER * Math.cos(phase)) / (1 + DOPPLER);
      }

      jets.forEach((jet, index) => {
        const sign = index === 0 ? 1 : -1;
        jetPoint.x = centre.x;
        jetPoint.z = centre.z;
        jetPoint.y = sign * HORIZON_RADIUS * 1.2;
        projectSystemPointWithBasis(jetPoint, basis, jetStart);
        jetPoint.y = sign * JET_LENGTH;
        projectSystemPointWithBasis(jetPoint, basis, jetEnd);
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(elapsed * 2.1 + sign * 1.7)) * (0.7 + 0.3 * Math.sin(elapsed * 29 + sign));
        jet.clear();
        drawTaper(jet, jetStart.x, jetStart.y, jetEnd.x, jetEnd.y, 10 * jetStart.scale, 2 * jetEnd.scale, 0x8fa8ff, 0.18 * pulse);
        drawTaper(jet, jetStart.x, jetStart.y, jetEnd.x, jetEnd.y, 3 * jetStart.scale, 0.6 * jetEnd.scale, 0xe4ecff, 0.8 * pulse);
        jet.zIndex = (jetStart.depth + jetEnd.depth) / 2;
      });
    },
    destroy() {
      for (const node of nodes) node.destroy({ children: true });
    },
  };
}
