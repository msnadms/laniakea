import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLogisticsStore, computeRouteCost, willRaiseDetection } from '../store/logisticsStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from '../store/extractorStore';
import { useSettlementStore } from '../store/settlementStore';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { RESOURCE_LABELS, EXTRACTOR_UPGRADES, COST_KEY_TO_RESOURCE } from '../game/types';
import { ICON_PATHS, UpgradeModuleIcon } from './CargoIcons';
import type { Extractor, ExtractorKey, Settlement, SettlementKey, ColonyState, ColonyProductionSlot } from '../game/types';
import { MAX_COLONY_SLOTS, COLONY_SLOT_COSTS } from '../game/types';
import { saveLogisticsRoute, deleteLogisticsRoute } from '../firebase/logisticsRoutes';
import { updateExtractorCollected } from '../firebase/extractors';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveColonyState } from '../firebase/settlements';
import { fmt } from './strings';
import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';
import './LogisticsModal.css';

function costLabel(exotic: number, helium: number): string {
  if (exotic === 0 && helium === 0) return '—';
  const parts: string[] = [];
  if (exotic > 0) parts.push(`${exotic} EM`);
  if (helium > 0) parts.push(`${helium} He-3`);
  return parts.join(' + ');
}

function getSystemKey(ext: Extractor): string {
  return `${ext.galaxySeed}|${ext.systemId}`;
}

function getSystemName(exts: Extractor[]): string {
  if (exts.length === 1) return exts[0].planetName;
  return exts[0].systemName || exts[0].planetName;
}

const MAP_SIZE = 320;
const MAP_CENTER = MAP_SIZE / 2;
const NODE_R = 10;
const VISUAL_R = MAP_CENTER - NODE_R - 18;
// Ratio for mixing galaxy-space and system-space offsets in multi-galaxy projection
const SYS_TO_SC = GALAXY_RADIUS / SC_WORLD_HALF;

type NodeType = 'extractor' | 'colony';

interface RawMapNode {
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
  // extractor-specific
  resources?: Array<{ label: string; type: string; accumulated: number; rate: number }>;
  totalAccumulated?: number;
}

interface ProjectedMapNode extends RawMapNode {
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

  // Group extractors by system
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

