import type { Geometry, Mesh, Shader } from 'pixi.js';
import { ORBITAL_K } from '../../game/planetGen';
import type { Rng } from '../../game/types';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createPanelBatch, createPanelShader, type PanelInstance, type PanelLook } from './collectorPanels';
import { makeSelectable, SHELL_Z, TAU } from './shared';

export interface CollectorSwarmStyle {
  count: number;
  minRings: number;
  extraRings: number;
  radiusSpread: number;
  inclinationSpread: number;
  size: number;
  tumble: boolean;
  look: PanelLook;
}

export const PHOTOVOLTAIC_LOOK: PanelLook = {
  outline: 'hex',
  transmission: 0.45,
  mirror: false,
  cells: 7,
  aspect: 1,
  face: 0x1d2f5c,
  reflectivity: 0.9,
  hull: 0x9a7a3c,
  heat: 0xff5a1e,
  heatStrength: 0.35,
  lights: true,
  ambient: 0.16,
};

export const RUINED_PHOTOVOLTAIC_LOOK: PanelLook = {
  ...PHOTOVOLTAIC_LOOK,
  face: 0x1a1b20,
  reflectivity: 0.25,
  transmission: 0.14,
  hull: 0x3a332b,
  heatStrength: 0,
  lights: false,
  ambient: 0.1,
};

export const MIRROR_LOOK: PanelLook = {
  outline: 'hex',
  transmission: 0.16,
  mirror: true,
  cells: 6,
  aspect: 1,
  face: 0x8c96a6,
  reflectivity: 1,
  hull: 0x6f7480,
  heat: 0xff6a2a,
  heatStrength: 0.22,
  lights: true,
  ambient: 0.14,
};

export const RUINED_MIRROR_LOOK: PanelLook = {
  ...MIRROR_LOOK,
  face: 0x2c2e33,
  reflectivity: 0.3,
  transmission: 0.08,
  hull: 0x2e2f33,
  heatStrength: 0,
  lights: false,
  ambient: 0.1,
};

export const BEAM_COLLECTORS: CollectorSwarmStyle = {
  count: 300,
  minRings: 5,
  extraRings: 2,
  radiusSpread: 0.4,
  inclinationSpread: 2.2,
  size: 7,
  tumble: false,
  look: MIRROR_LOOK,
};

export const RUINED_BEAM_COLLECTORS: CollectorSwarmStyle = {
  ...BEAM_COLLECTORS,
  tumble: true,
  look: RUINED_MIRROR_LOOK,
};

interface Collector {
  radius: number;
  cosInclination: number;
  sinInclination: number;
  cosNode: number;
  sinNode: number;
  phase: number;
  speed: number;
  trim: number;
  tumbleAxis: Point3D;
  tumbleSpeed: number;
  tumblePhase: number;
}

export interface CollectorSwarm {
  back: Mesh<Geometry, Shader>;
  front: Mesh<Geometry, Shader>;
  count: number;
  position(index: number, elapsed: number, out: Point3D): Point3D;
  update(elapsed: number, basis: ProjectionBasis): void;
  destroy(): void;
}

function wrapAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function orbitalToSystem(collector: Collector, x: number, y: number, z: number, out: Point3D) {
  const inclinedY = y * collector.cosInclination - z * collector.sinInclination;
  const inclinedZ = y * collector.sinInclination + z * collector.cosInclination;
  out.x = x * collector.cosNode - inclinedZ * collector.sinNode;
  out.y = inclinedY;
  out.z = x * collector.sinNode + inclinedZ * collector.cosNode;
}

function rotateAbout(vector: Point3D, axis: Point3D, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;
  const cx = axis.y * vector.z - axis.z * vector.y;
  const cy = axis.z * vector.x - axis.x * vector.z;
  const cz = axis.x * vector.y - axis.y * vector.x;
  const x = vector.x * cos + cx * sin + axis.x * dot * (1 - cos);
  const y = vector.y * cos + cy * sin + axis.y * dot * (1 - cos);
  const z = vector.z * cos + cz * sin + axis.z * dot * (1 - cos);
  vector.x = x;
  vector.y = y;
  vector.z = z;
}

function sortByDepth(order: Uint32Array, count: number, depths: Float32Array) {
  order.subarray(0, count).sort((a, b) => depths[a] - depths[b]);
}

