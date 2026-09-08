import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  useLogisticsStore,
  computeRouteCost,
  resolveNodeGroups,
  routeFabricatorKeys,
  routeIsValid,
  routeIslandNodes,
  topoOrder,
  successors,
  routeNodes,
  wouldCreateCycle,
  fabricatorNodeStatus,
  edgeKey,
  DEFAULT_AUTOMATION_POLICY,
  AUTOMATION_POLL_MS,
  MAX_DETECTION_CEILING,
  PROBE_ATTENTION_RISK_THRESHOLD,
} from '../store/logisticsStore';
import { useExtractorStore, peekAccumulated } from '../store/extractorStore';
import {
  useFabricatorStore,
  slotStatus,
  previewHoldFeed,
  holdFeedPools,
  orderedSlotIndices,
} from '../store/fabricatorStore';
import type { SlotRunResult, FeedResult } from '../store/fabricatorStore';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore, computeMaterialBandwidth, computeRouteCap } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import {
  RESOURCE_LABELS,
  COST_KEY_TO_RESOURCE,
  MATERIAL_TIER_LABELS,
  RARE_ROLE_LABELS,
  FABRICATOR_TIER_LABELS,
  SLOT_STATUS_LABELS,
  SLOT_FILL_MODE_LABELS,
  bufferDepth,
} from '../game/types';
import { EXTRACTOR_UPGRADES, getCraftable, describeUpgradeEffect } from '../data/upgrades';
import type { Craftable } from '../data/upgrades';
import { CRAFTABLE_MATERIALS, STOCKED_MATERIALS, MATERIAL_TIERS, materialName } from '../data/materials';
import { RARE_RESOURCES, RARE_ROLES } from '../data/rareResources';
import { useStockpileStore } from '../store/stockpileStore';
import { AlloysIcon, ExoticMatterIcon, Helium3Icon, MetallicHydrogenIcon, NeutronStarMatterIcon, NutrientsIcon, UpgradeModuleIcon } from './CargoIcons';
import type { Extractor, Fabricator, FabricatorState, FabricatorProductionSlot, MaterialCost, RouteEdge, SlotStatus, RouteAutomationPolicy, RouteDispatchMode, RouteFillAggregate, Resource, SlotFillMode } from '../game/types';
import { maxFabricatorSlots, makeEmptyFabricatorSlot, RAW_TYPES } from '../game/types';
import { saveLogisticsRoute, deleteLogisticsRoute } from '../firebase/logisticsRoutes';
import { updateExtractorReserve, deleteExtractor } from '../firebase/extractors';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveFabricatorState, saveFabricator, deleteFabricator } from '../firebase/fabricators';
import { saveStockpile } from '../firebase/stockpile';
import { persistFabricatorRun } from '../store/persistRun';
import { fmt } from './strings';
import { StationMap } from './LogisticsMap';
import { getSystemKey, getSystemName, projectNodes } from './logisticsProject';
import type { ProjectedMapNode } from './logisticsProject';
import { useNow } from './useNow';
import { TutorialPanel } from './TutorialPanel';
import './LogisticsModal.css';
import './LogisticsPolicies.css';
import { useColonyStore } from '../store/colonyStore';
import { useGameStore } from '../store/gameStore';
import { ColonyDetails } from './ColonyPanel';

type AnimLine = { text: string; isCost: boolean; revealStep: number };
type DispatchAnim = {
  orderedNodeIds: string[];
  step: number;
  lines: AnimLine[];
  done: boolean;
};

type ExpectedOutputLine = { key: string; text: string };


const ROUTABLE_MATERIALS = [...new Set([...STOCKED_MATERIALS, ...RARE_RESOURCES].map((material) => material.id))];
const DETAIL_POP_HEIGHT = 210;

function ResourceIcon({ type }: { type: Resource['type'] }) {
  switch (type) {
    case 'alloys': return <AlloysIcon />;
    case 'nutrients': return <NutrientsIcon />;
    case 'metallicHydrogen': return <MetallicHydrogenIcon />;
    case 'neutronStarMatter': return <NeutronStarMatterIcon />;
    case 'exotic': return <ExoticMatterIcon />;
    case 'helium-3': return <Helium3Icon />;
    default: return <UpgradeModuleIcon />;
  }
}

function costParts(exotic: number, helium: number): Array<[string, number]> {
  const parts: Array<[string, number]> = [];
  if (exotic > 0) parts.push(['EM', exotic]);
  if (helium > 0) parts.push(['He-3', helium]);
  return parts;
}

