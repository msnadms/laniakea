import { peekAccumulated, getExtractorMultipliers } from '../store/extractorStore';
import { RESOURCE_LABELS } from '../game/types';
import type { Extractor, Settlement } from '../game/types';
import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';

export function getSystemKey(ext: Extractor): string {
  return `${ext.galaxySeed}|${ext.systemId}`;
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

export type NodeType = 'extractor' | 'colony';

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
}

export interface ProjectedMapNode extends RawMapNode {
  svgX: number;
  svgY: number;
}

const MIN_NODE_DIST = NODE_R * 2 + 16;

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
          // Coincident nodes (e.g. colony + extractor in the same system) have a
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
  settlements: Settlement[],
  nodeEquipped: Record<string, [string | null, string | null]>,
  now: number,
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
      const { rateMultiplier } = getExtractorMultipliers(e.key, nodeEquipped);
      return {
        label: RESOURCE_LABELS[e.resourceType],
        type: e.resourceType as string,
        accumulated: peekAccumulated(e, now),
        rate: e.rate * rateMultiplier,
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

  const colMap = new Map<string, Settlement[]>();
  for (const s of settlements) {
    const sk = `colony:${s.galaxySeed}|${s.systemId}`;
    if (!colMap.has(sk)) colMap.set(sk, []);
    colMap.get(sk)!.push(s);
  }
  for (const [sk, cols] of colMap) {
    const rep = cols[0];
    nodes.push({
      nodeId: sk,
      nodeType: 'colony',
      name: rep.systemName || rep.planetName,
      keys: cols.map((c) => c.key),
      galaxySeed: rep.galaxySeed,
      superclusSeed: rep.superclusSeed,
      sysX: rep.systemX,
      sysY: rep.systemY,
      galX: rep.galaxyX,
      galY: rep.galaxyY,
    });
  }

  return nodes;
}

export function projectNodes(
  extractors: Extractor[],
  settlements: Settlement[],
  nodeEquipped: Record<string, [string | null, string | null]>,
  now: number = Date.now(),
): ProjectedMapNode[] {
  const rawNodes = buildRawNodes(extractors, settlements, nodeEquipped, now);
  if (rawNodes.length === 0) return [];
  if (rawNodes.length === 1) {
    return [{ ...rawNodes[0], svgX: MAP_CENTER, svgY: MAP_CENTER }];
  }

  const galaxySeeds = new Set(rawNodes.map((n) => n.galaxySeed));
  let rawPoints: { x: number; y: number }[];

  if (galaxySeeds.size <= 1) {
    const cx = rawNodes.reduce((s, p) => s + p.sysX, 0) / rawNodes.length;
    const cy = rawNodes.reduce((s, p) => s + p.sysY, 0) / rawNodes.length;
    const dists = rawNodes.map((p) => Math.hypot(p.sysX - cx, p.sysY - cy));
    const sorted = [...dists].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
    const normDist = Math.max(Math.min(sorted[sorted.length - 1], median * 3), 1);
    const scale = VISUAL_R / normDist;
    rawPoints = rawNodes.map((p) => {
      const dx = (p.sysX - cx) * scale;
      const dy = (p.sysY - cy) * scale;
      const dist = Math.hypot(dx, dy);
      const f = dist > VISUAL_R ? VISUAL_R / dist : 1;
      return { x: MAP_CENTER + dx * f, y: MAP_CENTER - dy * f };
    });
  } else {
    const gcx = rawNodes.reduce((s, p) => s + p.galX, 0) / rawNodes.length;
    const gcy = rawNodes.reduce((s, p) => s + p.galY, 0) / rawNodes.length;
    const gDists = rawNodes.map((p) => Math.hypot(p.galX - gcx, p.galY - gcy));
    const gSorted = [...gDists].sort((a, b) => a - b);
    const gMedian = gSorted[Math.floor(gSorted.length / 2)] ?? 1;
    const gNorm = Math.max(Math.min(gSorted[gSorted.length - 1], gMedian * 3), 1);
    const gScale = VISUAL_R / gNorm;
    const sysScale = gScale * SYS_TO_SC;

    const sysCenter = new Map<number, { mx: number; my: number }>();
    for (const seed of galaxySeeds) {
      const grp = rawNodes.filter((p) => p.galaxySeed === seed);
      sysCenter.set(seed, {
        mx: grp.reduce((s, p) => s + p.sysX, 0) / grp.length,
        my: grp.reduce((s, p) => s + p.sysY, 0) / grp.length,
      });
    }

    rawPoints = rawNodes.map((p) => {
      const c = sysCenter.get(p.galaxySeed)!;
      const dx = (p.galX - gcx) * gScale + (p.sysX - c.mx) * sysScale;
      const dy = (p.galY - gcy) * gScale + (p.sysY - c.my) * sysScale;
      const dist = Math.hypot(dx, dy);
      const f = dist > VISUAL_R ? VISUAL_R / dist : 1;
      return { x: MAP_CENTER + dx * f, y: MAP_CENTER - dy * f };
    });
  }

  return resolveOverlaps(
    rawNodes.map((n, i) => ({ ...n, svgX: rawPoints[i].x, svgY: rawPoints[i].y })),
  );
}
