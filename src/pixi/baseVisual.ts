import { Container, Graphics } from 'pixi.js';
import { DEFENCE_ORBIT_SLOTS } from '../game/constants';
import type { DefenceKind, Platform } from '../game/defences';
import { useBaseStore } from '../store/baseStore';
import { addSystemPoints, orbitPoint, projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from './projection';

const ORBIT_FACTORS = [1.9, 2.35, 2.8];
const ORBIT_SPEEDS = [0.22, 0.16, 0.11];
const PLATFORM_SIZE = 3.2;
const NO_PLATFORMS: readonly Platform[] = [];

const PLATFORM_COLORS: Record<DefenceKind, number> = {
  pointDefence: 0x7ac8ff,
  missile: 0xffa05a,
  railgun: 0xd08aff,
  shield: 0x6af0e0,
};

interface PlatformNode {
  node: Graphics;
  orbit: number;
  slot: number;
  local: Point3D;
  point: Point3D;
  projected: ProjectedPoint;
}

export interface BaseVisual {
  update: (planet: Point3D, basis: ProjectionBasis, elapsed: number) => void;
  destroy: () => void;
}

function drawPlatform(kind: DefenceKind): Graphics {
  const g = new Graphics();
  const s = PLATFORM_SIZE;
  const color = PLATFORM_COLORS[kind];
  switch (kind) {
    case 'pointDefence':
      g.rect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4);
      break;
    case 'missile':
      g.poly([0, -s, s, 0, 0, s, -s, 0]);
      break;
    case 'railgun':
      g.poly([0, -s * 1.2, s, s * 0.8, -s, s * 0.8]);
      break;
    case 'shield':
      g.circle(0, 0, s);
      break;
  }
  g.fill({ color, alpha: 0.9 }).stroke({ color: 0xffffff, width: 0.6, alpha: 0.6 });
  g.eventMode = 'none';
  return g;
}

export function createBaseVisual(scene: Container, planetRadius: number): BaseVisual {
  let nodes: PlatformNode[] = [];
  let shown: readonly Platform[] | null = null;

  const rebuild = (defences: readonly Platform[]) => {
    for (const { node } of nodes) node.destroy();
    nodes = defences.map((platform) => {
      const node = drawPlatform(platform.kind);
      scene.addChild(node);
      return {
        node,
        orbit: platform.orbit,
        slot: platform.slot,
        local: { x: 0, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        projected: { x: 0, y: 0, depth: 0, scale: 1 },
      };
    });
    shown = defences;
  };

  return {
    update(planet, basis, elapsed) {
      const defences = useBaseStore.getState().base?.defences ?? NO_PLATFORMS;
      if (defences !== shown) rebuild(defences);
      for (const platform of nodes) {
        const radius = planetRadius * ORBIT_FACTORS[platform.orbit];
        const angle = (platform.slot / DEFENCE_ORBIT_SLOTS[platform.orbit]) * Math.PI * 2 + elapsed * ORBIT_SPEEDS[platform.orbit];
        orbitPoint(angle, radius, 0, platform.local);
        addSystemPoints(planet, platform.local, platform.point);
        projectSystemPointWithBasis(platform.point, basis, platform.projected);
        platform.node.position.set(platform.projected.x, platform.projected.y);
        platform.node.scale.set(platform.projected.scale);
        platform.node.zIndex = platform.projected.depth;
      }
    },
    destroy() {
      for (const { node } of nodes) node.destroy();
      nodes = [];
    },
  };
}