  // Group colonies by system
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

function projectNodes(
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

function StationMap({
  projected,
  draftNodeKeys,
  onToggle,
  onNodeHover,
}: {
  projected: ProjectedMapNode[];
  draftNodeKeys: string[];
  onToggle: (keys: string[]) => void;
  onNodeHover: (nodeId: string) => void;
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

  // Deduplicate draftNodeKeys into ordered node sequence for edge drawing
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
        const fromNode = byNodeId[routeNodeIds[e.i]];
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

// ── Modal ─────────────────────────────────────────────────────────────────────

export function LogisticsModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <LogisticsModalInner onClose={onClose} />,
    document.body,
  );
}

function LogisticsModalInner({ onClose }: { onClose: () => void }) {
  const routes = useLogisticsStore((s) => s.routes);
  const addRoute = useLogisticsStore((s) => s.addRoute);
  const updateRoute = useLogisticsStore((s) => s.updateRoute);
  const removeRoute = useLogisticsStore((s) => s.removeRoute);
  const dispatchRoute = useLogisticsStore((s) => s.dispatchRoute);
  const extractors = useExtractorStore((s) => s.extractors);
  const ownedUpgrades = useExtractorStore((s) => s.ownedUpgrades);
  const nodeEquipped = useExtractorStore((s) => s.nodeEquipped);
  const pendingUpgrades = useExtractorStore((s) => s.pendingUpgrades);
  const purchaseUpgrade = useExtractorStore((s) => s.purchaseUpgrade);
  const equipUpgrade = useExtractorStore((s) => s.equipUpgrade);
  const claimPendingUpgrade = useExtractorStore((s) => s.claimPendingUpgrade);
  const settlements = useSettlementStore((s) => s.settlements);
  const colonyStates = useSettlementStore((s) => s.colonyStates);
  const setSlotTarget = useSettlementStore((s) => s.setSlotTarget);
  const unlockColonySlot = useSettlementStore((s) => s.unlockColonySlot);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const storageB = useUIStore((s) => s.storageB);
  const logisticsB = useUIStore((s) => s.logisticsB);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3 = useUIStore((s) => s.helium3Reserves);
  const alloys = useUIStore((s) => s.alloys);
  const user = useAuthStore((s) => s.user);

  function saveUpgrades() {
    if (!user) return;
    const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
    saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
  }

  const handleSetSlotTarget = useCallback((key: string, slotIdx: number, upgradeId: string | null) => {
    setSlotTarget(key, slotIdx, upgradeId);
    if (user) {
      const cs = useSettlementStore.getState().colonyStates[key];
      if (cs) saveColonyState(user.uid, key, cs);
    }
  }, [setSlotTarget, user]);

  const handleUnlockColonySlot = useCallback((key: string) => {
    const cs = useSettlementStore.getState().colonyStates[key];
    const slotCount = cs?.slots.length ?? 1;
    const costIdx = slotCount - 1;
    const cost = COLONY_SLOT_COSTS[costIdx];
    if (!cost) return;
    const ui = useUIStore.getState();
    if ((cost.alloys ?? 0) > ui.alloys || (cost.exotic ?? 0) > ui.exoticMatter) return;
    if (cost.alloys) ui.spendAlloys(cost.alloys);
    if (cost.exotic) ui.consumeExoticMatter(cost.exotic);
    unlockColonySlot(key);
    if (user) {
      const updated = useSettlementStore.getState().colonyStates[key];
      if (updated) saveColonyState(user.uid, key, updated);
    }
  }, [unlockColonySlot, user]);

  const handleClaimUpgrade = useCallback((pendingId: string) => {
    claimPendingUpgrade(pendingId);
    if (user) {
      const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
      saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
    }
  }, [claimPendingUpgrade, user]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftNodeKeys, setDraftNodeKeys] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [lastHoveredNodeId, setLastHoveredNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'resources' | 'inventory'>('resources');
  const [pendingEquip, setPendingEquip] = useState<{ extractorKey: string; nodeName: string; resourceLabel: string; slot: 0 | 1 } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const maxRoutes = logisticsA;
  const canAddRoute = routes.length < maxRoutes;
  const allExtractors = useMemo(() => Object.values(extractors), [extractors]);
  const allSettlements = useMemo(() => Object.values(settlements), [settlements]);

  const projected = projectNodes(allExtractors, allSettlements, nodeEquipped);
  const lastHoveredNode = lastHoveredNodeId
    ? projected.find((p) => p.nodeId === lastHoveredNodeId) ?? null
    : null;

  function startNew() {
    const defaultName = `Route ${String.fromCharCode(65 + routes.length)}`;
    setEditingId(null);
    setDraftName(defaultName);
    setDraftNodeKeys([]);
  }

  function startEdit(id: string) {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    setEditingId(id);
    setDraftName(route.name);
    setDraftNodeKeys([...route.nodeKeys]);
  }

  function toggleNode(keys: string[]) {
    setDraftNodeKeys((prev) => {
      const anyIn = keys.some((k) => prev.includes(k));
      if (anyIn) return prev.filter((k) => !keys.includes(k));
      return [...prev, ...keys];
    });
  }

  function handleSave() {
    const validKeys = draftNodeKeys.filter((k) => !!extractors[k] || !!settlements[k]);
    if (validKeys.length < 2) return;
    const name = draftName.trim() || 'Route';
    if (editingId) {
      updateRoute(editingId, { name, nodeKeys: validKeys });
      if (user) saveLogisticsRoute(user.uid, { id: editingId, name, nodeKeys: validKeys });
    } else {
      const id = crypto.randomUUID();
      const route = { id, name, nodeKeys: validKeys };
      addRoute(route);
      if (user) saveLogisticsRoute(user.uid, route);
      setEditingId(id);
    }
  }

  const handleDispatch = useCallback((routeId: string) => {
    const route = routes.find((r) => r.id === routeId);
    if (!route) return;
    // FIX: read live settlements from store so newly-placed colonies aren't missed
    const liveSettlements = useSettlementStore.getState().settlements;
    const colonyKeys = route.nodeKeys.filter((k) => !!liveSettlements[k]);
    const collectedKeys = dispatchRoute(routeId);
    if (collectedKeys !== false && user) {
      if (collectedKeys.length > 0) {
        const updatedExtractors = useExtractorStore.getState().extractors;
        for (const key of collectedKeys) {
          const ts = updatedExtractors[key]?.lastCollectedAt;
          if (ts !== undefined) updateExtractorCollected(user.uid, key, ts);
        }
      }
      const updatedColonyStates = useSettlementStore.getState().colonyStates;
      for (const colonyKey of colonyKeys) {
        const cs = updatedColonyStates[colonyKey];
        if (cs) saveColonyState(user.uid, colonyKey, cs);
      }
      const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
      saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
    }
  }, [routes, dispatchRoute, user]);

  function handleDelete(routeId: string) {
    if (editingId === routeId) {
      setEditingId(null);
      setDraftName('');
      setDraftNodeKeys([]);
    }
    removeRoute(routeId);
    if (user) deleteLogisticsRoute(user.uid, routeId);
  }

  const draftCost = computeRouteCost(draftNodeKeys, extractors, settlements);
  const isEditing = draftName !== '' || draftNodeKeys.length > 0;

  // Ordered list of unique nodes in the current draft for the order chain display
  type DraftNode = { nodeId: string; name: string; keys: string[]; isColony: boolean };
  const draftOrderChain = useMemo(() => {
    const seen = new Set<string>();
    const result: DraftNode[] = [];
    for (const k of draftNodeKeys) {
      const ext = extractors[k];
      const col = settlements[k];
      if (ext) {
        const sk = getSystemKey(ext);
        if (!seen.has(sk)) {
          seen.add(sk);
          result.push({ nodeId: sk, name: getSystemName([ext]), keys: [], isColony: false });
        }
        result.find((s) => s.nodeId === sk)!.keys.push(k);
      } else if (col) {
        const colId = `colony:${col.galaxySeed}|${col.systemId}`;
        if (!seen.has(colId)) {
          seen.add(colId);
          result.push({ nodeId: colId, name: col.systemName || col.planetName, keys: [], isColony: true });
        }
        result.find((s) => s.nodeId === colId)!.keys.push(k);
      }
    }
    return result;
  }, [draftNodeKeys, extractors, settlements]);

  // Resources panel: group extractors by system, sort by total accumulated
  const systemGroups = useMemo(() => {
    const map = new Map<string, Extractor[]>();
    for (const ext of allExtractors) {
      const sk = getSystemKey(ext);
      if (!map.has(sk)) map.set(sk, []);
      map.get(sk)!.push(ext);
    }
    return [...map.values()].sort(
      (a, b) =>
        b.reduce((s, e) => s + peekAccumulated(e), 0) -
        a.reduce((s, e) => s + peekAccumulated(e), 0),
    );
    // storageB/logisticsB affect peekAccumulated used for sorting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExtractors, storageB, logisticsB]);

  return (
    <div className="logistics-overlay" onClick={onClose}>
      <div className="logistics-panel" onClick={(e) => e.stopPropagation()}>
        <div className="logistics-header">
          <span className="logistics-title">Logistics Network</span>
          <button className="logistics-close" onClick={onClose}>✕</button>
        </div>

        <div className="logistics-body">
          {/* ── Left: routes list ── */}
          <div className="logistics-routes-panel">
            <div className="logistics-routes-header">
              <span className="logistics-routes-label">Drone Routes</span>
              <span className="logistics-routes-cap">{routes.length}/{maxRoutes}</span>
            </div>

            {logisticsA === 0 ? (
              <div className="logistics-locked">
                <div className="logistics-locked-title">Logistics Locked</div>
                <div className="logistics-locked-desc">
                  Upgrade Extraction Logistics in the Ship Workshop to unlock drone route planning.
                </div>
              </div>
            ) : (
              <>
                <button
                  className="logistics-new-btn"
                  onClick={startNew}
                  disabled={!canAddRoute && !isEditing}
                >
                  + New Route
                </button>

                <div className="logistics-routes-list">
                  {routes.map((route) => {
                    const cost = computeRouteCost(route.nodeKeys, extractors, settlements);
                    const extractorKeys = route.nodeKeys.filter((k) => !!extractors[k]);
                    const stations = extractorKeys.map((k) => extractors[k]) as Extractor[];
                    const colonyCount = route.nodeKeys.filter((k) => !!settlements[k]).length;
                    const nodeCount = route.nodeKeys.filter((k) => !!extractors[k] || !!settlements[k]).length;
                    const anyAccum = stations.some((s) => peekAccumulated(s) > 0);
                    const routeColonyKeys = route.nodeKeys.filter((k) => !!settlements[k]);
                    const hasReadyColonyItems = routeColonyKeys.some((k) =>
                      (colonyStates[k]?.slots ?? []).some(
                        (slot) => slot.inProduction && slot.inProduction.availableAt <= Date.now(),
                      ),
                    );
                    const canAfford = exoticMatter >= cost.exotic && helium3 >= cost.helium;
                    const canDispatch = route.nodeKeys.length >= 2 && (anyAccum || hasReadyColonyItems) && canAfford;
                    const raisesDetection = willRaiseDetection(extractorKeys, extractors);

                    return (
                      <div
                        key={route.id}
                        className={`logistics-route-card${editingId === route.id ? ' logistics-route-card--active' : ''}`}
                        onClick={() => startEdit(route.id)}
                      >
                        <div className="logistics-route-card-name">{route.name}</div>
                        <div className="logistics-route-card-meta">
                          <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                          {colonyCount > 0 && (
                            <span style={{ color: 'rgba(60,200,100,0.8)' }}>
                              {colonyCount} colon{colonyCount !== 1 ? 'ies' : 'y'}
                            </span>
                          )}
                        </div>
                        <div className="logistics-route-card-cost">{costLabel(cost.exotic, cost.helium)}</div>
                        {raisesDetection && (
                          <div className="logistics-route-card-detection-warn">
                            ! dispatch raises detection
                          </div>
                        )}
                        <div className="logistics-route-card-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="logistics-card-btn"
                            disabled={!canDispatch}
                            onClick={() => handleDispatch(route.id)}
                          >
                            Dispatch
                          </button>
                          <button
                            className="logistics-card-btn logistics-card-btn--danger"
                            onClick={() => handleDelete(route.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── Middle: editor ── */}
          {logisticsA > 0 && (
            <div className="logistics-editor">
              {!isEditing ? (
                <div className="logistics-editor-empty">
                  Select a route or create a new one
                </div>
              ) : (
                <>
                  {/* Name row */}
                  <div className="logistics-editor-row">
                    <span className="logistics-editor-label">Name</span>
                    <input
                      className="logistics-name-input"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={32}
                      spellCheck={false}
                    />
                  </div>

                  {/* Station map */}
                  <div className="logistics-map-section">
                    <div className="logistics-col-label">
                      Extractors &amp; colonies — click to add/remove from route
                    </div>
                    <div className="station-map-container">
                      <StationMap
                        projected={projected}
                        draftNodeKeys={draftNodeKeys}
                        onToggle={toggleNode}
                        onNodeHover={setLastHoveredNodeId}
                      />
                      {lastHoveredNode && lastHoveredNode.nodeType === 'extractor' && (
                        <NodeSidebar
                          node={lastHoveredNode}
                          nodeEquipped={nodeEquipped}
                          onSlotClick={(extractorKey, slot, resourceLabel) => {
                            setRightPanel('inventory');
                            setPendingEquip({ extractorKey, nodeName: lastHoveredNode.name, resourceLabel, slot });
                          }}
                          onUnequip={(extractorKey, slot) => { equipUpgrade(extractorKey, slot, null); saveUpgrades(); }}
                        />
                      )}
                      {lastHoveredNode && lastHoveredNode.nodeType === 'colony' && (
                        <ColonySidebar
                          node={lastHoveredNode}
                          settlements={settlements}
                          colonyStates={colonyStates}
                          exoticMatter={exoticMatter}
                          alloys={alloys}
                          onSetTarget={handleSetSlotTarget}
                          onUnlockSlot={handleUnlockColonySlot}
                        />
                      )}
                    </div>
                  </div>

                  {/* Footer: cost + order + save */}
                  <div className="logistics-editor-footer">
                    <div className="logistics-cost-display">
                      <div className="logistics-cost-label">Route Cost</div>
                      <div className={`logistics-cost-value${draftCost.exotic === 0 && draftCost.helium === 0 ? ' logistics-cost-value--zero' : ''}`}>
                        {draftNodeKeys.length < 2
                          ? 'Add at least 2 nodes'
                          : costLabel(draftCost.exotic, draftCost.helium)}
                      </div>
                    </div>
                    <div className="logistics-route-order">
                      <span className="logistics-col-label" style={{ marginRight: 8 }}>Order</span>
                      <span className="logistics-order-chain">
                        {draftOrderChain.length === 0 ? (
                          <span className="logistics-order-placeholder">—</span>
                        ) : (
                          <>
                            {draftOrderChain.slice(0, 5).map((node, i, arr) => (
                              <span key={node.nodeId} className="logistics-order-chain-item">
                                <span
                                  className="logistics-order-node"
                                  onClick={() => toggleNode(node.keys)}
                                  title="Click to remove"
                                  style={node.isColony ? { color: 'rgba(60,220,100,0.8)', borderColor: 'rgba(30,140,60,0.35)' } : undefined}
                                >
                                  <span className="logistics-order-num">{i + 1}</span>
                                  {node.name.length > 8 ? node.name.slice(0, 7) + '…' : node.name}
                                </span>
                                {(i < arr.length - 1 || draftOrderChain.length > 5) && (
                                  <span className="logistics-order-arrow">→</span>
                                )}
                              </span>
                            ))}
                            {draftOrderChain.length > 5 && (
                              <span className="logistics-order-overflow">+{draftOrderChain.length - 5}</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className="logistics-save-btn"
                      disabled={draftNodeKeys.filter((k) => !!extractors[k] || !!settlements[k]).length < 2}
                      onClick={handleSave}
                    >
                      Save Route
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* ── Right panel ── */}
          <div className="logistics-resources-panel">
            <div className="logistics-resources-header lm-tab-header">
              <button
                className={`lm-tab-btn${rightPanel === 'resources' ? ' lm-tab-btn--active' : ''}`}
                onClick={() => { setRightPanel('resources'); setPendingEquip(null); }}
              >
                Reserves
              </button>
              <button
                className={`lm-tab-btn${rightPanel === 'inventory' ? ' lm-tab-btn--active' : ''}`}
                onClick={() => setRightPanel('inventory')}
              >
                Inventory
              </button>
            </div>

            {rightPanel === 'inventory' ? (
              <InventoryPanel
                pendingEquip={pendingEquip}
                ownedUpgrades={ownedUpgrades}
                nodeEquipped={nodeEquipped}
                onEquip={(upgradeId) => {
                  if (!pendingEquip) return;
                  equipUpgrade(pendingEquip.extractorKey, pendingEquip.slot, upgradeId);
                  saveUpgrades();
                  setPendingEquip(null);
                }}
                onUnequip={(slot) => {
                  if (!pendingEquip) return;
                  equipUpgrade(pendingEquip.extractorKey, slot, null);
                  saveUpgrades();
                  setPendingEquip(null);
                }}
              />
            ) : (
              <>
                <div className="logistics-reserves-section">
                  <div className="logistics-reserve-row">
                    <span className="logistics-resource-type">Exotic Matter</span>
                    <span className="logistics-resource-amount">{fmt(exoticMatter)}</span>
                  </div>
                  <div className="logistics-reserve-row">
                    <span className="logistics-resource-type">Helium-3</span>
                    <span className="logistics-resource-amount">{fmt(helium3)}</span>
                  </div>
                </div>
                <div className="logistics-resources-header logistics-resources-header--sub">
                  <span className="logistics-routes-label">Accumulated</span>
                </div>
                {allExtractors.length === 0 ? (
                  <div className="logistics-resources-empty">No stations</div>
                ) : (
                  <div className="logistics-resources-list">
                    {systemGroups.map((exts) => {
                      const sysName = getSystemName(exts);
                      const sk = getSystemKey(exts[0]);
                      return (
                        <div key={sk} className="logistics-system-group">
                          <div className="logistics-system-group-name">{sysName}</div>
                          {exts.map((ext) => {
                            const accum = peekAccumulated(ext);
                            return (
                              <div key={ext.key} className="logistics-resource-row">
                                <div className="logistics-resource-meta">
                                  <span className="logistics-resource-type">{RESOURCE_LABELS[ext.resourceType]}</span>
                                  <span className={`logistics-resource-amount${accum === 0 ? ' logistics-resource-amount--zero' : ''}`}>
                                    {fmt(accum)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
                {pendingUpgrades.length > 0 && (
                  <>
                    <div className="logistics-resources-header logistics-resources-header--sub">
                      <span className="logistics-routes-label">Colony Output</span>
                    </div>
                    <div className="lm-pending-list">
                      {pendingUpgrades.map((item) => {
                        const upg = EXTRACTOR_UPGRADES.find((u) => u.id === item.upgradeId);
                        const msLeft = item.availableAt - Date.now();
                        const ready = msLeft <= 0;
                        const hoursLeft = ready ? 0 : Math.ceil(msLeft / (60 * 60 * 1000));
                        return (
                          <div key={item.id} className="lm-pending-item">
                            <div className="lm-pending-item-name">{upg?.name ?? item.upgradeId}</div>
                            <div className="lm-pending-item-row">
                              <span className={`lm-pending-item-status${ready ? ' lm-pending-item-status--ready' : ''}`}>
                                {ready ? 'Ready' : `${hoursLeft}h`}
                              </span>
                              {ready && (
                                <button className="lm-pending-claim-btn" onClick={() => handleClaimUpgrade(item.id)}>
                                  Claim
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Colony sidebar ────────────────────────────────────────────────────────────

function SlotView({
  slot,
  slotIdx,
  colonyKey,
  onSetTarget,
}: {
  slot: ColonyProductionSlot;
  slotIdx: number;
  colonyKey: string;
  onSetTarget: (key: string, idx: number, upgradeId: string | null) => void;
}) {
  const now = Date.now();
  const recipe = slot.targetUpgradeId ? EXTRACTOR_UPGRADES.find((u) => u.id === slot.targetUpgradeId) : null;
  const ip = slot.inProduction;
  const msLeft = ip ? ip.availableAt - now : 0;
  const ready = ip && msLeft <= 0;
  const hoursLeft = ip && !ready ? Math.ceil(msLeft / (60 * 60 * 1000)) : 0;

  return (
    <div className="lm-colony-slot-block">
      <div className="lm-colony-slot-label">Slot {slotIdx + 1}</div>
      <div className="lm-colony-target-row">
        <select
          className="lm-colony-target-select"
          value={slot.targetUpgradeId ?? ''}
          onChange={(e) => onSetTarget(colonyKey, slotIdx, e.target.value || null)}
          disabled={!!ip}
        >
          <option value="">— None —</option>
          {EXTRACTOR_UPGRADES.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>
      {recipe && !ip && (
        <div className="lm-colony-recipe">
          {Object.entries(recipe.cost).map(([costKey, costAmt]) => {
            if (!costAmt) return null;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) return null;
            const have = slot.pendingResources[resourceType] ?? 0;
            const pct = Math.min(100, (have / costAmt) * 100);
            return (
              <div key={costKey} className="lm-colony-recipe-row">
                <span className="lm-colony-recipe-label">{RESOURCE_LABELS[resourceType]}</span>
                <div className="lm-colony-progress-track">
                  <div className="lm-colony-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="lm-colony-recipe-val">{fmt(have)}/{fmt(costAmt)}</span>
              </div>
            );
          })}
        </div>
      )}
      {ip && (
        <div className="lm-colony-queue-item">
          <span className="lm-colony-queue-name">{EXTRACTOR_UPGRADES.find((u) => u.id === ip.upgradeId)?.name ?? ip.upgradeId}</span>
          <span className={`lm-colony-queue-time${ready ? ' lm-colony-queue-time--ready' : ''}`}>
            {ready ? 'Ready — dispatch to collect' : `${hoursLeft}h`}
          </span>
        </div>
      )}
    </div>
  );
}

function ColonySidebar({
  node,
  settlements,
  colonyStates,
  exoticMatter,
  alloys,
  onSetTarget,
  onUnlockSlot,
}: {
  node: ProjectedMapNode;
  settlements: Record<string, Settlement>;
  colonyStates: Record<string, ColonyState>;
  exoticMatter: number;
  alloys: number;
  onSetTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  onUnlockSlot: (key: string) => void;
}) {
  return (
    <div className="lm-submodal lm-submodal--colony">
      <div className="lm-submodal-header">{node.name}</div>
      <div className="lm-colony-title-label">Colony Production</div>
      {node.keys.map((k) => {
        const settlement = settlements[k];
        const cs = colonyStates[k] ?? { slots: [{ targetUpgradeId: null, pendingResources: {}, inProduction: null }] };
        const slotCount = cs.slots.length;
        const costIdx = slotCount - 1;
        const nextCost = COLONY_SLOT_COSTS[costIdx];
        const canUnlock = slotCount < MAX_COLONY_SLOTS && !!nextCost;
        const canAffordUnlock = canUnlock
          ? (nextCost.alloys ?? 0) <= alloys && (nextCost.exotic ?? 0) <= exoticMatter
          : false;
        const unlockLabel = nextCost
          ? [nextCost.alloys ? `${fmt(nextCost.alloys)} alloys` : '', nextCost.exotic ? `${fmt(nextCost.exotic)} EM` : ''].filter(Boolean).join(' + ')
          : '';
        return (
          <div key={k} className="lm-colony-entry">
            {node.keys.length > 1 && settlement && (
              <div className="lm-colony-planet-name">{settlement.planetName}</div>
            )}
            {cs.slots.map((slot, i) => (
              <SlotView key={i} slot={slot} slotIdx={i} colonyKey={k} onSetTarget={onSetTarget} />
            ))}
            {canUnlock && (
              <button
                className="lm-colony-unlock-btn"
                disabled={!canAffordUnlock}
                onClick={() => onUnlockSlot(k)}
                title={unlockLabel}
              >
                + Unlock Slot {slotCount + 1} · {unlockLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Node sidebar ──────────────────────────────────────────────────────────────

function NodeSidebar({
  node,
  nodeEquipped,
  onSlotClick,
  onUnequip,
}: {
  node: ProjectedMapNode;
  nodeEquipped: Record<string, [string | null, string | null]>;
  onSlotClick: (extractorKey: string, slot: 0 | 1, resourceLabel: string) => void;
  onUnequip: (extractorKey: string, slot: 0 | 1) => void;
}) {
  const resources = node.resources ?? [];
  const totalRate = resources.reduce((s, r) => s + r.rate, 0);
  const [slotTooltip, setSlotTooltip] = useState<{ upg: typeof EXTRACTOR_UPGRADES[number]; x: number; y: number } | null>(null);

  return (
    <div className="lm-submodal">
      <div className="lm-submodal-header">{node.name}</div>
      {resources.length > 1 && (
        <div className="lm-submodal-rate">+{fmt(totalRate)}/hr total</div>
      )}
      {resources.map((r, i) => {
        const extractorKey = node.keys[i];
        const slots = nodeEquipped[extractorKey] ?? [null, null];
        return (
          <div key={extractorKey} className="lm-submodal-extractor">
            <div className="lm-submodal-resource-row">
              <span className="lm-submodal-res-label">{r.label}</span>
              <span className="lm-submodal-res-val">
                {fmt(r.accumulated)}
                <span className="lm-submodal-res-rate"> +{fmt(r.rate)}/hr</span>
              </span>
            </div>
            <div className="lm-submodal-slots">
              {([0, 1] as const).map((slotIdx) => {
                const equipped = slots[slotIdx];
                const upgradeDef = equipped ? EXTRACTOR_UPGRADES.find((u) => u.id === equipped) : null;
                return (
                  <button
                    key={slotIdx}
                    className={`lm-submodal-slot${equipped ? ' lm-submodal-slot--filled' : ''}`}
                    onClick={() => {
                      if (equipped) { setSlotTooltip(null); onUnequip(extractorKey, slotIdx); }
                      else { onSlotClick(extractorKey, slotIdx, r.label); }
                    }}
                    onMouseEnter={upgradeDef ? (e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setSlotTooltip({ upg: upgradeDef, x: rect.left, y: rect.bottom + 6 });
                    } : undefined}
                    onMouseLeave={upgradeDef ? () => setSlotTooltip(null) : undefined}
                  >
                    {equipped ? (
                      <UpgradeModuleIcon size={36} />
                    ) : (
                      <span className="lm-submodal-slot-label">Slot {slotIdx + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {slotTooltip && createPortal(
        <div className="lm-slot-tooltip" style={{ left: slotTooltip.x, top: slotTooltip.y }}>
          <div className="lm-slot-tooltip-name">{slotTooltip.upg.name}</div>
          <div className="lm-slot-tooltip-desc">{slotTooltip.upg.effect.multiplier}x to {slotTooltip.upg.effect.upgType}</div>
          <div className="lm-slot-tooltip-hint">Click to unequip</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Inventory panel ────────────────────────────────────────────────────────────

function InventoryPanel({
  pendingEquip,
  ownedUpgrades,
  nodeEquipped,
  onEquip,
  onUnequip,
}: {
  pendingEquip: { extractorKey: string; nodeName: string; resourceLabel: string; slot: 0 | 1 } | null;
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;
  onEquip: (id: string) => void;
  onUnequip: (slot: 0 | 1) => void;
}) {
  function ownedCount(upgradeId: string): number {
    return ownedUpgrades.filter((id) => id === upgradeId).length;
  }

  function totalEquipped(upgradeId: string): number {
    let n = 0;
    for (const s of Object.values(nodeEquipped)) {
      if (s[0] === upgradeId) n++;
      if (s[1] === upgradeId) n++;
    }
    return n;
  }

  function equippedElsewhereCount(upgradeId: string): number {
    if (!pendingEquip) return totalEquipped(upgradeId);
    let n = 0;
    for (const [k, s] of Object.entries(nodeEquipped)) {
      if (k === pendingEquip.extractorKey) {
        const other = pendingEquip.slot === 0 ? 1 : 0;
        if (s[other] === upgradeId) n++;
      } else {
        if (s[0] === upgradeId) n++;
        if (s[1] === upgradeId) n++;
      }
    }
    return n;
  }

  return (
    <>
      {pendingEquip && (
        <div className="lm-inventory-context">
          {pendingEquip.nodeName} · {pendingEquip.resourceLabel} · Slot {pendingEquip.slot + 1}
        </div>
      )}
      <div className="lm-inventory-list">
        {EXTRACTOR_UPGRADES.map((upg) => {
          const owned = ownedCount(upg.id);
          const equipped = totalEquipped(upg.id);

          const inThisSlot = pendingEquip
            ? (nodeEquipped[pendingEquip.extractorKey] ?? [null, null])[pendingEquip.slot] === upg.id
            : false;
          const elsewhereN = equippedElsewhereCount(upg.id);
          const canEquipHere = pendingEquip && !inThisSlot && owned > elsewhereN;

          let actionLabel: string;
          let actionClass = 'lm-inventory-btn';
          let actionDisabled = false;
          let action: (() => void) | null = null;

          if (pendingEquip) {
            if (inThisSlot) {
              actionLabel = 'Remove';
              actionClass += ' lm-inventory-btn--equipped';
              action = () => onUnequip(pendingEquip.slot);
            } else if (canEquipHere) {
              actionLabel = 'Equip';
              action = () => onEquip(upg.id);
            } else {
              actionLabel = owned > 0 ? 'All in use' : 'Colony only';
              actionClass += ' lm-inventory-btn--disabled';
              actionDisabled = true;
            }
          } else {
            actionLabel = owned > 0 ? `×${owned}` : 'Colony only';
            actionClass += owned > 0 ? ' lm-inventory-btn--owned' : ' lm-inventory-btn--disabled';
            actionDisabled = true;
          }

          return (
            <div key={upg.id} className="lm-inventory-item">
              <div className="lm-inventory-item-row">
                <button
                  className={actionClass}
                  disabled={actionDisabled}
                  onClick={action ?? undefined}
                >
                  <UpgradeModuleIcon size={14} />
                </button>
                <div className="lm-inventory-item-info">
                  <span className="lm-inventory-item-name">{upg.name}</span>
                  {owned > 0 && (
                    <span className="lm-inventory-item-count">
                      ×{owned}{equipped > 0 ? ` (${equipped} equipped)` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="lm-inventory-item-desc">{upg.effect.multiplier}x to {upg.effect.upgType}</div>
              <div className="lm-inventory-item-status">{actionLabel}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
