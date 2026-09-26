import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { ORBITAL_K } from '../../game/planetGen';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { buildShellLattice } from './shellLattice';
import { createShellGeometry, createShellSurface } from './shellSurface';
import { makeSelectable, mixColor, SHELL_Z, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const PANEL_COUNT = 460;
const HULL_COLOR = 0x1f1a16;
const HEAT_COLOR = 0xff4a18;
const DEBRIS_DARK = 0x1c1814;
const DEBRIS_LIGHT = 0x3a322b;

interface Debris {
  node: Graphics;
  semiMajor: number;
  eccentricity: number;
  cosPeriapsis: number;
  sinPeriapsis: number;
  cosInclination: number;
  sinInclination: number;
  cosNode: number;
  sinNode: number;
  meanAnomaly: number;
  meanMotion: number;
  tumble: number;
  tumbleSpeed: number;
}

function debrisPosition(debris: Debris, out: Point3D) {
  let eccentric = debris.meanAnomaly;
  for (let i = 0; i < 4; i++) eccentric = debris.meanAnomaly + debris.eccentricity * Math.sin(eccentric);
  const px = debris.semiMajor * (Math.cos(eccentric) - debris.eccentricity);
  const pz = debris.semiMajor * Math.sqrt(1 - debris.eccentricity ** 2) * Math.sin(eccentric);
  const x1 = px * debris.cosPeriapsis - pz * debris.sinPeriapsis;
  const z1 = px * debris.sinPeriapsis + pz * debris.cosPeriapsis;
  const z2 = z1 * debris.cosInclination;
  out.x = x1 * debris.cosNode - z2 * debris.sinNode;
  out.y = -z1 * debris.sinInclination;
  out.z = x1 * debris.sinNode + z2 * debris.cosNode;
}

export function createDysonSphere({ anomaly, sunRadius, starColor, innermostOrbit, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const radius = Math.min(sunRadius * 1.5, innermostOrbit * 0.7);
  const lattice = buildShellLattice(PANEL_COUNT, anomaly.integrity, rng);
  const spinSpeed = (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.03);
  let spin = rng() * TAU;

  const geometry = createShellGeometry();
  const shell = createShellSurface(geometry, lattice, {
    hull: HULL_COLOR,
    heat: HEAT_COLOR,
    heatStrength: anomaly.living ? 0.22 : 0.05,
    inner: starColor,
    interior: 1,
    activity: 0,
    rim: 0.5,
    lights: anomaly.living,
    subcells: 4,
    gap: 0.07,
  }, radius);
  const { back, front } = shell;
  back.zIndex = -SHELL_Z;
  front.zIndex = SHELL_Z;
  makeSelectable(back, 1, onSelect);
  makeSelectable(front, 1, onSelect);

  const maxApoapsis = innermostOrbit * 0.95;
  const minSemiMajor = radius * 1.15;
  const maxSemiMajor = Math.max(minSemiMajor * 1.1, Math.min(radius * 2.3, maxApoapsis));
  let extent = radius;
  const debris: Debris[] = Array.from({ length: 20 + Math.floor(rng() * 21) }, () => {
    const semiMajor = minSemiMajor + (maxSemiMajor - minSemiMajor) * rng();
    const eccentricity = rng() * Math.max(0, Math.min(0.45, 1 - radius * 1.12 / semiMajor, maxApoapsis / semiMajor - 1));
    const periapsis = rng() * TAU;
    const inclination = (rng() - 0.5) * 1.0;
    const ascendingNode = rng() * TAU;
    const size = 5 + rng() * 9;
    const node = new Graphics()
      .rect(-size, -size * 0.55, size * 2, size * 1.1)
      .fill({ color: mixColor(DEBRIS_DARK, DEBRIS_LIGHT, rng()), alpha: 0.95 });
    for (let k = 1; k < 4; k++) {
      node.moveTo(-size + size * k / 2, -size * 0.55).lineTo(-size + size * k / 2, size * 0.55);
    }
    node
      .moveTo(-size, 0)
      .lineTo(size, 0)
      .stroke({ color: 0x07090d, width: 0.6, alpha: 0.7 })
      .rect(-size, -size * 0.55, size * 2, size * 1.1)
      .stroke({ color: mixColor(DEBRIS_LIGHT, starColor, 0.35), width: 1, alpha: 0.6 });
    node.eventMode = 'none';
    extent = Math.max(extent, semiMajor * (1 + eccentricity));
    return {
      node,
      semiMajor,
      eccentricity,
      cosPeriapsis: Math.cos(periapsis),
      sinPeriapsis: Math.sin(periapsis),
      cosInclination: Math.cos(inclination),
      sinInclination: Math.sin(inclination),
      cosNode: Math.cos(ascendingNode),
      sinNode: Math.sin(ascendingNode),
      meanAnomaly: rng() * TAU,
      meanMotion: 0.8 * ORBITAL_K / Math.pow(semiMajor, 1.5),
      tumble: rng() * TAU,
      tumbleSpeed: (rng() - 0.5) * 1.6,
    };
  });

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const nodes: Container[] = [back, front, ...debris.map((piece) => piece.node)];

  return {
    nodes,
    extent,
    starAlpha: 1 - 0.35 * anomaly.integrity,
    coronaAlpha: 1 - 0.5 * anomaly.integrity,
    update(dt: number, elapsed: number, basis: ProjectionBasis) {
      spin += spinSpeed * dt;
      shell.orient(basis, spin, elapsed);

      for (const piece of debris) {
        piece.meanAnomaly += piece.meanMotion * dt;
        piece.tumble += piece.tumbleSpeed * dt;
        debrisPosition(piece, point);
        projectSystemPointWithBasis(point, basis, projected);
        piece.node.position.set(projected.x, projected.y);
        piece.node.zIndex = projected.depth;
        piece.node.rotation = piece.tumble * 0.5;
        piece.node.scale.set(projected.scale, projected.scale * (0.3 + 0.7 * Math.abs(Math.cos(piece.tumble))));
      }
    },
    destroy() {
      shell.destroy();
      for (const piece of debris) piece.node.destroy();
      geometry.destroy();
      lattice.source.destroy();
    },
  };
}
