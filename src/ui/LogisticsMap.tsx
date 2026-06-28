import { useMemo } from 'react';
import { peekAccumulated, getExtractorMultipliers } from '../store/extractorStore';
import { RESOURCE_LABELS } from '../game/types';
import { ICON_PATHS } from './CargoIcons';
import type { Extractor, Settlement } from '../game/types';
import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';

export function getSystemKey(ext: Extractor): string {
  return `${ext.galaxySeed}|${ext.systemId}`;
}

export function getSystemName(exts: Extractor[]): string {
  if (exts.length === 1) return exts[0].planetName;
  return exts[0].systemName || exts[0].planetName;
}

const MAP_SIZE = 320;
const MAP_CENTER = MAP_SIZE / 2;
const NODE_R = 10;
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
        const dx = placed[i].svgX - placed[j].svgX;
        const dy = placed[i].svgY - placed[j].svgY;
        const dist = Math.hypot(dx, dy) || 0.01;
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
        accumulated: peekAccumulated(e),
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
): ProjectedMapNode[] {
  const rawNodes = buildRawNodes(extractors, settlements, nodeEquipped);
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

const ICON_SIZE = NODE_R * 1.6;
const ICON_HALF = ICON_SIZE / 2;

function NodeIcon({ cx, cy, resourceType, color }: { cx: number; cy: number; resourceType: string; color: string }) {
  const d = ICON_PATHS[resourceType as keyof typeof ICON_PATHS];
  if (!d) return null;
  return (
    <path
      d={d}
      fill={color}
      transform={`translate(${cx - ICON_HALF},${cy - ICON_HALF}) scale(${ICON_SIZE / 960}) translate(0,960)`}
      style={{ pointerEvents: 'none' }}
    />
  );
}

export function StationMap({
  projected,
  draftNodeKeys,
  onToggle,
  onNodeHover,
  animActiveNodeId,
}: {
  projected: ProjectedMapNode[];
  draftNodeKeys: string[];
  onToggle: (keys: string[]) => void;
  onNodeHover: (nodeId: string) => void;
  animActiveNodeId?: string | null;
}) {
  const byNodeId = useMemo(
    () => Object.fromEntries(projected.map((p) => [p.nodeId, p])),
    [projected],
  );

  const keyToNodeId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projected) for (const k of p.keys) m[k] = p.nodeId;
    return m;
  }, [projected]);

  if (projected.length === 0) {
    return (
      <div className="station-map-empty">No extraction stations or colonies placed</div>
    );
  }

  const routeNodeIds: string[] = [];
  const seenInRoute = new Set<string>();
  for (const k of draftNodeKeys) {
    const nid = keyToNodeId[k];
    if (nid && !seenInRoute.has(nid)) { seenInRoute.add(nid); routeNodeIds.push(nid); }
  }

  const edges: { x1: number; y1: number; x2: number; y2: number; i: number }[] = [];
  for (let i = 0; i < routeNodeIds.length - 1; i++) {
    const a = byNodeId[routeNodeIds[i]];
    const b = byNodeId[routeNodeIds[i + 1]];
    if (a && b) {
      const dx = b.svgX - a.svgX;
      const dy = b.svgY - a.svgY;
      const len = Math.hypot(dx, dy) || 1;
      const pad = NODE_R + 2;
      edges.push({
        x1: a.svgX + (dx / len) * pad,
        y1: a.svgY + (dy / len) * pad,
        x2: b.svgX - (dx / len) * pad,
        y2: b.svgY - (dy / len) * pad,
        i,
      });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      className="station-map-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id="lm-arrow" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(0,180,220,0.55)" />
        </marker>
        <marker id="lm-arrow-col" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(60,200,100,0.55)" />
        </marker>
      </defs>

      {edges.map((e) => {
        const toNode = byNodeId[routeNodeIds[e.i + 1]];
        const toColony = toNode?.nodeType === 'colony';
        return (
          <line
            key={e.i}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={toColony ? 'rgba(60,200,100,0.45)' : 'rgba(0,180,220,0.45)'}
            strokeWidth="1.2"
            strokeDasharray="5 3"
            markerEnd={toColony ? 'url(#lm-arrow-col)' : 'url(#lm-arrow)'}
          />
        );
      })}

      {projected.map((p) => {
        const inRoute = p.keys.some((k) => draftNodeKeys.includes(k));
        const shortName = p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name;
        const isColony = p.nodeType === 'colony';

        const strokeActive = isColony ? 'rgba(60,220,100,0.9)' : 'rgba(0,215,255,0.85)';
        const strokeIdle = isColony ? 'rgba(30,140,60,0.5)' : 'rgba(0,130,180,0.45)';
        const fillActive = isColony ? 'rgba(20,100,40,0.4)' : 'rgba(0,140,190,0.35)';
        const fillIdle = isColony ? 'rgba(0,30,10,0.5)' : 'rgba(0,50,80,0.5)';
        const glowActive = isColony ? 'rgba(60,200,80,0.2)' : 'rgba(0,210,240,0.2)';
        const labelActive = isColony ? 'rgba(60,220,100,0.8)' : 'rgba(0,200,232,0.75)';
        const labelIdle = isColony ? 'rgba(30,140,60,0.55)' : 'rgba(0,130,170,0.5)';

        const primaryRes = p.resources?.reduce(
          (a, b) => (a.accumulated >= b.accumulated ? a : b),
          p.resources[0],
        );
        const iconColor = inRoute
          ? (isColony ? 'rgba(80,230,120,0.9)' : 'rgba(0,230,255,0.9)')
          : (isColony ? 'rgba(30,140,60,0.55)' : 'rgba(0,150,190,0.55)');

        return (
          <g
            key={p.nodeId}
            onClick={() => onToggle(p.keys)}
            onMouseEnter={() => onNodeHover(p.nodeId)}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={p.svgX} cy={p.svgY} r={NODE_R + 6} fill="transparent" />
            {p.nodeId === animActiveNodeId && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 7}
                fill="rgba(255, 230, 80, 0.07)"
                stroke="rgba(255, 220, 60, 0.85)"
                strokeWidth="1.5"
                className="dispatch-node-pulse"
              />
            )}
            {inRoute && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 3}
                fill="none"
                stroke={glowActive}
                strokeWidth="3"
              />
            )}
            <circle
              cx={p.svgX} cy={p.svgY} r={NODE_R}
              fill={inRoute ? fillActive : fillIdle}
              stroke={inRoute ? strokeActive : strokeIdle}
              strokeWidth="1.5"
            />
            {isColony ? (
              <polygon
                points={`${p.svgX},${p.svgY - ICON_HALF * 0.85} ${p.svgX + ICON_HALF * 0.65},${p.svgY} ${p.svgX},${p.svgY + ICON_HALF * 0.85} ${p.svgX - ICON_HALF * 0.65},${p.svgY}`}
                fill={iconColor}
                style={{ pointerEvents: 'none' }}
              />
            ) : p.resources && p.resources.length > 1 ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType="multiSystem" color={iconColor} />
            ) : primaryRes ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType={primaryRes.type} color={iconColor} />
            ) : null}
            <text
              x={p.svgX} y={p.svgY + NODE_R + 5}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill={inRoute ? labelActive : labelIdle}
              fontSize="6"
              fontFamily="monospace"
              letterSpacing="0.5"
              style={{ pointerEvents: 'none' }}
            >
              {shortName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