function CostChips({ exotic, helium, affordable = true }: { exotic: number; helium: number; affordable?: boolean }) {
  const parts = costParts(exotic, helium);
  if (parts.length === 0) return <span className="lcost-chip lcost-chip--free">Free</span>;
  return (
    <>
      {parts.map(([label, value]) => (
        <span key={label} className={`lcost-chip${affordable ? '' : ' lcost-chip--short'}`}>
          <span className="lcost-chip-val">{fmt(value)}</span>
          <span className="lcost-chip-unit">{label}</span>
        </span>
      ))}
    </>
  );
}

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
  const previewRoute = useLogisticsStore((s) => s.previewRoute);
  const previewDraftEdges = useLogisticsStore((s) => s.previewDraftEdges);
  const setRouteActive = useLogisticsStore((s) => s.setRouteActive);
  const flushHeldCargo = useLogisticsStore((s) => s.flushHeldCargo);
  const lastRuns = useLogisticsStore((s) => s.lastRuns);
  const extractors = useExtractorStore((s) => s.extractors);
  const ownedUpgrades = useExtractorStore((s) => s.ownedUpgrades);
  const nodeEquipped = useExtractorStore((s) => s.nodeEquipped);
  const equipUpgrade = useExtractorStore((s) => s.equipUpgrade);
  const stockpileMaterials = useStockpileStore((s) => s.materials);
  const stockpileRares = useStockpileStore((s) => s.rares);
  const fabricators = useFabricatorStore((s) => s.fabricators);
  const colonies = useColonyStore(s => s.colonies);
  const fabricatorStates = useFabricatorStore((s) => s.fabricatorStates);
  const lastFabricatorRun = useFabricatorStore((s) => s.lastRun);
  const setSlotTarget = useFabricatorStore((s) => s.setSlotTarget);
  const unlockFabricatorSlot = useFabricatorStore((s) => s.unlockFabricatorSlot);
  const moveSlotOrder = useFabricatorStore((s) => s.moveSlotOrder);
  const setDrawFromHold = useFabricatorStore((s) => s.setDrawFromHold);
  const setFillMode = useFabricatorStore((s) => s.setFillMode);
  const removeFabricator = useFabricatorStore((s) => s.removeFabricator);
  const removeExtractor = useExtractorStore((s) => s.removeExtractor);
  const currentSystem = useGameStore((s) => s.system);
  const currentGalaxySeed = useGameStore((s) => s.galaxy.seed);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const logisticsB = useUIStore((s) => s.logisticsB);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3 = useUIStore((s) => s.helium3Reserves);
  const user = useAuthStore((s) => s.user);

  const driveA = useUIStore((s) => s.driveA);
  const driveB = useUIStore((s) => s.driveB);
  const previewWorldKey = useUIStore((s) => [
    s.storageA, s.detectionHeat, s.alloys, s.nutrients, s.metallicHydrogen, s.neutronStarMatter, s.alienMatter,
  ].join('|'));

  const bandwidth = computeMaterialBandwidth(logisticsA, logisticsB);

  const saveUpgrades = useCallback(() => {
    if (!user) return;
    const { ownedUpgrades: owned, nodeEquipped: equipped } = useExtractorStore.getState();
    saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped });
  }, [user]);

  const handleSetSlotTarget = useCallback((key: string, slotIdx: number, upgradeId: string | null) => {
    setSlotTarget(key, slotIdx, upgradeId);
    if (user) {
      const cs = useFabricatorStore.getState().fabricatorStates[key];
      if (cs) saveFabricatorState(user.uid, key, cs);
      const { materials, rares } = useStockpileStore.getState();
      saveStockpile(user.uid, materials, rares);
      const { ownedUpgrades: owned, nodeEquipped: equipped } = useExtractorStore.getState();
      saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped });
    }
  }, [setSlotTarget, user]);

  const handleMoveSlotOrder = useCallback((key: string, slotIdx: number, direction: -1 | 1) => {
    moveSlotOrder(key, slotIdx, direction);
    if (user) {
      const state = useFabricatorStore.getState().fabricatorStates[key];
      if (state) saveFabricatorState(user.uid, key, state);
    }
  }, [moveSlotOrder, user]);

  const handleUnlockFabricatorSlot = useCallback((key: string) => {
    unlockFabricatorSlot(key);
    if (user) {
      const updated = useFabricatorStore.getState().fabricatorStates[key];
      if (updated) saveFabricatorState(user.uid, key, updated);
    }
  }, [unlockFabricatorSlot, user]);

  const handleSetDrawFromHold = useCallback((key: string, enabled: boolean) => {
    setDrawFromHold(key, enabled);
    const fabricator = useFabricatorStore.getState().fabricators[key];
    if (user && fabricator) saveFabricator(user.uid, fabricator);
  }, [setDrawFromHold, user]);

  const handleSetFillMode = useCallback((key: string, mode: SlotFillMode) => {
    setFillMode(key, mode);
    const fabricator = useFabricatorStore.getState().fabricators[key];
    if (user && fabricator) saveFabricator(user.uid, fabricator);
  }, [setFillMode, user]);

  const shipInSystem = useCallback((located: { systemId: number; galaxySeed: number } | undefined) => (
    !!located && currentSystem?.id === located.systemId && currentGalaxySeed === located.galaxySeed
  ), [currentSystem, currentGalaxySeed]);

  const handleDestroyFabricator = useCallback((key: string) => {
    const fabricator = useFabricatorStore.getState().fabricators[key];
    if (!fabricator || shipInSystem(fabricator)) return;
    removeFabricator(key);
    if (user) deleteFabricator(user.uid, key);
  }, [removeFabricator, shipInSystem, user]);

  const handleDestroyExtractor = useCallback((key: string) => {
    const extractor = useExtractorStore.getState().extractors[key];
    if (!extractor || shipInSystem(extractor)) return;
    removeExtractor(key);
    if (user) deleteExtractor(user.uid, key);
  }, [removeExtractor, shipInSystem, user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftEdges, setDraftEdges] = useState<RouteEdge[]>([]);
  const [draftActive, setDraftActive] = useState(false);
  const [draftAutomation, setDraftAutomation] = useState<RouteAutomationPolicy>(DEFAULT_AUTOMATION_POLICY);
  const [lastHoveredNodeId, setLastHoveredNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'resources' | 'materials' | 'modules'>('resources');
  const [pendingEquip, setPendingEquip] = useState<{ extractorKey: string; nodeName: string; resourceLabel: string; slot: 0 | 1 } | null>(null);
  const [dispatchAnim, setDispatchAnim] = useState<DispatchAnim | null>(null);
  const [expectedOutputOpen, setExpectedOutputOpen] = useState(true);
  const [hoveredCard, setHoveredCard] = useState<{ id: string; top: number; left: number } | null>(null);
  const [routePolicyOpen, setRoutePolicyOpen] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!dispatchAnim) return;
    if (dispatchAnim.done) {
      const t = setTimeout(() => setDispatchAnim(null), 1200);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setDispatchAnim((a) => {
        if (!a) return null;
        if (a.step < a.orderedNodeIds.length - 1) return { ...a, step: a.step + 1 };
        return { ...a, done: true };
      });
    }, 500);
    return () => clearTimeout(t);
  }, [dispatchAnim]);

  const maxRoutes = computeRouteCap(logisticsA);
  const canAddRoute = routes.length < maxRoutes;
  const allExtractors = useMemo(() => Object.values(extractors), [extractors]);
  const allFabricators = useMemo(() => Object.values(fabricators), [fabricators]);

  const projected = useMemo(
    () => projectNodes(allExtractors, allFabricators, nodeEquipped, now, Object.values(colonies)),
    [allExtractors, allFabricators, nodeEquipped, now, colonies],
  );
  const lastHoveredNode = lastHoveredNodeId
    ? projected.find((p) => p.nodeId === lastHoveredNodeId) ?? null
    : null;

  function startNew() {
    const defaultName = `Route ${String.fromCharCode(65 + routes.length)}`;
    setEditingId(null);
    setIsEditing(true);
    setDraftName(defaultName);
    setDraftEdges([]);
    setDraftActive(false);
    setDraftAutomation(DEFAULT_AUTOMATION_POLICY);
  }

  function startEdit(id: string) {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    setEditingId(id);
    setIsEditing(true);
    setDraftName(route.name);
    setDraftEdges([...route.edges]);
    setDraftActive(route.active ?? false);
    setDraftAutomation({ ...DEFAULT_AUTOMATION_POLICY, ...(route.automation ?? {}) });
  }

  function unlinkNode(nodeId: string) {
    const next = draftEdges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    if (next.length === draftEdges.length) return;
    setDraftEdges(next);
    autoSaveEdges(next);
  }

  const canLink = useCallback(
    (from: string, to: string) =>
      !draftEdges.some((e) => e.from === from && e.to === to) &&
      !draftEdges.some((e) => e.from === to && e.to === from) &&
      !wouldCreateCycle(draftEdges, from, to),
    [draftEdges],
  );

  function addEdge(from: string, to: string) {
    if (!canLink(from, to)) return;
    const next = [...draftEdges, { from, to }];
    setDraftEdges(next);
    autoSaveEdges(next);
  }

  function removeEdge(edge: RouteEdge) {
    const next = draftEdges.filter((e) => !(e.from === edge.from && e.to === edge.to));
    if (next.length === draftEdges.length) return;
    setDraftEdges(next);
    autoSaveEdges(next);
  }

  function autoSaveEdges(edges: RouteEdge[]) {
    if (!editingId && !routeIsValid(edges)) return;
    commitDraft(edges);
  }

  function updateDraftEdge(index: number, patch: Partial<RouteEdge>) {
    setDraftEdges((edges) => edges.map((edge, edgeIndex) => {
      if (edgeIndex !== index) return edge;
      const next = { ...edge, ...patch } as Record<string, unknown>;
      for (const key of Object.keys(patch)) if (next[key] === undefined) delete next[key];
      return next as unknown as RouteEdge;
    }));
  }

  const draftNodes = useMemo(() => routeNodes(draftEdges), [draftEdges]);
  const draftValid = routeIsValid(draftEdges);

  function commitDraft(edges: RouteEdge[]) {
    const name = draftName.trim() || 'Route';
    const nodes = routeNodes(edges);
    if (editingId) {
      const previousHeld = routes.find((candidate) => candidate.id === editingId)?.heldCargo ?? {};
      const heldCargo = Object.fromEntries(Object.entries(previousHeld)
        .filter(([nodeId]) => nodes.includes(nodeId))
        .map(([nodeId, cargo]) => [nodeId, {
          raw: { ...(cargo.raw ?? {}) }, materials: { ...(cargo.materials ?? {}) },
        }]));
      const fallbackNode = nodes[0];
      for (const [nodeId, cargo] of Object.entries(previousHeld)) {
        if (nodes.includes(nodeId)) continue;
        const target = heldCargo[fallbackNode] ?? { raw: {}, materials: {} };
        for (const [type, amount] of Object.entries(cargo.raw ?? {})) {
          target.raw[type as Resource['type']] = (target.raw[type as Resource['type']] ?? 0) + (amount ?? 0);
        }
        for (const [id, amount] of Object.entries(cargo.materials ?? {})) {
          target.materials[id] = (target.materials[id] ?? 0) + amount;
        }
        heldCargo[fallbackNode] = target;
      }
      const route = {
        id: editingId, name, edges, active: draftActive, automation: draftAutomation,
        heldCargo,
      };
      updateRoute(editingId, { name, edges, active: draftActive, automation: draftAutomation, heldCargo });
      if (user) saveLogisticsRoute(user.uid, route);
    } else {
      if (routes.length >= maxRoutes) return;
      const id = crypto.randomUUID();
      const route = { id, name, edges, active: draftActive, automation: draftAutomation, heldCargo: {} };
      addRoute(route);
      if (user) saveLogisticsRoute(user.uid, route);
      setEditingId(id);
    }
  }

  function handleSave() {
    if (!draftValid) return;
    commitDraft(draftEdges);
  }

  const handleDispatch = useCallback((routeId: string) => {
    const route = routes.find((r) => r.id === routeId);
    if (!route) return;

    const { extractors: liveExtractors } = useExtractorStore.getState();
    const liveFabricators = useFabricatorStore.getState().fabricators;

    const cost = previewRoute(routeId, true).cost;
    const groups = resolveNodeGroups(routeNodes(route.edges), liveExtractors, liveFabricators);
    const fabricatorKeys = routeFabricatorKeys(groups);

    const result = dispatchRoute(routeId);
    if (result !== false) {
      const { collected, deliveries, order, carried, materialsMoved } = result;
      const holdFed = useFabricatorStore.getState().runHoldFeeds();
      if (user) {
        persistFabricatorRun(user.uid, {
          extractorKeys: collected.map(({ key }) => key),
          fabricatorKeys: [...new Set([...fabricatorKeys, ...holdFed])],
          colonyKeys: result.colonyKeys,
          campaign: true,
        });
      }

      const orderedNodeIds = order;
      const nodeCollected = new Map<string, Map<string, number>>();
      for (const { key, amount } of collected) {
        const ext = liveExtractors[key];
        if (!ext || amount <= 0) continue;
        const nid = getSystemKey(ext);
        if (!nodeCollected.has(nid)) nodeCollected.set(nid, new Map());
        const resMap = nodeCollected.get(nid)!;
        resMap.set(ext.resourceType, (resMap.get(ext.resourceType) ?? 0) + amount);
      }

      const lines: AnimLine[] = [];
      if (cost.exotic > 0) lines.push({ text: `-${fmt(cost.exotic)} EM`, isCost: true, revealStep: 0 });
      if (cost.helium > 0) lines.push({ text: `-${fmt(cost.helium)} He-3`, isCost: true, revealStep: 0 });
      for (let i = 0; i < orderedNodeIds.length; i++) {
        const resMap = nodeCollected.get(orderedNodeIds[i]);
        if (resMap) {
          for (const [resType, amt] of resMap) {
            lines.push({
              text: `+${fmt(amt)} ${RESOURCE_LABELS[resType as keyof typeof RESOURCE_LABELS] ?? resType}`,
              isCost: false,
              revealStep: i,
            });
          }
        }
      }

      const lastStep = Math.max(0, orderedNodeIds.length - 1);
      for (const [matId, count] of Object.entries(carried)) {
        if (count > 0) {
          lines.push({ text: `⇢ ${count}x ${materialName(matId)} carried`, isCost: false, revealStep: lastStep });
        }
      }
      for (const d of deliveries) {
        lines.push({
          text: `+${d.count}x ${d.name}`,
          isCost: false,
          revealStep: lastStep,
        });
      }
      if (materialsMoved > 0) {
        lines.push({ text: `${materialsMoved} material-edge units moved - ${bandwidth} cap/edge`, isCost: true, revealStep: lastStep });
      }

      if (orderedNodeIds.length > 0) {
        setDispatchAnim({ orderedNodeIds, step: 0, lines, done: false });
      }
    }
  }, [routes, dispatchRoute, user, bandwidth]);

  function handleDelete(routeId: string) {
    if (editingId === routeId) {
      setEditingId(null);
      setIsEditing(false);
      setDraftName('');
      setDraftEdges([]);
    }
    removeRoute(routeId);
    if (user) deleteLogisticsRoute(user.uid, routeId);
  }

  function handleToggleActive(routeId: string, active: boolean) {
    const route = routes.find((candidate) => candidate.id === routeId);
    if (!route) return;
    setRouteActive(routeId, active);
    if (editingId === routeId) setDraftActive(active);
    if (user) saveLogisticsRoute(user.uid, { ...route, active });
  }

  const draftCost = previewDraftEdges(draftEdges).cost;
  const draftIslands = useMemo(() => routeIslandNodes(draftEdges), [draftEdges]);

  const nodeName = useCallback(
    (nodeId: string) => projected.find((p) => p.nodeId === nodeId)?.name ?? nodeId,
    [projected],
  );

  const draftChain = useMemo(() => {
    const order = topoOrder(draftNodes, draftEdges);
    if (!order) return null;
    return order.map((nodeId) => ({
      nodeId,
      name: nodeName(nodeId),
      isFabricator: nodeId.startsWith('fabricator:'),
      isAdvanced: !!projected.find((p) => p.nodeId === nodeId)?.advanced,
      branches: successors(draftEdges, nodeId).length,
    }));
  }, [draftNodes, draftEdges, nodeName, projected]);

  const nodeStatus = useMemo(() => {
    const map: Record<string, SlotStatus> = {};
    for (const p of projected) {
      if (p.nodeType !== 'fabricator') continue;
      map[p.nodeId] = fabricatorNodeStatus(p.keys, fabricatorStates, fabricators);
    }
    return map;
  }, [projected, fabricatorStates, fabricators]);

  const routeSummaries = useMemo(() => {
    void fabricatorStates; void stockpileMaterials; void logisticsA; void logisticsB; void colonies; void stockpileRares;
    void exoticMatter; void helium3;
    void driveA; void driveB; void previewWorldKey; void nodeEquipped; void now;
    return new Map(routes.map((route) => {
      const preview = previewRoute(route.id, true);
      const groups = resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
      return [route.id, { preview, groups, valid: preview?.valid ?? routeIsValid(route.edges) }];
    }));
  }, [routes, previewRoute, extractors, fabricators, fabricatorStates, stockpileMaterials,
    logisticsA, logisticsB, exoticMatter, helium3,
    driveA, driveB, previewWorldKey, nodeEquipped, colonies, stockpileRares, now]);

  const expectedOutputLines = useMemo(() => {
    if (!editingId) return [];
    const preview = routeSummaries.get(editingId)?.preview;
    if (!preview) return [];

    const lines: ExpectedOutputLine[] = [];
    for (const type of RAW_TYPES) {
      const amount = preview.expectedCollections[type] ?? 0;
      if (amount > 0) lines.push({
        key: `raw:${type}`,
        text: `${fmt(amount)} ${RESOURCE_LABELS[type]}`,
      });
    }
    for (const [id, count] of Object.entries(preview.expectedOutputs)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))) {
      lines.push({
        key: `item:${id}`,
        text: `${fmt(count)}x ${getCraftable(id)?.name ?? materialName(id)}`,
      });
    }
    return lines;
  }, [editingId, routeSummaries]);

  const heldByNode = useMemo(() => {
    const result: Record<string, { routeIds: string[]; raw: Partial<Record<Resource['type'], number>>; materials: MaterialCost }> = {};
    for (const route of routes) for (const [nodeId, cargo] of Object.entries(route.heldCargo ?? {})) {
      const entry = result[nodeId] ?? { routeIds: [], raw: {}, materials: {} };
      entry.routeIds.push(route.id);
      for (const [type, amount] of Object.entries(cargo.raw ?? {})) entry.raw[type as Resource['type']] = (entry.raw[type as Resource['type']] ?? 0) + (amount ?? 0);
      for (const [id, amount] of Object.entries(cargo.materials ?? {})) entry.materials[id] = (entry.materials[id] ?? 0) + amount;
      result[nodeId] = entry;
    }
    return result;
  }, [routes]);

  const systemGroups = useMemo(() => {
    const map = new Map<string, Extractor[]>();
    for (const ext of allExtractors) {
      const sk = getSystemKey(ext);
      if (!map.has(sk)) map.set(sk, []);
      map.get(sk)!.push(ext);
    }
    return [...map.values()].sort(
      (a, b) =>
        b.reduce((s, e) => s + peekAccumulated(e, now), 0) -
        a.reduce((s, e) => s + peekAccumulated(e, now), 0),
    );
  }, [allExtractors, now]);

  return (
    <div className="logistics-overlay" onClick={onClose}>
      <div className="logistics-panel" onClick={(e) => e.stopPropagation()}>
        <div className="logistics-header">
          <span className="logistics-title">Logistics Network</span>
          <div className="logistics-header-actions">
            <TutorialPanel page="logistics" overlay />
            <button className="logistics-close" onClick={onClose} aria-label="Close logistics network">✕</button>
          </div>
        </div>

        <div className="logistics-body">
          {/* ── Left: routes list ── */}
          <div className="logistics-routes-panel">
            <div className="logistics-routes-header">
              <span className="logistics-routes-label">Drone Routes</span>
              <span className="logistics-routes-cap">{routes.length}/{maxRoutes}</span>
            </div>

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
                    const summary = routeSummaries.get(route.id);
                    const preview = summary?.preview ?? null;
                    const cost = preview?.cost ?? computeRouteCost(route.edges, extractors, fabricators);
                    const groups = summary?.groups ?? resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
                    const fabKeys = routeFabricatorKeys(groups);
                    const fabricatorCount = fabKeys.length;
                    const nodeCount = groups.size;
                    const valid = summary?.valid ?? routeIsValid(route.edges);
                    const canAfford = exoticMatter >= cost.exotic && helium3 >= cost.helium;
                    const canDispatch = preview?.canRun === true || (
                      (preview?.reason === 'Probe attention ceiling would be exceeded'
                        || preview?.reason === 'Insufficient route fuel')
                      && valid && canAfford
                    );
                    const raisesDetection = (preview?.detectionRisk ?? 0) > PROBE_ATTENTION_RISK_THRESHOLD;
                    const stalledStatus = fabricatorNodeStatus(fabKeys, fabricatorStates, fabricators);
                    const stalled = stalledStatus === 'jammed' || stalledStatus === 'starved';

                    const status = canDispatch
                      ? { key: 'ready', label: 'Ready' }
                      : !valid
                        ? { key: 'idle', label: 'Incomplete' }
                        : !canAfford
                          ? { key: 'blocked', label: 'Low Fuel' }
                          : { key: 'idle', label: 'No Cargo' };

                    const detail = (
                      <>
                        <div className="lroute-stats">
                          <div className="lroute-stat">
                            <span className="lroute-stat-val">{nodeCount}</span>
                            <span className="lroute-stat-key">Nodes</span>
                          </div>
                          <div className="lroute-stat">
                            <span className={`lroute-stat-val${fabricatorCount > 0 ? ' lroute-stat-val--fabricator' : ''}`}>{fabricatorCount}</span>
                            <span className="lroute-stat-key">Fabricators</span>
                          </div>
                          <div className="lroute-stat lroute-stat--cost">
                            <span className="lroute-stat-chips">
                              <CostChips exotic={cost.exotic} helium={cost.helium} affordable={canAfford} />
                            </span>
                            <span className="lroute-stat-key">Cost</span>
                          </div>
                        </div>

                        {raisesDetection && (
                          <div className="lroute-warn">
                            <span className="lroute-warn-icon">△</span>
                            Dispatch raises probe attention by 1
                          </div>
                        )}

                        {stalled && (
                          <div className={`lroute-warn lroute-warn--${stalledStatus}`}>
                            <span className="lroute-warn-icon">◈</span>
                            {SLOT_STATUS_LABELS[stalledStatus]} fabricator on route
                          </div>
                        )}

                        {preview && preview.reason !== 'Ready' && (
                          <div className="lroute-warn lroute-warn--preview">
                            <span className="lroute-warn-icon">◇</span>
                            {preview.reason}
                          </div>
                        )}

                        {preview && (
                          <div className="lroute-preview">
                            Dry run - {preview.expectedBatches} ready slot{preview.expectedBatches === 1 ? '' : 's'} -{' '}
                            {Object.values(preview.expectedEdgeUse).reduce((sum, edge) => sum + edge.used, 0)} expected edge units -{' '}
                            {preview.shortages.length} shortage{preview.shortages.length === 1 ? '' : 's'} - {preview.detectionRisk} risk
                            {preview.expectedRecipes.length > 0 && <span title={preview.expectedRecipes.join(', ')}> - recipes: {preview.expectedRecipes.slice(0, 2).join(', ')}{preview.expectedRecipes.length > 2 ? '…' : ''}</span>}
                            {Object.entries(preview.expectedOutputs).slice(0, 1).map(([id, count]) => (
                              <span key={id}> - {fmt(count * 3_600_000 / AUTOMATION_POLL_MS)} {materialName(id)} / hr at {fmt(cost.exotic * 3_600_000 / AUTOMATION_POLL_MS)} exotic / hr</span>
                            ))}
                          </div>
                        )}
                      </>
                    );

                    return (
                      <div
                        key={route.id}
                        className={`lroute-card${editingId === route.id ? ' lroute-card--active' : ''}${fabricatorCount > 0 ? ' lroute-card--fabricator' : ''}`}
                        onClick={() => startEdit(route.id)}
                        onPointerEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredCard({
                            id: route.id,
                            top: Math.max(8, Math.min(rect.top, window.innerHeight - DETAIL_POP_HEIGHT)),
                            left: rect.right + 8,
                          });
                        }}
                        onPointerLeave={() => setHoveredCard((h) => (h?.id === route.id ? null : h))}
                      >
                        <div className="lroute-head">
                          <span className="lroute-name">{route.name}</span>
                          <span className={`lroute-status lroute-status--${status.key}`}>
                            <span className="lroute-status-dot" />
                            {status.label}
                          </span>
                        </div>

                        {hoveredCard?.id === route.id && createPortal(
                          <div className="lroute-detail-pop" style={{ top: hoveredCard.top, left: hoveredCard.left }}>
                            {detail}
                          </div>,
                          document.body,
                        )}

                        <div className="lroute-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="lroute-dispatch"
                            disabled={!canDispatch || !!dispatchAnim}
                            onClick={() => handleDispatch(route.id)}
                          >
                            Dispatch
                          </button>
                          <button
                            className={`lroute-auto${route.active ? ' lroute-auto--active' : ''}`}
                            disabled={!valid}
                            title={route.active ? 'Pause automation' : 'Activate automation'}
                            aria-label={route.active ? 'Pause automation' : 'Activate automation'}
                            onClick={() => handleToggleActive(route.id, !route.active)}
                          >
                            {route.active ? (
                              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                                <rect x="2.5" y="2" width="2.5" height="8" fill="currentColor" />
                                <rect x="7" y="2" width="2.5" height="8" fill="currentColor" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                                <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
                              </svg>
                            )}
                          </button>
                          <button
                            className="lroute-delete"
                            title="Delete route"
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
          </div>

          {/* ── Middle: editor ── */}
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

                  <div className="logistics-editor-body">
                    {/* Station map */}
                    <div className="logistics-map-section">
                      <div className="logistics-col-label">
                        Drag node to node to link - click a link to cut it - click a node for details
                      </div>
                      <div className="station-map-container">
                        <StationMap
                          projected={projected}
                          draftNodes={draftNodes}
                          draftEdges={draftEdges}
                          nodeStatus={nodeStatus}
                          edgeFlows={editingId ? lastRuns[editingId]?.edgeFlows : undefined}
                          heldNodeIds={new Set(Object.keys(heldByNode))}
                          islandNodes={draftIslands}
                          onAddEdge={addEdge}
                          onRemoveEdge={removeEdge}
                          canLink={canLink}
                          onNodeClick={setLastHoveredNodeId}
                          onBackgroundClick={() => setLastHoveredNodeId(null)}
                          animActiveNodeId={dispatchAnim && !dispatchAnim.done ? (dispatchAnim.orderedNodeIds[dispatchAnim.step] ?? null) : null}
                        />
                        {dispatchAnim && (
                          <div className="dispatch-anim-overlay">
                            <div className="dispatch-anim-head">
                              <span className="dispatch-anim-title">
                                {dispatchAnim.done ? 'Route Complete' : 'Drones En Route'}
                              </span>
                              <span className="dispatch-anim-step">
                                {Math.min(dispatchAnim.step + 1, dispatchAnim.orderedNodeIds.length)}/{dispatchAnim.orderedNodeIds.length}
                              </span>
                            </div>
                            <div className="dispatch-anim-lines">
                              {dispatchAnim.lines
                                .filter((l) => dispatchAnim.done || l.revealStep <= dispatchAnim.step)
                                .map((l, i) => (
                                  <div
                                    key={i}
                                    className={`dispatch-anim-line${l.isCost ? ' dispatch-anim-line--cost' : ' dispatch-anim-line--collect'}`}
                                  >
                                    <span className="dispatch-anim-sign">{l.isCost ? '−' : '+'}</span>
                                    <span className="dispatch-anim-text">{l.text.replace(/^[-+]/, '')}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                        {!dispatchAnim && editingId && (
                          <div className="dispatch-anim-overlay dispatch-anim-overlay--preview">
                            <button
                              type="button"
                              className="dispatch-anim-head dispatch-preview-toggle"
                              aria-expanded={expectedOutputOpen}
                              aria-controls="expected-route-output"
                              onClick={() => setExpectedOutputOpen((open) => !open)}
                            >
                              <span className="dispatch-anim-title">Expected Output</span>
                              <svg className={`dispatch-preview-chevron${expectedOutputOpen ? ' dispatch-preview-chevron--open' : ''}`} viewBox="0 0 10 6" aria-hidden="true">
                                <path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.4" />
                              </svg>
                            </button>
                            {expectedOutputOpen && (
                              <div id="expected-route-output" className="dispatch-anim-lines">
                                {expectedOutputLines.length > 0 ? expectedOutputLines.map((line) => (
                                  <div key={line.key} className="dispatch-anim-line dispatch-anim-line--collect">
                                    <span className="dispatch-anim-sign">+</span>
                                    <span className="dispatch-anim-text">{line.text}</span>
                                  </div>
                                )) : (
                                  <div className="dispatch-anim-empty">No output expected</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {draftIslands.length > 0 && (
                      <div className="logistics-route-error">
                        Disconnected island: {draftIslands.map(nodeName).join(', ')}. Link every node into one network.
                      </div>
                    )}

                    {draftEdges.length > 0 && (
                      <EdgePolicyPanel
                        edges={draftEdges}
                        bandwidth={bandwidth}
                        nodeName={nodeName}
                        onChange={updateDraftEdge}
                      />
                    )}

                    <div className={`logistics-policy-panel${routePolicyOpen ? ' logistics-policy-panel--open' : ''}`}>
                      <button
                        type="button"
                        className="logistics-policy-summary"
                        onClick={() => setRoutePolicyOpen((open) => !open)}
                      >
                        Route policies
                      </button>
                      {routePolicyOpen && (
                      <div className="logistics-automation-panel">
                        <label className="logistics-policy-field logistics-policy-check">
                          <input type="checkbox" checked={draftActive} onChange={(event) => setDraftActive(event.target.checked)} />
                          Activate after save
                        </label>
                        <label className="logistics-policy-field">
                          Dispatch when
                          <select value={draftAutomation.dispatchMode}
                            onChange={(event) => setDraftAutomation((policy) => ({ ...policy, dispatchMode: event.target.value as RouteDispatchMode }))}>
                            <option value="fill">Sources reach fill %</option>
                            <option value="batch">A full batch can be crafted</option>
                          </select>
                        </label>
                        {draftAutomation.dispatchMode === 'fill' && (
                          <>
                            <label className="logistics-policy-field">
                              Fill aggregation
                              <select value={draftAutomation.fillAggregate}
                                onChange={(event) => setDraftAutomation((policy) => ({ ...policy, fillAggregate: event.target.value as RouteFillAggregate }))}>
                                <option value="weighted">Demand weighted</option>
                                <option value="any">Any source</option>
                                <option value="all">All sources</option>
                              </select>
                            </label>
                            <label className="logistics-policy-field">
                              Source fill %
                              <input type="number" min="1" max="100" value={draftAutomation.sourceFillPercent}
                                onChange={(event) => setDraftAutomation((policy) => ({ ...policy, sourceFillPercent: Math.max(1, Math.min(100, Number(event.target.value))) }))} />
                            </label>
                          </>
                        )}
                        <label className="logistics-policy-field">
                          Probe attention ceiling
                          <input type="number" min="0" max={MAX_DETECTION_CEILING} value={draftAutomation.detectionCeiling}
                            onChange={(event) => setDraftAutomation((policy) => ({ ...policy, detectionCeiling: Math.max(0, Math.min(MAX_DETECTION_CEILING, Number(event.target.value))) }))} />
                        </label>
                        <label className="logistics-policy-field logistics-policy-check">
                          <input type="checkbox" checked={draftAutomation.pauseOnJam}
                            onChange={(event) => setDraftAutomation((policy) => ({ ...policy, pauseOnJam: event.target.checked }))} />
                          Pause on jam
                        </label>
                        <label className="logistics-policy-field">
                          Keep exotic
                          <input type="number" min="0" value={draftAutomation.fuelReserveExotic}
                            onChange={(event) => setDraftAutomation((policy) => ({ ...policy, fuelReserveExotic: Math.max(0, Math.floor(Number(event.target.value))) }))} />
                        </label>
                        <label className="logistics-policy-field">
                          Keep He-3
                          <input type="number" min="0" value={draftAutomation.fuelReserveHelium3}
                            onChange={(event) => setDraftAutomation((policy) => ({ ...policy, fuelReserveHelium3: Math.max(0, Math.floor(Number(event.target.value))) }))} />
                        </label>
                      </div>
                      )}
                    </div>
                  </div>

                  {/* Footer: cost + order + save */}
                  <div className="logistics-editor-footer">
                    <div className="logistics-cost-display">
                      <div className="logistics-cost-label">Route Cost</div>
                      <div className="logistics-cost-value">
                        {draftEdges.length === 0 ? (
                          <span className="logistics-cost-hint">Link at least 2 nodes</span>
                        ) : (
                          <CostChips
                            exotic={draftCost.exotic}
                            helium={draftCost.helium}
                            affordable={exoticMatter >= draftCost.exotic && helium3 >= draftCost.helium}
                          />
                        )}
                      </div>
                      <div className="logistics-bandwidth">{bandwidth} material units / edge / dispatch</div>
                    </div>
                    <div className="logistics-footer-divider" />
                    <div className="logistics-route-order">
                      <span className="logistics-cost-label">Flow</span>
                      <span className="logistics-order-chain">
                        {draftEdges.length === 0 ? (
                          <span className="logistics-order-placeholder">—</span>
                        ) : !draftChain ? (
                          <span className="logistics-order-invalid">Cycle in route</span>
                        ) : (
                          <>
                            {draftChain.slice(0, 5).map((node, i, arr) => (
                              <span key={node.nodeId} className="logistics-order-chain-item">
                                <span
                                  className="logistics-order-node"
                                  onClick={() => unlinkNode(node.nodeId)}
                                  title="Click to unlink"
                                  style={node.isFabricator
                                    ? node.isAdvanced
                                      ? { color: 'rgba(255,200,90,0.85)', borderColor: 'rgba(150,110,35,0.4)' }
                                      : { color: 'rgba(60,220,100,0.8)', borderColor: 'rgba(30,140,60,0.35)' }
                                    : undefined}
                                >
                                  <span className="logistics-order-num">{i + 1}</span>
                                  {node.name.length > 8 ? node.name.slice(0, 7) + '…' : node.name}
                                </span>
                                {(i < arr.length - 1 || draftChain.length > 5) && (
                                  <span className="logistics-order-arrow">
                                    {node.branches > 1 ? '⑂' : '→'}
                                  </span>
                                )}
                              </span>
                            ))}
                            {draftChain.length > 5 && (
                              <span className="logistics-order-overflow">+{draftChain.length - 5}</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className="logistics-save-btn"
                      disabled={!draftValid || (!editingId && !canAddRoute)}
                      onClick={handleSave}
                    >
                      Save Route
                    </button>
                  </div>
                </>
              )}
          </div>
          {/* ── Right panel ── */}
          <div className="logistics-resources-panel">
            {lastHoveredNode?.nodeType === 'colony' && lastHoveredNode.keys.map(key => <ColonyDetails key={key} colonyKey={key} />)}
            {lastHoveredNode && heldByNode[lastHoveredNode.nodeId] && (
              <HeldCargoNotice
                cargo={heldByNode[lastHoveredNode.nodeId]}
                onFlush={() => heldByNode[lastHoveredNode.nodeId].routeIds.forEach((routeId) => flushHeldCargo(routeId, lastHoveredNode.nodeId))}
              />
            )}
            {lastHoveredNode && lastHoveredNode.nodeType === 'extractor' && (
              <NodeSidebar
                node={lastHoveredNode}
                nodeEquipped={nodeEquipped}
                onClose={() => setLastHoveredNodeId(null)}
                onSlotClick={(extractorKey, slot, resourceLabel) => {
                  setRightPanel('modules');
                  setPendingEquip({ extractorKey, nodeName: lastHoveredNode.name, resourceLabel, slot });
                }}
                onUnequip={(extractorKey, slot) => { equipUpgrade(extractorKey, slot, null); saveUpgrades(); }}
                onDestroy={handleDestroyExtractor}
                shipInSystem={shipInSystem}
              />
            )}
            {lastHoveredNode && lastHoveredNode.nodeType === 'fabricator' && (
              <FabricatorSidebar
                node={lastHoveredNode}
                fabricators={fabricators}
                fabricatorStates={fabricatorStates}
                lastRun={lastFabricatorRun}
                onClose={() => setLastHoveredNodeId(null)}
                onSetTarget={handleSetSlotTarget}
                onMoveSlotOrder={handleMoveSlotOrder}
                onUnlockSlot={handleUnlockFabricatorSlot}
                onSetDrawFromHold={handleSetDrawFromHold}
                onSetFillMode={handleSetFillMode}
                onDestroy={handleDestroyFabricator}
                shipInSystem={shipInSystem}
              />
            )}
            <div className="logistics-resources-header lm-tab-header">
              <button
                className={`lm-tab-btn${rightPanel === 'resources' ? ' lm-tab-btn--active' : ''}`}
                onClick={() => { setRightPanel('resources'); setPendingEquip(null); }}
              >
                Reserves
              </button>
              <button
                className={`lm-tab-btn${rightPanel === 'materials' ? ' lm-tab-btn--active' : ''}`}
                onClick={() => { setRightPanel('materials'); setPendingEquip(null); }}
              >
                Materials
              </button>
              <button
                className={`lm-tab-btn${rightPanel === 'modules' ? ' lm-tab-btn--active' : ''}`}
                onClick={() => setRightPanel('modules')}
              >
                Modules
              </button>
            </div>

            {rightPanel === 'modules' ? (
              <InventoryPanel
                pendingEquip={pendingEquip}
                ownedUpgrades={ownedUpgrades}
                nodeEquipped={nodeEquipped}
                stockpile={stockpileMaterials}
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
            ) : rightPanel === 'materials' ? (
              <MaterialsPanel stockpile={stockpileMaterials} rares={stockpileRares} fabricatorStates={fabricatorStates} />
            ) : (
              <>
                <div className="logistics-reserves-section">
                  <div className="logistics-reserve-row">
                    <span className="logistics-resource-type" title="Exotic Matter"><ResourceIcon type="exotic" /></span>
                    <span className="logistics-resource-amount">{fmt(exoticMatter)}</span>
                  </div>
                  <div className="logistics-reserve-row">
                    <span className="logistics-resource-type" title="Helium-3"><ResourceIcon type="helium-3" /></span>
                    <span className="logistics-resource-amount">{fmt(helium3)}</span>
                  </div>
                </div>
                <div className="logistics-resources-list">
                  {allExtractors.length === 0 ? (
                    <div className="logistics-resources-empty">No stations</div>
                  ) : (
                    <Section title="Accumulated" count={`${systemGroups.length}`} defaultOpen>
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
                                    <span className="logistics-resource-type" title={RESOURCE_LABELS[ext.resourceType]}><ResourceIcon type={ext.resourceType} /></span>
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
                    </Section>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Fabricator sidebar ────────────────────────────────────────────────────────────

function EdgePolicyPanel({
  edges, bandwidth, nodeName, onChange,
}: {
  edges: RouteEdge[];
  bandwidth: number;
  nodeName: (nodeId: string) => string;
  onChange: (index: number, patch: Partial<RouteEdge>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = <T extends string,>(current: T[] | undefined, all: T[], value: T): T[] => {
    const selected = new Set(current ?? all);
    if (selected.has(value)) selected.delete(value); else selected.add(value);
    return all.filter((item) => selected.has(item));
  };
  return (
    <div className={`logistics-policy-panel logistics-edge-policies${open ? ' logistics-policy-panel--open' : ''}`}>
      <button type="button" className="logistics-policy-summary" onClick={() => setOpen((prev) => !prev)}>
        <span>Edge policies</span>
        <span className="logistics-policy-summary-meta">{edges.length} edge{edges.length === 1 ? '' : 's'} - last-run flow on map</span>
      </button>
      {open && (
      <div className="logistics-edge-policies-content">
        {edges.map((edge, index) => (
          <details key={edgeKey(edge)} className="logistics-edge-policy">
            <summary>{nodeName(edge.from)} → {nodeName(edge.to)}</summary>
            <div className="logistics-policy-grid">
              <label className="logistics-policy-field">Material draw
                <input type="number" min="0" max={bandwidth} value={edge.materialDraw ?? bandwidth}
                  onChange={(event) => {
                    const capped = Math.max(0, Math.min(bandwidth, Number(event.target.value)));
                    onChange(index, { materialDraw: capped >= bandwidth ? undefined : capped });
                  }} />
              </label>
              <label className="logistics-policy-field">Surplus
                <select value={edge.overflow ?? 'stockpile'} onChange={(event) => onChange(index, { overflow: event.target.value as RouteEdge['overflow'] })}>
                  <option value="stockpile">Send to ship</option>
                  <option value="hold">Hold here</option>
                </select>
              </label>
            </div>
            <div className="logistics-policy-note">
              Material draw limits units per dispatch, including how much stockpile a fabricator downstream may pull.
            </div>
            <div className="logistics-filter-head">Raw cargo <button onClick={() => onChange(index, { allowedRaw: undefined })}>Demand default</button></div>
            <div className="logistics-filter-grid">
              {RAW_TYPES.map((type) => (
                <label key={type} className="logistics-filter-item">
                  <input type="checkbox" checked={edge.allowedRaw?.includes(type) ?? true}
                    onChange={() => onChange(index, { allowedRaw: toggle(edge.allowedRaw, RAW_TYPES, type) })} />
                  <span>{RESOURCE_LABELS[type]}</span>
                </label>
              ))}
            </div>
            <div className="logistics-filter-head">Materials</div>
            <details className="logistics-material-select">
              <summary>
                {edge.allowedMaterials === undefined
                  ? 'Demand default'
                  : `${edge.allowedMaterials.length} of ${ROUTABLE_MATERIALS.length} selected`}
              </summary>
              <div className="logistics-material-menu">
                <div className="logistics-material-menu-actions">
                  <button type="button" onClick={() => onChange(index, { allowedMaterials: undefined })}>Demand default</button>
                  <button type="button" onClick={() => onChange(index, { allowedMaterials: [...ROUTABLE_MATERIALS] })}>Select all</button>
                  <button type="button" onClick={() => onChange(index, { allowedMaterials: [] })}>Clear</button>
                </div>
                <div className="logistics-filter-grid logistics-filter-grid--materials">
                  {ROUTABLE_MATERIALS.map((id) => (
                    <label key={id} className="logistics-filter-item">
                      <input type="checkbox" checked={edge.allowedMaterials?.includes(id) ?? true}
                        onChange={() => onChange(index, { allowedMaterials: toggle(edge.allowedMaterials, ROUTABLE_MATERIALS, id) })} />
                      <span>{materialName(id)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </details>
        ))}
      </div>
      )}
    </div>
  );
}

function materialCostEntries(materials: MaterialCost): Array<[string, number]> {
  return Object.entries(materials).filter(([, amt]) => !!amt) as Array<[string, number]>;
}

type SlotMenuState = { fabricatorKey: string; slotIdx: number; rect: DOMRect; advanced: boolean };

function SlotPickerMenu({
  state,
  onPick,
  onClose,
}: {
  state: SlotMenuState;
  onPick: (upgradeId: string | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const stockpile = useStockpileStore((s) => s.materials);
  const { bind, node } = useHoverTip();

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const MENU_W = 300;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - state.rect.bottom;
  const spaceAbove = state.rect.top;
  const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
  const left = Math.min(Math.max(state.rect.left, MARGIN), window.innerWidth - MENU_W - MARGIN);
  const style: React.CSSProperties = openUp
    ? { left, bottom: window.innerHeight - state.rect.top + 6, maxHeight: spaceAbove - MARGIN * 2 }
    : { left, top: state.rect.bottom + 6, maxHeight: spaceBelow - MARGIN * 2 };

  function renderRow(recipe: Craftable, desc: string) {
    const mats = materialCostEntries(recipe.materials);
    const short = mats.some(([id, amt]) => (stockpile[id] ?? 0) < amt);
    return (
      <button
        key={recipe.id}
        className="lm-slot-menu-row"
        onClick={() => onPick(recipe.id)}
        {...bind(recipeTip(recipe, desc, stockpile))}
      >
        <UpgradeModuleIcon size={16} />
        <span className="lm-slot-menu-row-name">{recipe.name}</span>
        {short && <span className="lm-slot-menu-row-short">short</span>}
        <span className="lm-slot-menu-row-time">instant</span>
      </button>
    );
  }

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="lm-slot-menu"
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lm-slot-menu-row lm-slot-menu-row--none" onClick={() => onPick(null)}>
          — None —
        </button>
        {MATERIAL_TIERS.filter(tier => tier < 4 || state.advanced).map((tier) => (
          <Section
            key={tier}
            title={`${MATERIAL_TIER_LABELS[tier] ?? `Tier ${tier}`} Materials`}
            defaultOpen={tier === MATERIAL_TIERS[0]}
          >
            {CRAFTABLE_MATERIALS.filter((m) => m.tier === tier).map((m) => {
              const recipe = getCraftable(m.id);
              return recipe ? renderRow(recipe, m.desc) : null;
            })}
          </Section>
        ))}
        <Section title="Extractor Modules">
          {EXTRACTOR_UPGRADES.map((u) => {
            const recipe = getCraftable(u.id);
            return recipe ? renderRow(recipe, describeUpgradeEffect(u.effect)) : null;
          })}
        </Section>
        {state.advanced && RARE_ROLES.map((role) => (
          <Section key={role} title={`${RARE_ROLE_LABELS[role] ?? role} Assemblies`}>
            {RARE_RESOURCES.filter((r) => r.role === role).map((r) => {
              const recipe = getCraftable(r.id);
              return recipe ? renderRow(recipe, r.desc) : null;
            })}
          </Section>
        ))}
      </div>
      {node}
    </>,
    document.body,
  );
}

function SlotView({
  slot,
  slotIdx,
  fabricatorKey,
  advanced,
  depth,
  isMenuOpen,
  onOpenMenu,
  ordering,
  lastResult,
}: {
  slot: FabricatorProductionSlot;
  slotIdx: number;
  fabricatorKey: string;
  advanced: boolean;
  depth: number;
  isMenuOpen: boolean;
  onOpenMenu: (state: SlotMenuState) => void;
  ordering?: { order: number; total: number; moveEarlier?: () => void; moveLater?: () => void };
  lastResult?: SlotRunResult;
}) {
  const stockpile = useStockpileStore((s) => s.materials);
  const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
  const status = lastResult?.status ?? slotStatus(slot, recipe, depth);

  return (
    <div className="lm-fabricator-slot-block">
      <div className="lm-fabricator-slot-head">
        <span className="lm-fabricator-slot-label">
          {ordering && <span className="lm-slot-order-badge">{ordering.order}</span>}
          Slot {slotIdx + 1}
        </span>
        {(ordering?.moveEarlier || ordering?.moveLater) && (
          <span className="lm-slot-priority-controls">
            <button disabled={!ordering.moveEarlier} onClick={ordering.moveEarlier} title="Run earlier">↑</button>
            <button disabled={!ordering.moveLater} onClick={ordering.moveLater} title="Run later">↓</button>
          </span>
        )}
        {recipe && (
          <span className={`lm-slot-status lm-slot-status--${status}`}>{SLOT_STATUS_LABELS[status]}</span>
        )}
      </div>
      <button
        className={`lm-fabricator-slot-btn${slot.targetUpgradeId ? ' lm-fabricator-slot-btn--filled' : ''}${isMenuOpen ? ' lm-fabricator-slot-btn--open' : ''}`}
        onClick={(e) => onOpenMenu({ fabricatorKey, slotIdx, rect: e.currentTarget.getBoundingClientRect(), advanced })}
      >
        {slot.targetUpgradeId ? (
          <>
            <UpgradeModuleIcon size={28} />
            <span className="lm-fabricator-slot-btn-name">{recipe?.name ?? slot.targetUpgradeId}</span>
          </>
        ) : (
          <span className="lm-fabricator-slot-btn-label">Choose target —</span>
        )}
      </button>
      {recipe && (
        <div className="lm-fabricator-recipe">
          {Object.entries(recipe.cost).map(([costKey, costAmt]) => {
            if (!costAmt) return null;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) return null;
            const cap = costAmt * depth;
            const have = slot.pendingResources[resourceType] ?? 0;
            const pct = Math.min(100, (have / cap) * 100);
            return (
              <div key={costKey} className="lm-fabricator-recipe-row">
                <span className="lm-fabricator-recipe-label">{RESOURCE_LABELS[resourceType]}</span>
                <div className="lm-fabricator-progress-track">
                  <div className="lm-fabricator-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className={`lm-fabricator-recipe-val${have < costAmt ? ' lm-fabricator-recipe-val--short' : ''}`}>
                  {fmt(have)}/{fmt(cap)}
                </span>
              </div>
            );
          })}
          {materialCostEntries(recipe.materials).map(([matId, costAmt]) => {
            const cap = costAmt * depth;
            const have = slot.pendingMaterials[matId] ?? 0;
            const pct = Math.min(100, (have / cap) * 100);
            const held = stockpile[matId] ?? 0;
            return (
              <div key={matId} className="lm-fabricator-recipe-row lm-fabricator-recipe-row--mat">
                <span className="lm-fabricator-recipe-label">{materialName(matId)}</span>
                <div className="lm-fabricator-progress-track">
                  <div className="lm-fabricator-progress-fill lm-fabricator-progress-fill--mat" style={{ width: `${pct}%` }} />
                </div>
                <span className={`lm-fabricator-recipe-val${have < costAmt && held === 0 ? ' lm-fabricator-recipe-val--short' : ''}`}>
                  {have}/{cap}
                </span>
              </div>
            );
          })}
          <div className="lm-fabricator-slot-meters">
            {ordering && ordering.total > 1 && (
              <span className="lm-fabricator-meter">
                Runs {ordering.order} of {ordering.total}
              </span>
            )}
            <span className="lm-fabricator-meter">
              Processes on dispatch
            </span>
          </div>
          {lastResult && (
            <div className="lm-slot-last-run">
              Last run: {lastResult.batches} batch{lastResult.batches === 1 ? '' : 'es'}
              {Object.keys(lastResult.missingResources).length + Object.keys(lastResult.missingMaterials).length > 0
                ? ` - missing ${[
                    ...Object.entries(lastResult.missingResources).map(([id, amount]) => `${amount} ${RESOURCE_LABELS[id as Resource['type']] ?? id}`),
                    ...Object.entries(lastResult.missingMaterials).map(([id, amount]) => `${amount} ${materialName(id)}`),
                  ].join(', ')}`
                : ''}
            </div>
          )}
          {materialCostEntries(recipe.byproducts).map(([matId, amt]) => {
            const have = slot.byproducts[matId] ?? 0;
            const cap = amt * depth;
            return (
              <div key={matId} className="lm-fabricator-recipe-row lm-fabricator-recipe-row--byproduct">
                <span className="lm-fabricator-recipe-label">{materialName(matId)}</span>
                <div className="lm-fabricator-progress-track">
                  <div
                    className="lm-fabricator-progress-fill lm-fabricator-progress-fill--byproduct"
                    style={{ width: `${Math.min(100, (have / cap) * 100)}%` }}
                  />
                </div>
                <span className={`lm-fabricator-recipe-val${have >= cap ? ' lm-fabricator-recipe-val--short' : ''}`}>
                  {have}/{cap}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeHoldFeed(result: FeedResult): string {
  const parts: string[] = [];
  for (const [type, amount] of Object.entries(result.consumed)) {
    if ((amount ?? 0) > 0) parts.push(`${fmt(amount ?? 0)} ${RESOURCE_LABELS[type as Resource['type']] ?? type}`);
  }
  for (const [id, amount] of Object.entries(result.consumedStockpile)) {
    if (amount > 0) parts.push(`${amount} ${materialName(id)}`);
  }
  const batches = result.slotResults.reduce((sum, entry) => sum + entry.batches, 0);
  const head = parts.length > 0 ? parts.join(', ') : 'buffers unchanged';
  return batches > 0 ? `${head} - ${batches} batch${batches === 1 ? '' : 'es'}` : head;
}

function FabricatorSlotList({
  fabricatorKey,
  slots,
  advanced,
  depth,
  openSlot,
  onOpenMenu,
  onMoveSlotOrder,
  lastRun,
}: {
  fabricatorKey: string;
  slots: FabricatorProductionSlot[];
  advanced: boolean;
  depth: number;
  openSlot: SlotMenuState | null;
  onOpenMenu: (state: SlotMenuState) => void;
  onMoveSlotOrder: (key: string, slotIdx: number, direction: -1 | 1) => void;
  lastRun?: Record<number, SlotRunResult>;
}) {
  const ordered = useMemo(() => orderedSlotIndices(slots).map((index) => ({ slot: slots[index], index })), [slots]);
  const configured = ordered.filter(({ slot }) => slot.targetUpgradeId);
  const empty = ordered.filter(({ slot }) => !slot.targetUpgradeId);

  const renderSlot = ({ slot, index }: { slot: FabricatorProductionSlot; index: number }, order: number | null) => (
    <SlotView
      key={index}
      slot={slot}
      slotIdx={index}
      fabricatorKey={fabricatorKey}
      advanced={advanced}
      depth={depth}
      isMenuOpen={openSlot?.fabricatorKey === fabricatorKey && openSlot.slotIdx === index}
      onOpenMenu={onOpenMenu}
      ordering={order === null ? undefined : {
        order,
        total: configured.length,
        moveEarlier: order > 1 ? () => onMoveSlotOrder(fabricatorKey, index, -1) : undefined,
        moveLater: order < configured.length ? () => onMoveSlotOrder(fabricatorKey, index, 1) : undefined,
      }}
      lastResult={lastRun?.[index]}
    />
  );

  return (
    <>
      {configured.length > 1 && (
        <div className="lm-fabricator-order-note">Dispatch order - top runs first</div>
      )}
      {configured.map((entry, rank) => renderSlot(entry, rank + 1))}
      {empty.length > 0 && configured.length > 0 && (
        <div className="lm-fabricator-order-note">Unconfigured</div>
      )}
      {empty.map((entry) => renderSlot(entry, null))}
    </>
  );
}

function FabricatorSidebar({
  node,
  fabricators,
  fabricatorStates,
  lastRun,
  onClose,
  onSetTarget,
  onMoveSlotOrder,
  onUnlockSlot,
  onSetDrawFromHold,
  onSetFillMode,
  onDestroy,
  shipInSystem,
}: {
  node: ProjectedMapNode;
  fabricators: Record<string, Fabricator>;
  fabricatorStates: Record<string, FabricatorState>;
  lastRun: Record<string, SlotRunResult[]>;
  onClose: () => void;
  onSetTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  onMoveSlotOrder: (key: string, slotIdx: number, direction: -1 | 1) => void;
  onUnlockSlot: (key: string) => void;
  onSetDrawFromHold: (key: string, enabled: boolean) => void;
  onSetFillMode: (key: string, mode: SlotFillMode) => void;
  onDestroy: (key: string) => void;
  shipInSystem: (located: { systemId: number; galaxySeed: number } | undefined) => boolean;
}) {
  const [openSlot, setOpenSlot] = useState<SlotMenuState | null>(null);
  const stockpile = useStockpileStore((s) => s.materials);
  const holdSource = useUIStore(useShallow((s) => ({
    exoticMatter: s.exoticMatter,
    helium3Reserves: s.helium3Reserves,
    alloys: s.alloys,
    nutrients: s.nutrients,
    metallicHydrogen: s.metallicHydrogen,
    neutronStarMatter: s.neutronStarMatter,
    alienMatter: s.alienMatter,
    logisticsA: s.logisticsA,
    logisticsB: s.logisticsB,
  })));
  const holdKeySig = node.keys.filter((k) => fabricators[k]?.drawFromHold).join('|');
  const holdPreviews = useMemo(() => {
    const previews: Record<string, FeedResult> = {};
    if (!holdKeySig) return previews;
    const pools = holdFeedPools(holdSource, stockpile);
    for (const key of holdKeySig.split('|')) {
      previews[key] = previewHoldFeed(
        fabricatorStates[key], fabricators[key]?.tier, pools, fabricators[key]?.fillMode,
      );
    }
    return previews;
  }, [holdKeySig, fabricators, fabricatorStates, stockpile, holdSource]);

  return (
    <div className="lm-submodal">
      <div className="lm-submodal-header">
        <span className="lm-submodal-title">{node.name}</span>
        <button className="lm-submodal-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="lm-fabricator-title-label">Fabrication</div>
      {node.keys.map((k) => {
        const fabricator = fabricators[k];
        const cs = fabricatorStates[k] ?? { slots: [makeEmptyFabricatorSlot()] };
        const depth = bufferDepth(fabricator?.tier);
        const slotCount = cs.slots.length;
        const canUnlock = slotCount < maxFabricatorSlots(fabricator?.tier);
        return (
          <div key={k} className="lm-fabricator-entry">
            {fabricator && (
              <div className="lm-fabricator-planet-name">
                {node.keys.length > 1 ? `${fabricator.planetName} - ` : ''}
                {FABRICATOR_TIER_LABELS[fabricator.tier]} - {depth}× buffers
              </div>
            )}
            <FabricatorSlotList
              fabricatorKey={k}
              slots={cs.slots}
              advanced={(fabricator?.tier ?? 1) >= 2}
              depth={depth}
              openSlot={openSlot}
              onOpenMenu={setOpenSlot}
              onMoveSlotOrder={onMoveSlotOrder}
              lastRun={lastRun[k]}
            />
            <div className="lm-fabricator-fill-mode">
              <span className="lm-fabricator-fill-label">Input split</span>
              {(['priority', 'shared'] as SlotFillMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`lm-fill-mode-btn${(fabricator?.fillMode ?? 'shared') === mode ? ' lm-fill-mode-btn--active' : ''}`}
                  onClick={() => onSetFillMode(k, mode)}
                  title={mode === 'priority'
                    ? 'Each slot fills its whole buffer before the next one draws'
                    : 'Slots take one batch at a time in order, so scarce inputs spread across them'}
                >
                  {SLOT_FILL_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <label className="lm-fabricator-hold-toggle">
              <input
                type="checkbox"
                checked={fabricator?.drawFromHold ?? false}
                onChange={(event) => onSetDrawFromHold(k, event.target.checked)}
              />
              Draw from Hold
            </label>
            <div className="lm-fabricator-load-note">
              {fabricator?.drawFromHold
                ? holdPreviews[k]?.changed
                  ? `Next draw: ${describeHoldFeed(holdPreviews[k])}`
                  : 'Hold has nothing these slots need'
                : 'Slots run on route dispatch only'}
            </div>
            {canUnlock && (
              <button
                className="lm-fabricator-unlock-btn"
                onClick={() => onUnlockSlot(k)}
                title="Free configuration slot"
              >
                + Configure Slot {slotCount + 1} - Free
              </button>
            )}
            <button
              className="lm-fabricator-destroy-btn"
              disabled={shipInSystem(fabricator)}
              onClick={() => {
                if (window.confirm('Destroy this fabricator? All pending inputs, materials and byproducts are lost.')) onDestroy(k);
              }}
              title={shipInSystem(fabricator)
                ? 'The Peregrine must leave this system before remote demolition'
                : 'Destroy this fabricator remotely - no resources are recovered'}
            >
              Destroy - No Refund
            </button>
          </div>
        );
      })}
      {openSlot && (
        <SlotPickerMenu
          state={openSlot}
          onPick={(id) => {
            onSetTarget(openSlot.fabricatorKey, openSlot.slotIdx, id);
            setOpenSlot(null);
          }}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </div>
  );
}

// ── Node sidebar ──────────────────────────────────────────────────────────────

function HeldCargoNotice({
  cargo,
  onFlush,
}: {
  cargo: { raw: Partial<Record<Resource['type'], number>>; materials: MaterialCost };
  onFlush: () => void;
}) {
  const entries = [
    ...Object.entries(cargo.raw).filter(([, amount]) => (amount ?? 0) > 0)
      .map(([type, amount]) => `${fmt(amount ?? 0)} ${RESOURCE_LABELS[type as Resource['type']]}`),
    ...Object.entries(cargo.materials).filter(([, amount]) => amount > 0)
      .map(([id, amount]) => `${fmt(amount)} ${materialName(id)}`),
  ];
  return (
    <div className="lm-held-cargo">
      <div className="lm-held-cargo-title">Stranded route cargo</div>
      <div>{entries.join(' - ')}</div>
      <button type="button" onClick={onFlush}>Flush to ship</button>
    </div>
  );
}

function NodeSidebar({
  node,
  nodeEquipped,
  onClose,
  onSlotClick,
  onUnequip,
  onDestroy,
  shipInSystem,
}: {
  node: ProjectedMapNode;
  nodeEquipped: Record<string, [string | null, string | null]>;
  onClose: () => void;
  onSlotClick: (extractorKey: string, slot: 0 | 1, resourceLabel: string) => void;
  onUnequip: (extractorKey: string, slot: 0 | 1) => void;
  onDestroy: (extractorKey: string) => void;
  shipInSystem: (located: { systemId: number; galaxySeed: number } | undefined) => boolean;
}) {
  const resources = node.resources ?? [];
  const totalRate = resources.reduce((s, r) => s + r.rate, 0);
  const [slotTooltip, setSlotTooltip] = useState<{ upg: typeof EXTRACTOR_UPGRADES[number]; x: number; y: number } | null>(null);
  const extractors = useExtractorStore((s) => s.extractors);
  const setExtractorReserve = useExtractorStore((s) => s.setExtractorReserve);
  const uid = useAuthStore((s) => s.user?.uid);

  return (
    <div className="lm-submodal">
      <div className="lm-submodal-header">
        <span className="lm-submodal-title">{node.name}</span>
        <button className="lm-submodal-close" onClick={onClose} title="Close">✕</button>
      </div>
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
            <label className="lm-submodal-reserve">
              <span>Leave in ground</span>
              <input
                type="number"
                min="0"
                value={extractors[extractorKey]?.reserve ?? 0}
                onChange={(event) => {
                  const reserve = Math.max(0, Math.floor(Number(event.target.value)));
                  setExtractorReserve(extractorKey, reserve);
                  if (uid) updateExtractorReserve(uid, extractorKey, reserve);
                }}
              />
            </label>
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
            <button
              className="lm-fabricator-destroy-btn"
              disabled={shipInSystem(extractors[extractorKey])}
              onClick={() => {
                if (window.confirm('Destroy this extractor? Nothing is refunded.')) onDestroy(extractorKey);
              }}
              title={shipInSystem(extractors[extractorKey])
                ? 'The Peregrine must leave this system before remote demolition'
                : 'Destroy this extractor remotely - no resources are recovered'}
            >
              Destroy - No Refund
            </button>
          </div>
        );
      })}
      {slotTooltip && createPortal(
        <div className="lm-slot-tooltip" style={{ left: slotTooltip.x, top: slotTooltip.y }}>
          <div className="lm-slot-tooltip-name">{slotTooltip.upg.name}</div>
          <div className="lm-slot-tooltip-desc">{describeUpgradeEffect(slotTooltip.upg.effect)}</div>
          <div className="lm-slot-tooltip-hint">Click to unequip</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Hover tooltip ──────────────────────────────────────────────────────────────

type TipRow = { label: string; value: string; short?: boolean };
type TipContent = { title: string; time?: string; desc?: string; rows: TipRow[]; note?: string };

const TIP_W = 300;

function useHoverTip() {
  const [tip, setTip] = useState<{ content: TipContent; x: number; y: number } | null>(null);

  const bind = useCallback((content: TipContent) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = Math.max(8, Math.min(r.left - TIP_W - 12, window.innerWidth - TIP_W - 8));
      const y = Math.max(8, Math.min(r.top - 4, window.innerHeight - 250));
      setTip({ content, x, y });
    },
    onMouseLeave: () => setTip(null),
  }), []);

  const node = tip
    ? createPortal(
        <div className="lm-tip" style={{ left: tip.x, top: tip.y, width: TIP_W }}>
          <div className="lm-tip-head">
            <span className="lm-tip-title">{tip.content.title}</span>
            {tip.content.time && <span className="lm-tip-time">{tip.content.time}</span>}
          </div>
          {tip.content.desc && <div className="lm-tip-desc">{tip.content.desc}</div>}
          {tip.content.rows.length > 0 && (
            <div className="lm-tip-rows">
              <div className="lm-tip-rows-label">Inputs</div>
              {tip.content.rows.map((r) => (
                <div key={r.label} className="lm-tip-row">
                  <span className="lm-tip-row-label">{r.label}</span>
                  <span className={`lm-tip-row-val${r.short ? ' lm-tip-row-val--short' : ''}`}>{r.value}</span>
                </div>
              ))}
            </div>
          )}
          {tip.content.note && <div className="lm-tip-note">{tip.content.note}</div>}
        </div>,
        document.body,
      )
    : null;

  return { bind, node };
}

function recipeTip(
  recipe: Craftable | undefined,
  desc: string,
  stockpile: Record<string, number>,
  note?: string,
  fallbackTitle = '',
): TipContent {
  if (!recipe) return { title: fallbackTitle, desc, rows: [], note: 'Recovered as a byproduct only.' };
  const rows: TipRow[] = [];
  for (const [costKey, amt] of Object.entries(recipe.cost)) {
    if (!amt) continue;
    rows.push({
      label: RESOURCE_LABELS[COST_KEY_TO_RESOURCE[costKey]] ?? costKey,
      value: fmt(amt),
    });
  }
  for (const [id, amt] of materialCostEntries(recipe.materials)) {
    const held = stockpile[id] ?? 0;
    rows.push({ label: materialName(id), value: `${amt}  (${held} held)`, short: held < amt });
  }
  const yields: string[] = [];
  if (recipe.outputs > 1) yields.push(`yields ${recipe.outputs}× ${materialName(recipe.produces)}`);
  for (const [id, amt] of materialCostEntries(recipe.byproducts)) {
    yields.push(`leaves ${amt}× ${materialName(id)}`);
  }
  const notes = [yields.join(' - '), note].filter(Boolean).join(' — ');
  return {
    title: recipe.name,
    time: 'Instant on dispatch',
    desc,
    rows,
    note: notes || undefined,
  };
}

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="lm-section">
      <button
        className={`lm-section-head${open ? ' lm-section-head--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lm-section-chevron">{open ? '▾' : '▸'}</span>
        <span className="lm-section-title">{title}</span>
        {count !== undefined && <span className="lm-section-count">{count}</span>}
      </button>
      {open && <div className="lm-section-body">{children}</div>}
    </div>
  );
}

// ── Modules panel ──────────────────────────────────────────────────────────────

const UPG_TYPE_LABELS: Record<string, string> = {
  rate: 'Extraction Rate',
  storage: 'Hold Capacity',
  detection: 'Signal Masking',
};

function InventoryPanel({
  pendingEquip,
  ownedUpgrades,
  nodeEquipped,
  stockpile,
  onEquip,
  onUnequip,
}: {
  pendingEquip: { extractorKey: string; nodeName: string; resourceLabel: string; slot: 0 | 1 } | null;
  ownedUpgrades: string[];
  nodeEquipped: Record<string, [string | null, string | null]>;
  stockpile: Record<string, number>;
  onEquip: (id: string) => void;
  onUnequip: (slot: 0 | 1) => void;
}) {
  const { bind, node } = useHoverTip();

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

  const groups = ['rate', 'storage', 'detection'] as const;

  return (
    <>
      {pendingEquip && (
        <div className="lm-inventory-context">
          {pendingEquip.nodeName} - {pendingEquip.resourceLabel} - Slot {pendingEquip.slot + 1}
        </div>
      )}
      <div className="lm-inventory-list">
        {groups.map((group) => {
          const items = EXTRACTOR_UPGRADES.filter((u) => u.effect.upgType === group);
          if (items.length === 0) return null;
          const ownedInGroup = items.reduce((n, u) => n + ownedCount(u.id), 0);
          return (
            <Section
              key={group}
              title={UPG_TYPE_LABELS[group] ?? group}
              count={`${ownedInGroup}`}
              defaultOpen={!!pendingEquip || ownedInGroup > 0}
            >
              {items.map((upg) => {
                const owned = ownedCount(upg.id);
                const equipped = totalEquipped(upg.id);
                const inThisSlot = pendingEquip
                  ? (nodeEquipped[pendingEquip.extractorKey] ?? [null, null])[pendingEquip.slot] === upg.id
                  : false;
                const canEquipHere = pendingEquip && !inThisSlot && owned > equippedElsewhereCount(upg.id);

                let actionLabel = '';
                let actionClass = 'lm-row-action';
                let action: (() => void) | null = null;
                if (pendingEquip) {
                  if (inThisSlot) {
                    actionLabel = 'Remove';
                    actionClass += ' lm-row-action--remove';
                    action = () => onUnequip(pendingEquip.slot);
                  } else if (canEquipHere) {
                    actionLabel = 'Equip';
                    action = () => onEquip(upg.id);
                  } else {
                    actionLabel = owned > 0 ? 'In use' : '—';
                    actionClass += ' lm-row-action--off';
                  }
                }

                const note = equipped > 0 ? `${equipped} equipped across the network` : undefined;
                return (
                  <div
                    key={upg.id}
                    className={`lm-row${owned > 0 ? ' lm-row--held' : ''}`}
                    {...bind(recipeTip(getCraftable(upg.id), UPG_TYPE_LABELS[group] ?? group, stockpile, note))}
                  >
                    <UpgradeModuleIcon size={14} />
                    <span className="lm-row-name">{upg.name}</span>
                    <span className="lm-row-badge">
                      {upg.effect.upgType === 'detection' ? '½ risk' : `${upg.effect.multiplier}x`}
                    </span>
                    {pendingEquip ? (
                      <button className={actionClass} disabled={!action} onClick={action ?? undefined}>
                        {actionLabel}
                      </button>
                    ) : (
                      <span className={`lm-row-count${owned > 0 ? ' lm-row-count--held' : ''}`}>{owned}</span>
                    )}
                  </div>
                );
              })}
            </Section>
          );
        })}
      </div>
      {node}
    </>
  );
}

// ── Materials panel ────────────────────────────────────────────────────────────

function MaterialsPanel({
  stockpile,
  rares,
  fabricatorStates,
}: {
  stockpile: Record<string, number>;
  rares: Record<string, number>;
  fabricatorStates: Record<string, FabricatorState>;
}) {
  const { bind, node } = useHoverTip();

  const assigned = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cs of Object.values(fabricatorStates)) {
      for (const slot of cs.slots) {
        if (!slot.targetUpgradeId) continue;
        const id = getCraftable(slot.targetUpgradeId)?.produces ?? slot.targetUpgradeId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [fabricatorStates]);

  const total = Object.values(stockpile).reduce((a, b) => a + b, 0);
  const rareTotal = Object.values(rares).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="lm-inventory-context">
        Stockpile - {total} held{rareTotal > 0 ? ` - ${rareTotal} rare` : ''}
      </div>
      <div className="lm-inventory-list">
        {MATERIAL_TIERS.map((tier) => {
          const items = STOCKED_MATERIALS.filter((m) => m.tier === tier);
          const heldInTier = items.reduce((n, m) => n + (stockpile[m.id] ?? 0), 0);
          return (
            <Section
              key={tier}
              title={MATERIAL_TIER_LABELS[tier] ?? `Tier ${tier}`}
              count={`${heldInTier}`}
              defaultOpen={tier === MATERIAL_TIERS[0] || heldInTier > 0}
            >
              {items.map((m) => {
                const held = stockpile[m.id] ?? 0;
                const lines = assigned[m.id] ?? 0;
                const note = lines > 0 ? `${lines} fabricator line${lines !== 1 ? 's' : ''} assigned` : undefined;
                return (
                  <div
                    key={m.id}
                    className={`lm-row${held > 0 ? ' lm-row--held' : ''}`}
                    {...bind(recipeTip(getCraftable(m.id), m.desc, stockpile, note, m.name))}
                  >
                    <span className="lm-row-name">{m.name}</span>
                    {lines > 0 && <span className="lm-row-badge lm-row-badge--live">{lines}</span>}
                    <span className={`lm-row-count${held > 0 ? ' lm-row-count--held' : ''}`}>{held}</span>
                  </div>
                );
              })}
            </Section>
          );
        })}
        {RARE_ROLES.map((role) => {
          const items = RARE_RESOURCES.filter((r) => r.role === role);
          const heldInRole = items.reduce((n, r) => n + (rares[r.id] ?? 0), 0);
          return (
            <Section
              key={role}
              title={`${RARE_ROLE_LABELS[role] ?? role} Assemblies`}
              count={`${heldInRole}`}
              defaultOpen={heldInRole > 0}
            >
              {items.map((r) => {
                const held = rares[r.id] ?? 0;
                const lines = assigned[r.id] ?? 0;
                const note = lines > 0 ? `${lines} fabricator line${lines !== 1 ? 's' : ''} assigned` : undefined;
                return (
                  <div
                    key={r.id}
                    className={`lm-row lm-row--rare${held > 0 ? ' lm-row--held' : ''}`}
                    {...bind(recipeTip(getCraftable(r.id), r.desc, stockpile, note))}
                  >
                    <span className="lm-row-name">{r.name}</span>
                    {lines > 0 && <span className="lm-row-badge lm-row-badge--live">{lines}</span>}
                    <span className={`lm-row-count${held > 0 ? ' lm-row-count--held' : ''}`}>{held}</span>
                  </div>
                );
              })}
            </Section>
          );
        })}
      </div>
      {node}
    </>
  );
}
