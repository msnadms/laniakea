import { peekAccumulated, extractorUnitsPerHour } from '../store/extractorStore';
import { RESOURCE_LABELS, extractorNodeId, fabricatorNodeId, colonyNodeId } from '../game/types';
import type { Extractor, Fabricator, Colony } from '../game/types';
import { colonyDefense, colonyPopCap } from '../store/colonyStore';
import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';
import { useUIStore } from '../store/uiStore';

export function getSystemKey(ext: Extractor): string {
  return extractorNodeId(ext.galaxySeed, ext.systemId);
}

export function getSystemName(exts: Extractor[]): string {
  if (exts.length === 1) return exts[0].planetName;
  return exts[0].systemName || exts[0].planetName;
}

export const MAP_SIZE = 320;
export const MAP_CENTER = MAP_SIZE / 2;
export const NODE_R = 10;
const VISUAL_R = MAP_CENTER - NODE_R - 18;
// Ratio for mixing galaxy-space and system-space offsets in multi-galaxy projection
const SYS_TO_SC = GALAXY_RADIUS / SC_WORLD_HALF;

export type NodeType = 'extractor' | 'fabricator' | 'colony';

export interface RawMapNode {
  nodeId: string;
  nodeType: NodeType;
  name: string;
  keys: string[];
  galaxySeed: number;
  superclusSeed: number;
  sysX: number;
  sysY: number;
  galX: number;
  galY: number;
  resources?: Array<{ label: string; type: string; accumulated: number; rate: number }>;
  totalAccumulated?: number;
  advanced?: boolean;
  populationFill?: number;
  supplied?: boolean;
}

export interface ProjectedMapNode extends RawMapNode {
  svgX: number;
  svgY: number;
}

const MIN_NODE_DIST = NODE_R * 2 + 16;
const TARGET_NODE_SEP = NODE_R * 5;
const MAX_LAYOUT_R = MAP_SIZE * 3;

function layoutOffsets(offsets: { x: number; y: number }[]): { x: number; y: number }[] {
  let maxDist = 0;
  for (const o of offsets) maxDist = Math.max(maxDist, Math.hypot(o.x, o.y));
  let minSep = Infinity;
  for (let i = 1; i < offsets.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(offsets[i].x - offsets[j].x, offsets[i].y - offsets[j].y);
      if (d > 1e-6 && d < minSep) minSep = d;
    }
  }
  const bySep = Number.isFinite(minSep) ? TARGET_NODE_SEP / minSep : VISUAL_R / (maxDist || 1);
  const byRadius = maxDist > 0 ? MAX_LAYOUT_R / maxDist : bySep;
  const scale = Math.min(bySep, byRadius);
  return offsets.map((o) => ({ x: MAP_CENTER + o.x * scale, y: MAP_CENTER - o.y * scale }));
}