export function createCollectorSwarm(
  rng: Rng,
  swarmRadius: number,
  integrity: number,
  starColor: number,
  onSelect: () => void,
  style: CollectorSwarmStyle = BEAM_COLLECTORS,
): CollectorSwarm {
  const collectors: Collector[] = [];
  const panels: PanelInstance[] = [];
  const ringCount = style.minRings + Math.floor(rng() * style.extraRings);
  const perRing = Math.round(style.count / ringCount);
  for (let ring = 0; ring < ringCount; ring++) {
    const radius = swarmRadius * (1 - style.radiusSpread / 2 + rng() * style.radiusSpread);
    const inclination = (rng() - 0.5) * style.inclinationSpread;
    const ascendingNode = rng() * TAU;
    const speed = 0.5 * ORBITAL_K / Math.pow(radius, 1.5);
    const gapCount = 1 + Math.floor(rng() * 3);
    const gaps = Array.from({ length: gapCount }, () => ({
      start: rng() * TAU,
      length: (1 - integrity) * TAU / gapCount * (0.6 + rng() * 0.8),
    }));
    for (let k = 0; k < perRing; k++) {
      const phase = k / perRing * TAU + (rng() - 0.5) * 0.4 / perRing * TAU;
      if (gaps.some((gap) => wrapAngle(phase - gap.start) < gap.length)) continue;
      const axisY = rng() * 2 - 1;
      const axisRing = Math.sqrt(1 - axisY * axisY);
      const axisTheta = rng() * TAU;
      collectors.push({
        radius: radius * (1 + (rng() - 0.5) * 0.03),
        cosInclination: Math.cos(inclination),
        sinInclination: Math.sin(inclination),
        cosNode: Math.cos(ascendingNode),
        sinNode: Math.sin(ascendingNode),
        phase,
        speed,
        trim: (rng() - 0.5) * 0.22,
        tumbleAxis: { x: Math.cos(axisTheta) * axisRing, y: axisY, z: Math.sin(axisTheta) * axisRing },
        tumbleSpeed: (rng() - 0.5) * 1.4,
        tumblePhase: rng() * TAU,
      });
      panels.push({
        center: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 0 },
        tangent: { x: 0, y: 0, z: 0 },
        bitangent: { x: 0, y: 0, z: 0 },
        size: style.size * (0.8 + rng() * 0.4),
        seed: rng() * 100,
        damage: style.tumble ? 0.25 + rng() * 0.6 * (1 - integrity) : rng() < 0.04 ? rng() * 0.3 : 0,
      });
    }
  }

  const count = collectors.length;
  const panelShader = createPanelShader(style.look, starColor);
  const backBatch = createPanelBatch(count, panelShader.shader, style.look.aspect);
  const frontBatch = createPanelBatch(count, panelShader.shader, style.look.aspect);
  const back = backBatch.mesh;
  back.zIndex = -SHELL_Z;
  const front = frontBatch.mesh;
  front.zIndex = SHELL_Z;
  const reach = swarmRadius * (1 + style.radiusSpread / 2) * 1.1;
  makeSelectable(back, reach, onSelect);
  makeSelectable(front, reach, onSelect);

  const depths = new Float32Array(count);
  const backOrder = new Uint32Array(count);
  const frontOrder = new Uint32Array(count);
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const orbitNormal: Point3D = { x: 0, y: 0, z: 0 };
  const worldAxis: Point3D = { x: 0, y: 0, z: 0 };

  const position = (index: number, elapsed: number, out: Point3D) => {
    const collector = collectors[index];
    const angle = collector.phase + collector.speed * elapsed;
    orbitalToSystem(collector, Math.cos(angle) * collector.radius, 0, Math.sin(angle) * collector.radius, out);
    return out;
  };

  const orient = (index: number, elapsed: number) => {
    const collector = collectors[index];
    const panel = panels[index];
    const angle = collector.phase + collector.speed * elapsed;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    orbitalToSystem(collector, cos * collector.radius, 0, sin * collector.radius, panel.center);
    orbitalToSystem(collector, -cos, 0, -sin, panel.normal);
    orbitalToSystem(collector, -sin, 0, cos, panel.tangent);
    orbitalToSystem(collector, 0, 1, 0, orbitNormal);
    rotateAbout(panel.normal, orbitNormal, collector.trim);
    rotateAbout(panel.tangent, orbitNormal, collector.trim);
    panel.bitangent.x = orbitNormal.x;
    panel.bitangent.y = orbitNormal.y;
    panel.bitangent.z = orbitNormal.z;
    if (!style.tumble) return;
    const axis = collector.tumbleAxis;
    worldAxis.x = -cos * axis.x - sin * axis.z;
    worldAxis.y = axis.y;
    worldAxis.z = -sin * axis.x + cos * axis.z;
    orbitalToSystem(collector, worldAxis.x, worldAxis.y, worldAxis.z, worldAxis);
    const tumble = collector.tumblePhase + collector.tumbleSpeed * elapsed;
    rotateAbout(panel.normal, worldAxis, tumble);
    rotateAbout(panel.tangent, worldAxis, tumble);
    rotateAbout(panel.bitangent, worldAxis, tumble);
  };

  return {
    back,
    front,
    count,
    position,
    update(elapsed: number, basis: ProjectionBasis) {
      let backCount = 0;
      let frontCount = 0;
      for (let index = 0; index < count; index++) {
        orient(index, elapsed);
        projectSystemPointWithBasis(panels[index].center, basis, projected);
        depths[index] = projected.depth;
        if (projected.depth < 0) backOrder[backCount++] = index;
        else frontOrder[frontCount++] = index;
      }
      sortByDepth(backOrder, backCount, depths);
      sortByDepth(frontOrder, frontCount, depths);
      backBatch.write(panels, backOrder, backCount, basis);
      frontBatch.write(panels, frontOrder, frontCount, basis);
      panelShader.setTime(elapsed);
    },
    destroy() {
      backBatch.destroy();
      frontBatch.destroy();
      panelShader.destroy();
    },
  };
}
