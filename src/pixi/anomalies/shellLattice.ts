import type { Graphics } from 'pixi.js';
import type { Rng } from '../../game/types';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createBasisScratch, depthComponent, spinBasis } from './shared';

export interface ShellPanel {
  normal: Point3D;
  tangent: Point3D;
  bitangent: Point3D;
  halfSize: number;
  shade: number;
}

export interface PanelShade {
  color: number;
  alpha: number;
}

export type PanelShader = (panel: ShellPanel, facing: number, out: PanelShade) => void;

export interface PanelSet {
  panels: ShellPanel[];
  radius: number;
  facing: Float32Array;
  order: number[];
  basis: ProjectionBasis;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PANEL_FILL = 0.84;
const TEAR_COUNT = 6;
const TEAR_JITTER = 0.18;
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

const cornerPoint: Point3D = { x: 0, y: 0, z: 0 };
const cornerProjection: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
const cornerX = new Float32Array(4);
const cornerY = new Float32Array(4);
const shadeScratch: PanelShade = { color: 0, alpha: 0 };

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function orthonormalFrame(normal: Point3D): { tangent: Point3D; bitangent: Point3D } {
  let tx = normal.z;
  let tz = -normal.x;
  let length = Math.hypot(tx, tz);
  if (length < 1e-6) {
    tx = 1;
    tz = 0;
    length = 1;
  }
  const tangent = { x: tx / length, y: 0, z: tz / length };
  const bitangent = {
    x: normal.y * tangent.z - normal.z * tangent.y,
    y: normal.z * tangent.x - normal.x * tangent.z,
    z: normal.x * tangent.y - normal.y * tangent.x,
  };
  return { tangent, bitangent };
}

function createPanel(normal: Point3D, halfSize: number, shade: number): ShellPanel {
  return { normal, ...orthonormalFrame(normal), halfSize, shade };
}

export function buildSphereLattice(count: number, rng: Rng): ShellPanel[] {
  const halfSize = Math.sqrt(4 * Math.PI / count) * 0.5 * PANEL_FILL;
  const offset = rng() * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / count;
    const ring = Math.sqrt(1 - y * y);
    const theta = offset + i * GOLDEN_ANGLE;
    return createPanel({ x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring }, halfSize, rng());
  });
}

export function buildCapLattice(count: number, halfAngle: number, axis: Point3D, rng: Rng): ShellPanel[] {
  const cosEdge = Math.cos(halfAngle);
  const halfSize = Math.sqrt(2 * Math.PI * (1 - cosEdge) / count) * 0.5 * PANEL_FILL;
  const { tangent, bitangent } = orthonormalFrame(axis);
  const offset = rng() * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const height = 1 - (1 - cosEdge) * (i + 0.5) / count;
    const ring = Math.sqrt(Math.max(0, 1 - height * height));
    const theta = offset + i * GOLDEN_ANGLE;
    const across = Math.cos(theta) * ring;
    const along = Math.sin(theta) * ring;
    return createPanel({
      x: axis.x * height + tangent.x * across + bitangent.x * along,
      y: axis.y * height + tangent.y * across + bitangent.y * along,
      z: axis.z * height + tangent.z * across + bitangent.z * along,
    }, halfSize, rng());
  });
}

export function applyIntegrity(panels: ShellPanel[], integrity: number, rng: Rng): ShellPanel[] {
  const removeCount = Math.round(panels.length * (1 - integrity));
  if (removeCount <= 0 || panels.length === 0) return panels;
  const tears = Array.from({ length: TEAR_COUNT }, () => ({
    centre: panels[Math.floor(rng() * panels.length)].normal,
    reach: 0.25 + rng() * 0.55,
    weight: 0.6 + rng() * 0.8,
  }));
  const scores = panels.map((panel) => {
    let score = rng() * TEAR_JITTER;
    for (const tear of tears) {
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(panel.normal, tear.centre))));
      score += tear.weight * Math.exp(-((angle / tear.reach) ** 2));
    }
    return score;
  });
  const removed = new Set(panels.map((_, i) => i).sort((a, b) => scores[b] - scores[a]).slice(0, removeCount));
  return panels.filter((_, i) => !removed.has(i));
}

export function createPanelSet(panels: ShellPanel[], radius: number): PanelSet {
  return {
    panels,
    radius,
    facing: new Float32Array(panels.length),
    order: panels.map((_, i) => i),
    basis: createBasisScratch(),
  };
}

export function orientShell(set: PanelSet, basis: ProjectionBasis, spin = 0) {
  spinBasis(basis, spin, set.basis);
  for (let i = 0; i < set.panels.length; i++) set.facing[i] = depthComponent(set.panels[i].normal, set.basis);
  set.order.sort((a, b) => set.facing[a] - set.facing[b]);
}

export function drawShellHalf(gfx: Graphics, set: PanelSet, shade: PanelShader, side: 'back' | 'front') {
  const { panels, radius, facing, order, basis } = set;
  const wantsBack = side === 'back';
  for (const index of order) {
    const panelFacing = facing[index];
    if ((panelFacing < 0) !== wantsBack) continue;
    const panel = panels[index];
    shade(panel, panelFacing, shadeScratch);
    if (shadeScratch.alpha <= 0) continue;
    for (let k = 0; k < 4; k++) {
      const u = CORNER_SIGNS[k][0] * panel.halfSize;
      const v = CORNER_SIGNS[k][1] * panel.halfSize;
      cornerPoint.x = radius * (panel.normal.x + panel.tangent.x * u + panel.bitangent.x * v);
      cornerPoint.y = radius * (panel.normal.y + panel.tangent.y * u + panel.bitangent.y * v);
      cornerPoint.z = radius * (panel.normal.z + panel.tangent.z * u + panel.bitangent.z * v);
      projectSystemPointWithBasis(cornerPoint, basis, cornerProjection);
      cornerX[k] = cornerProjection.x;
      cornerY[k] = cornerProjection.y;
    }
    gfx
      .moveTo(cornerX[0], cornerY[0])
      .lineTo(cornerX[1], cornerY[1])
      .lineTo(cornerX[2], cornerY[2])
      .lineTo(cornerX[3], cornerY[3])
      .closePath()
      .fill({ color: shadeScratch.color, alpha: shadeScratch.alpha });
  }
}
