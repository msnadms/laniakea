import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { ORBITAL_K } from '../../game/planetGen';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { applyIntegrity, buildSphereLattice, createPanelSet, drawShellHalf, orientShell, type PanelShader } from './shellLattice';
import { makeSelectable, mixColor, SHELL_Z, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const PANEL_COUNT = 460;
const BACK_COLOR = 0x0a0706;
const FRONT_DARK = 0x16120f;
const FRONT_LIGHT = 0x2c2621;
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
  const radius = Math.min(sunRadius * 1.5, innermostOrbit * 0.85);
  const shell = createPanelSet(applyIntegrity(buildSphereLattice(PANEL_COUNT, rng), anomaly.integrity, rng), radius);
  const spinSpeed = (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.03);
  let spin = rng() * TAU;

  const shade: PanelShader = (panel, facing, out) => {
    if (facing < 0) {
      out.color = mixColor(BACK_COLOR, starColor, 0.08 + panel.shade * 0.1);
      out.alpha = 0.94;
      return;
    }
    const rim = Math.pow(1 - facing, 3);
    out.color = mixColor(mixColor(FRONT_DARK, FRONT_LIGHT, panel.shade), starColor, rim * 0.5);
    out.alpha = 0.97;
  };

  const back = new Graphics();
  back.zIndex = -SHELL_Z;
  const front = new Graphics();
  front.zIndex = SHELL_Z;
  makeSelectable(back, radius, onSelect);
  makeSelectable(front, radius, onSelect);

  const minSemiMajor = radius * 1.3;
  const maxSemiMajor = Math.max(minSemiMajor * 1.15, Math.min(radius * 2.3, innermostOrbit * 0.95));
  let extent = radius;
  const debris: Debris[] = Array.from({ length: 20 + Math.floor(rng() * 21) }, () => {
    const semiMajor = minSemiMajor + (maxSemiMajor - minSemiMajor) * rng();
    const eccentricity = rng() * Math.min(0.45, 1 - radius * 1.12 / semiMajor);
    const periapsis = rng() * TAU;
    const inclination = (rng() - 0.5) * 1.0;
    const ascendingNode = rng() * TAU;
    const size = 5 + rng() * 9;
    const node = new Graphics()
      .rect(-size, -size * 0.55, size * 2, size * 1.1)
      .fill({ color: mixColor(DEBRIS_DARK, DEBRIS_LIGHT, rng()), alpha: 0.95 })
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
    update(dt: number, _elapsed: number, basis: ProjectionBasis) {
      spin += spinSpeed * dt;
      orientShell(shell, basis, spin);
      back.clear();
      front.clear();
      drawShellHalf(back, shell, shade, 'back');
      drawShellHalf(front, shell, shade, 'front');

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
      for (const node of nodes) node.destroy();
    },
  };
}