function resolveOverlaps<T extends { svgX: number; svgY: number }>(nodes: T[]): T[] {
  const placed = [...nodes].sort(
    (a, b) =>
      Math.hypot(a.svgX - MAP_CENTER, a.svgY - MAP_CENTER) -
      Math.hypot(b.svgX - MAP_CENTER, b.svgY - MAP_CENTER),
  );
  const MAX_PASSES = 8;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 1; i < placed.length; i++) {
      for (let j = 0; j < i; j++) {
        let dx = placed[i].svgX - placed[j].svgX;
        let dy = placed[i].svgY - placed[j].svgY;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // Coincident nodes (e.g. fabricator + extractor in the same system) have a
          // zero delta to push along — substitute a deterministic per-index direction
          const angle = i * 2.3999632; // golden angle keeps repeated pushes spread out
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        if (dist < MIN_NODE_DIST) {
          const f = MIN_NODE_DIST / dist;
          placed[i] = { ...placed[i], svgX: placed[j].svgX + dx * f, svgY: placed[j].svgY + dy * f };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return placed;
}

function buildRawNodes(
  extractors: Extractor[],
  fabricators: Fabricator[],
  nodeEquipped: Record<string, [string | null, string | null]>,
  now: number,
  colonies: Colony[],
): RawMapNode[] {
  const nodes: RawMapNode[] = [];

  const extMap = new Map<string, Extractor[]>();
  for (const ext of extractors) {
    const sk = getSystemKey(ext);
    if (!extMap.has(sk)) extMap.set(sk, []);
    extMap.get(sk)!.push(ext);
  }
  for (const [sk, exts] of extMap) {
    const rep = exts[0];
    const resources = exts.map((e) => {
      return {
        label: RESOURCE_LABELS[e.resourceType],
        type: e.resourceType as string,
        accumulated: peekAccumulated(e, now),
        rate: extractorUnitsPerHour(e, useUIStore.getState().logisticsB, nodeEquipped),
      };
    });
    nodes.push({
      nodeId: sk,
      nodeType: 'extractor',
      name: getSystemName(exts),
      keys: exts.map((e) => e.key),
      galaxySeed: rep.galaxySeed,
      superclusSeed: rep.superclusSeed,
      sysX: rep.systemX,
      sysY: rep.systemY,
      galX: rep.galaxyX,
      galY: rep.galaxyY,
      resources,
      totalAccumulated: resources.reduce((s, r) => s + r.accumulated, 0),
    });
  }

  const colMap = new Map<string, Fabricator[]>();
  for (const s of fabricators) {
    const sk = fabricatorNodeId(s.galaxySeed, s.systemId);
    if (!colMap.has(sk)) colMap.set(sk, []);
    colMap.get(sk)!.push(s);
  }
  for (const [sk, cols] of colMap) {
    const rep = cols[0];
    nodes.push({
      nodeId: sk,
      nodeType: 'fabricator',
      name: rep.systemName || rep.planetName,
      keys: cols.map((c) => c.key),
      galaxySeed: rep.galaxySeed,
      superclusSeed: rep.superclusSeed,
      sysX: rep.systemX,
      sysY: rep.systemY,
      galX: rep.galaxyX,
      galY: rep.galaxyY,
      advanced: cols.some((c) => c.tier >= 2),
    });
  }

  const colonyGroups = new Map<string, Colony[]>();
  for (const c of colonies) {
    const id = colonyNodeId(c.galaxySeed, c.systemId);
    colonyGroups.set(id, [...(colonyGroups.get(id) ?? []), c]);
  }
  for (const [nodeId, members] of colonyGroups) {
    const c = members[0];
    nodes.push({ nodeId, nodeType: 'colony', name: `${c.systemName} - ${members.some(x => x.foundedAt) ? 'Colony' : 'Charter'}`,
      keys: members.map(x => x.key), galaxySeed: c.galaxySeed, superclusSeed: c.superclusSeed,
      sysX: c.systemX, sysY: c.systemY, galX: c.galaxyX, galY: c.galaxyY,
      populationFill: members.reduce((n,x) => n+x.population, 0) / Math.max(1, members.reduce((n,x) => n+colonyPopCap(x), 0)),
      supplied: members.every(x => (x.supplies.nutrients ?? 0) > 0 && colonyDefense(x).batteries > 0),
    });
  }
  return nodes;
}

export function projectNodes(
  extractors: Extractor[],
  fabricators: Fabricator[],
  nodeEquipped: Record<string, [string | null, string | null]>,
  now: number = Date.now(),
  colonies: Colony[] = [],
): ProjectedMapNode[] {
  const rawNodes = buildRawNodes(extractors, fabricators, nodeEquipped, now, colonies);
  if (rawNodes.length === 0) return [];
  if (rawNodes.length === 1) {
    return [{ ...rawNodes[0], svgX: MAP_CENTER, svgY: MAP_CENTER }];
  }

  const galaxySeeds = new Set(rawNodes.map((n) => n.galaxySeed));
  let rawPoints: { x: number; y: number }[];

  if (galaxySeeds.size <= 1) {
    const cx = rawNodes.reduce((s, p) => s + p.sysX, 0) / rawNodes.length;
    const cy = rawNodes.reduce((s, p) => s + p.sysY, 0) / rawNodes.length;
    rawPoints = layoutOffsets(rawNodes.map((p) => ({ x: p.sysX - cx, y: p.sysY - cy })));
  } else {
    const gcx = rawNodes.reduce((s, p) => s + p.galX, 0) / rawNodes.length;
    const gcy = rawNodes.reduce((s, p) => s + p.galY, 0) / rawNodes.length;

    const sysCenter = new Map<number, { mx: number; my: number }>();
    for (const seed of galaxySeeds) {
      const grp = rawNodes.filter((p) => p.galaxySeed === seed);
      sysCenter.set(seed, {
        mx: grp.reduce((s, p) => s + p.sysX, 0) / grp.length,
        my: grp.reduce((s, p) => s + p.sysY, 0) / grp.length,
      });
    }

    rawPoints = layoutOffsets(
      rawNodes.map((p) => {
        const c = sysCenter.get(p.galaxySeed)!;
        return {
          x: (p.galX - gcx) + (p.sysX - c.mx) * SYS_TO_SC,
          y: (p.galY - gcy) + (p.sysY - c.my) * SYS_TO_SC,
        };
      }),
    );
  }

  return resolveOverlaps(
    rawNodes.map((n, i) => ({ ...n, svgX: rawPoints[i].x, svgY: rawPoints[i].y })),
  );
}
