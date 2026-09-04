import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLogisticsStore, computeRouteCost, willRaiseDetection, canFeedFabricatorMaterials } from '../store/logisticsStore';
import { useExtractorStore, peekAccumulated } from '../store/extractorStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { RESOURCE_LABELS, COST_KEY_TO_RESOURCE, MATERIAL_TIER_LABELS, RARE_ROLE_LABELS, FABRICATOR_TIER_LABELS } from '../game/types';
import { EXTRACTOR_UPGRADES, getCraftable } from '../data/upgrades';
import type { Craftable } from '../data/upgrades';
import { CRAFT_MATERIALS, MATERIAL_TIERS, materialName } from '../data/materials';
import { RARE_RESOURCES, RARE_ROLES } from '../data/rareResources';
import { useStockpileStore } from '../store/stockpileStore';
import { UpgradeModuleIcon } from './CargoIcons';
import type { Extractor, Fabricator, FabricatorState, FabricatorProductionSlot, MaterialCost } from '../game/types';
import { MAX_FABRICATOR_SLOTS, FABRICATOR_SLOT_COSTS } from '../game/types';
import { saveLogisticsRoute, deleteLogisticsRoute } from '../firebase/logisticsRoutes';
import { updateExtractorCollected } from '../firebase/extractors';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveFabricatorState } from '../firebase/fabricators';
import { saveStockpile } from '../firebase/stockpile';
import { fmt } from './strings';
import { StationMap } from './LogisticsMap';
import { getSystemKey, getSystemName, projectNodes } from './logisticsProject';
import type { ProjectedMapNode } from './logisticsProject';
import { useNow } from './useNow';
import './LogisticsModal.css';

type AnimLine = { text: string; isCost: boolean; revealStep: number };
type DispatchAnim = {
  orderedNodeIds: string[];
  step: number;
  lines: AnimLine[];
  done: boolean;
};

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

type DraftNode = { nodeId: string; name: string; keys: string[]; isFabricator: boolean; isAdvanced: boolean };

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
  const equipUpgrade = useExtractorStore((s) => s.equipUpgrade);
  const claimPendingUpgrade = useExtractorStore((s) => s.claimPendingUpgrade);
  const stockpileMaterials = useStockpileStore((s) => s.materials);
  const stockpileRares = useStockpileStore((s) => s.rares);
  const fabricators = useFabricatorStore((s) => s.fabricators);
  const fabricatorStates = useFabricatorStore((s) => s.fabricatorStates);
  const setSlotTarget = useFabricatorStore((s) => s.setSlotTarget);
  const unlockFabricatorSlot = useFabricatorStore((s) => s.unlockFabricatorSlot);
  const logisticsA = useUIStore((s) => s.logisticsA);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3 = useUIStore((s) => s.helium3Reserves);
  const alloys = useUIStore((s) => s.alloys);
  const user = useAuthStore((s) => s.user);

  const driveA = useUIStore((s) => s.driveA);
  const driveB = useUIStore((s) => s.driveB);
  void driveA; void driveB;

  function saveUpgrades() {
    if (!user) return;
    const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
    saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
  }

  const handleSetSlotTarget = useCallback((key: string, slotIdx: number, upgradeId: string | null) => {
    setSlotTarget(key, slotIdx, upgradeId);
    if (user) {
      const cs = useFabricatorStore.getState().fabricatorStates[key];
      if (cs) saveFabricatorState(user.uid, key, cs);
      const { materials, rares } = useStockpileStore.getState();
      saveStockpile(user.uid, materials, rares);
    }
  }, [setSlotTarget, user]);

  const handleUnlockFabricatorSlot = useCallback((key: string) => {
    const cs = useFabricatorStore.getState().fabricatorStates[key];
    const slotCount = cs?.slots.length ?? 1;
    const costIdx = slotCount - 1;
    const cost = FABRICATOR_SLOT_COSTS[costIdx];
    if (!cost) return;
    const ui = useUIStore.getState();
    if ((cost.alloys ?? 0) > ui.alloys || (cost.exotic ?? 0) > ui.exoticMatter) return;
    if (cost.alloys) ui.spendAlloys(cost.alloys);
    if (cost.exotic) ui.consumeExoticMatter(cost.exotic);
    unlockFabricatorSlot(key);
    if (user) {
      const updated = useFabricatorStore.getState().fabricatorStates[key];
      if (updated) saveFabricatorState(user.uid, key, updated);
    }
  }, [unlockFabricatorSlot, user]);

  const handleClaimUpgrade = useCallback((pendingId: string) => {
    claimPendingUpgrade(pendingId);
    if (user) {
      const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
      saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
    }
  }, [claimPendingUpgrade, user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNodeKeys, setDraftNodeKeys] = useState<string[]>([]);
  const [lastHoveredNodeId, setLastHoveredNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'resources' | 'materials' | 'modules'>('resources');
  const [pendingEquip, setPendingEquip] = useState<{ extractorKey: string; nodeName: string; resourceLabel: string; slot: 0 | 1 } | null>(null);
  const [dispatchAnim, setDispatchAnim] = useState<DispatchAnim | null>(null);
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

  const maxRoutes = logisticsA;
  const canAddRoute = routes.length < maxRoutes;
  const allExtractors = useMemo(() => Object.values(extractors), [extractors]);
  const allFabricators = useMemo(() => Object.values(fabricators), [fabricators]);

  const projected = useMemo(
    () => projectNodes(allExtractors, allFabricators, nodeEquipped, now),
    [allExtractors, allFabricators, nodeEquipped, now],
  );
  const lastHoveredNode = lastHoveredNodeId
    ? projected.find((p) => p.nodeId === lastHoveredNodeId) ?? null
    : null;

  function startNew() {
    const defaultName = `Route ${String.fromCharCode(65 + routes.length)}`;
    setEditingId(null);
    setIsEditing(true);
    setDraftName(defaultName);
    setDraftNodeKeys([]);
  }

  function startEdit(id: string) {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    setEditingId(id);
    setIsEditing(true);
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
    const validKeys = draftNodeKeys.filter((k) => !!extractors[k] || !!fabricators[k]);
    if (validKeys.length < 2) return;
    const name = draftName.trim() || 'Route';
    if (editingId) {
      updateRoute(editingId, { name, nodeKeys: validKeys });
      if (user) saveLogisticsRoute(user.uid, { id: editingId, name, nodeKeys: validKeys });
    } else {
      if (routes.length >= maxRoutes) return;
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

    const { extractors: liveExtractors } = useExtractorStore.getState();
    const liveFabricators = useFabricatorStore.getState().fabricators;

    const cost = computeRouteCost(route.nodeKeys, liveExtractors, liveFabricators);

    const fabricatorKeys = route.nodeKeys.filter((k) => !!liveFabricators[k]);
    const result = dispatchRoute(routeId);
    if (result !== false) {
      const { collected, deliveries } = result;
      if (user) {
        if (collected.length > 0) {
          const updatedExtractors = useExtractorStore.getState().extractors;
          for (const { key } of collected) {
            const ts = updatedExtractors[key]?.lastCollectedAt;
            if (ts !== undefined) updateExtractorCollected(user.uid, key, ts);
          }
        }
        const updatedFabricatorStates = useFabricatorStore.getState().fabricatorStates;
        for (const fabricatorKey of fabricatorKeys) {
          const cs = updatedFabricatorStates[fabricatorKey];
          if (cs) saveFabricatorState(user.uid, fabricatorKey, cs);
        }
        const { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending } = useExtractorStore.getState();
        saveExtractorUpgrades(user.uid, { ownedUpgrades: owned, nodeEquipped: equipped, pendingUpgrades: pending });
        if (fabricatorKeys.length > 0) {
          const { materials, rares } = useStockpileStore.getState();
          saveStockpile(user.uid, materials, rares);
        }
      }

      // Build dispatch animation
      const orderedNodeIds: string[] = [];
      const seenNodeIds = new Set<string>();
      for (const k of route.nodeKeys) {
        const ext = liveExtractors[k];
        const col = liveFabricators[k];
        let nodeId: string | null = null;
        if (ext) nodeId = getSystemKey(ext);
        else if (col) nodeId = `fabricator:${col.galaxySeed}|${col.systemId}`;
        if (nodeId && !seenNodeIds.has(nodeId)) { seenNodeIds.add(nodeId); orderedNodeIds.push(nodeId); }
      }

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
      for (const d of deliveries) {
        lines.push({
          text: `+${d.count}x ${d.name}`,
          isCost: false,
          revealStep: lastStep,
        });
      }

      if (orderedNodeIds.length > 0) {
        setDispatchAnim({ orderedNodeIds, step: 0, lines, done: false });
      }
    }
  }, [routes, dispatchRoute, user]);

  function handleDelete(routeId: string) {
    if (editingId === routeId) {
      setEditingId(null);
      setIsEditing(false);
      setDraftName('');
      setDraftNodeKeys([]);
    }
    removeRoute(routeId);
    if (user) deleteLogisticsRoute(user.uid, routeId);
  }

  const draftCost = computeRouteCost(draftNodeKeys, extractors, fabricators);

  const draftOrderChain = useMemo(() => {
    const byNodeId = new Map<string, DraftNode>();
    const result: DraftNode[] = [];
    for (const k of draftNodeKeys) {
      const ext = extractors[k];
      const col = fabricators[k];
      if (ext) {
        const sk = getSystemKey(ext);
        if (!byNodeId.has(sk)) {
          const node: DraftNode = { nodeId: sk, name: getSystemName([ext]), keys: [], isFabricator: false, isAdvanced: false };
          byNodeId.set(sk, node);
          result.push(node);
        }
        byNodeId.get(sk)!.keys.push(k);
      } else if (col) {
        const colId = `fabricator:${col.galaxySeed}|${col.systemId}`;
        if (!byNodeId.has(colId)) {
          const node: DraftNode = { nodeId: colId, name: col.systemName || col.planetName, keys: [], isFabricator: true, isAdvanced: (col.tier ?? 1) >= 2 };
          byNodeId.set(colId, node);
          result.push(node);
        }
        byNodeId.get(colId)!.keys.push(k);
      }
    }
    return result;
  }, [draftNodeKeys, extractors, fabricators]);

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
                    const cost = computeRouteCost(route.nodeKeys, extractors, fabricators);
                    const extractorKeys = route.nodeKeys.filter((k) => !!extractors[k]);
                    const stations = extractorKeys.map((k) => extractors[k]) as Extractor[];
                    const fabricatorCount = route.nodeKeys.filter((k) => !!fabricators[k]).length;
                    const nodeCount = route.nodeKeys.filter((k) => !!extractors[k] || !!fabricators[k]).length;
                    const anyAccum = stations.some((s) => peekAccumulated(s) > 0);
                    const routeFabricatorKeys = route.nodeKeys.filter((k) => !!fabricators[k]);
                    const hasReadyFabricatorItems = routeFabricatorKeys.some((k) =>
                      (fabricatorStates[k]?.slots ?? []).some(
                        (slot) => slot.inProduction && slot.inProduction.availableAt <= Date.now(),
                      ),
                    );
                    const canAfford = exoticMatter >= cost.exotic && helium3 >= cost.helium;
                    const canFeedMaterials = canFeedFabricatorMaterials(routeFabricatorKeys, fabricatorStates, stockpileMaterials);
                    const canDispatch =
                      route.nodeKeys.length >= 2 &&
                      (anyAccum || hasReadyFabricatorItems || canFeedMaterials) &&
                      canAfford;
                    const raisesDetection = willRaiseDetection(extractorKeys, extractors);

                    const status = canDispatch
                      ? { key: 'ready', label: 'Ready' }
                      : route.nodeKeys.length < 2
                        ? { key: 'idle', label: 'Incomplete' }
                        : !canAfford
                          ? { key: 'blocked', label: 'Low Fuel' }
                          : { key: 'idle', label: 'No Cargo' };

                    return (
                      <div
                        key={route.id}
                        className={`lroute-card${editingId === route.id ? ' lroute-card--active' : ''}${fabricatorCount > 0 ? ' lroute-card--fabricator' : ''}`}
                        onClick={() => startEdit(route.id)}
                      >
                        <div className="lroute-head">
                          <span className="lroute-name">{route.name}</span>
                          <span className={`lroute-status lroute-status--${status.key}`}>
                            <span className="lroute-status-dot" />
                            {status.label}
                          </span>
                        </div>

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
                            Dispatch raises detection
                          </div>
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
                      Extractors &amp; fabricators — click to add/remove from route
                    </div>
                    <div className="station-map-container">
                      <StationMap
                        projected={projected}
                        draftNodeKeys={draftNodeKeys}
                        onToggle={toggleNode}
                        onNodeHover={setLastHoveredNodeId}
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
                    </div>
                  </div>

                  {/* Footer: cost + order + save */}
                  <div className="logistics-editor-footer">
                    <div className="logistics-cost-display">
                      <div className="logistics-cost-label">Route Cost</div>
                      <div className="logistics-cost-value">
                        {draftNodeKeys.length < 2 ? (
                          <span className="logistics-cost-hint">Add at least 2 nodes</span>
                        ) : (
                          <CostChips
                            exotic={draftCost.exotic}
                            helium={draftCost.helium}
                            affordable={exoticMatter >= draftCost.exotic && helium3 >= draftCost.helium}
                          />
                        )}
                      </div>
                    </div>
                    <div className="logistics-footer-divider" />
                    <div className="logistics-route-order">
                      <span className="logistics-cost-label">Order</span>
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
                                  style={node.isFabricator
                                    ? node.isAdvanced
                                      ? { color: 'rgba(255,200,90,0.85)', borderColor: 'rgba(150,110,35,0.4)' }
                                      : { color: 'rgba(60,220,100,0.8)', borderColor: 'rgba(30,140,60,0.35)' }
                                    : undefined}
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
                      disabled={
                        draftNodeKeys.filter((k) => !!extractors[k] || !!fabricators[k]).length < 2 ||
                        (!editingId && !canAddRoute)
                      }
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
              />
            )}
            {lastHoveredNode && lastHoveredNode.nodeType === 'fabricator' && (
              <FabricatorSidebar
                node={lastHoveredNode}
                fabricators={fabricators}
                fabricatorStates={fabricatorStates}
                exoticMatter={exoticMatter}
                alloys={alloys}
                onClose={() => setLastHoveredNodeId(null)}
                onSetTarget={handleSetSlotTarget}
                onUnlockSlot={handleUnlockFabricatorSlot}
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
                    <span className="logistics-resource-type">Exotic Matter</span>
                    <span className="logistics-resource-amount">{fmt(exoticMatter)}</span>
                  </div>
                  <div className="logistics-reserve-row">
                    <span className="logistics-resource-type">Helium-3</span>
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
                    </Section>
                  )}
                  {pendingUpgrades.length > 0 && (
                    <Section title="Fabricator Output" count={`${pendingUpgrades.length}`} defaultOpen>
                      <div className="lm-pending-list">
                      {pendingUpgrades.map((item) => {
                        const upg = getCraftable(item.upgradeId);
                        const msLeft = item.availableAt - now;
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

function materialCostEntries(materials: MaterialCost): Array<[string, number]> {
  return Object.entries(materials).filter(([, amt]) => !!amt) as Array<[string, number]>;
}

function craftTimeLabel(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
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
        <span className="lm-slot-menu-row-time">{craftTimeLabel(recipe.craftHours)}</span>
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
        {MATERIAL_TIERS.map((tier) => (
          <Section
            key={tier}
            title={`${MATERIAL_TIER_LABELS[tier] ?? `Tier ${tier}`} Materials`}
            defaultOpen={tier === MATERIAL_TIERS[0]}
          >
            {CRAFT_MATERIALS.filter((m) => m.tier === tier).map((m) => {
              const recipe = getCraftable(m.id);
              return recipe ? renderRow(recipe, m.desc) : null;
            })}
          </Section>
        ))}
        <Section title="Extractor Modules">
          {EXTRACTOR_UPGRADES.map((u) => {
            const recipe = getCraftable(u.id);
            return recipe ? renderRow(recipe, `${u.effect.multiplier}x to ${u.effect.upgType}`) : null;
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
  isMenuOpen,
  onOpenMenu,
}: {
  slot: FabricatorProductionSlot;
  slotIdx: number;
  fabricatorKey: string;
  advanced: boolean;
  isMenuOpen: boolean;
  onOpenMenu: (state: SlotMenuState) => void;
}) {
  const now = useNow(60_000);
  const stockpile = useStockpileStore((s) => s.materials);
  const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : null;
  const ip = slot.inProduction;
  const msLeft = ip ? ip.availableAt - now : 0;
  const ready = ip && msLeft <= 0;
  const hoursLeft = ip && !ready ? Math.ceil(msLeft / (60 * 60 * 1000)) : 0;

  return (
    <div className="lm-fabricator-slot-block">
      <div className="lm-fabricator-slot-label">Slot {slotIdx + 1}</div>
      <button
        className={`lm-fabricator-slot-btn${slot.targetUpgradeId ? ' lm-fabricator-slot-btn--filled' : ''}${isMenuOpen ? ' lm-fabricator-slot-btn--open' : ''}`}
        disabled={!!ip}
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
      {recipe && !ip && (
        <div className="lm-fabricator-recipe">
          {Object.entries(recipe.cost).map(([costKey, costAmt]) => {
            if (!costAmt) return null;
            const resourceType = COST_KEY_TO_RESOURCE[costKey];
            if (!resourceType) return null;
            const have = slot.pendingResources[resourceType] ?? 0;
            const pct = Math.min(100, (have / costAmt) * 100);
            return (
              <div key={costKey} className="lm-fabricator-recipe-row">
                <span className="lm-fabricator-recipe-label">{RESOURCE_LABELS[resourceType]}</span>
                <div className="lm-fabricator-progress-track">
                  <div className="lm-fabricator-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="lm-fabricator-recipe-val">{fmt(have)}/{fmt(costAmt)}</span>
              </div>
            );
          })}
          {materialCostEntries(recipe.materials).map(([matId, costAmt]) => {
            const have = slot.pendingMaterials?.[matId] ?? 0;
            const pct = Math.min(100, (have / costAmt) * 100);
            const held = stockpile[matId] ?? 0;
            return (
              <div key={matId} className="lm-fabricator-recipe-row lm-fabricator-recipe-row--mat">
                <span className="lm-fabricator-recipe-label">{materialName(matId)}</span>
                <div className="lm-fabricator-progress-track">
                  <div className="lm-fabricator-progress-fill lm-fabricator-progress-fill--mat" style={{ width: `${pct}%` }} />
                </div>
                <span className={`lm-fabricator-recipe-val${have < costAmt && held === 0 ? ' lm-fabricator-recipe-val--short' : ''}`}>
                  {have}/{costAmt}
                </span>
              </div>
            );
          })}
          <div className="lm-fabricator-recipe-time">{craftTimeLabel(recipe.craftHours)} once fed</div>
        </div>
      )}
      {ip && (
        <div className="lm-fabricator-queue-item">
          <span className="lm-fabricator-queue-name">{getCraftable(ip.upgradeId)?.name ?? ip.upgradeId}</span>
          <span className={`lm-fabricator-queue-time${ready ? ' lm-fabricator-queue-time--ready' : ''}`}>
            {ready ? 'Ready — dispatch to collect' : `${hoursLeft}h`}
          </span>
        </div>
      )}
    </div>
  );
}

function FabricatorSidebar({
  node,
  fabricators,
  fabricatorStates,
  exoticMatter,
  alloys,
  onClose,
  onSetTarget,
  onUnlockSlot,
}: {
  node: ProjectedMapNode;
  fabricators: Record<string, Fabricator>;
  fabricatorStates: Record<string, FabricatorState>;
  exoticMatter: number;
  alloys: number;
  onClose: () => void;
  onSetTarget: (key: string, slotIdx: number, upgradeId: string | null) => void;
  onUnlockSlot: (key: string) => void;
}) {
  const [openSlot, setOpenSlot] = useState<SlotMenuState | null>(null);

  return (
    <div className="lm-submodal">
      <div className="lm-submodal-header">
        <span className="lm-submodal-title">{node.name}</span>
        <button className="lm-submodal-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="lm-fabricator-title-label">Fabrication</div>
      {node.keys.map((k) => {
        const fabricator = fabricators[k];
        const cs = fabricatorStates[k] ?? { slots: [{ targetUpgradeId: null, pendingResources: {}, inProduction: null }] };
        const slotCount = cs.slots.length;
        const costIdx = slotCount - 1;
        const nextCost = FABRICATOR_SLOT_COSTS[costIdx];
        const canUnlock = slotCount < MAX_FABRICATOR_SLOTS && !!nextCost;
        const canAffordUnlock = canUnlock
          ? (nextCost.alloys ?? 0) <= alloys && (nextCost.exotic ?? 0) <= exoticMatter
          : false;
        const unlockLabel = nextCost
          ? [nextCost.alloys ? `${fmt(nextCost.alloys)} alloys` : '', nextCost.exotic ? `${fmt(nextCost.exotic)} EM` : ''].filter(Boolean).join(' + ')
          : '';
        return (
          <div key={k} className="lm-fabricator-entry">
            {fabricator && (
              <div className="lm-fabricator-planet-name">
                {node.keys.length > 1 ? `${fabricator.planetName} · ` : ''}
                {FABRICATOR_TIER_LABELS[fabricator.tier ?? 1]}
              </div>
            )}
            {cs.slots.map((slot, i) => (
              <SlotView
                key={i}
                slot={slot}
                slotIdx={i}
                fabricatorKey={k}
                advanced={(fabricator?.tier ?? 1) >= 2}
                isMenuOpen={openSlot?.fabricatorKey === k && openSlot.slotIdx === i}
                onOpenMenu={setOpenSlot}
              />
            ))}
            {canUnlock && (
              <button
                className="lm-fabricator-unlock-btn"
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

function NodeSidebar({
  node,
  nodeEquipped,
  onClose,
  onSlotClick,
  onUnequip,
}: {
  node: ProjectedMapNode;
  nodeEquipped: Record<string, [string | null, string | null]>;
  onClose: () => void;
  onSlotClick: (extractorKey: string, slot: 0 | 1, resourceLabel: string) => void;
  onUnequip: (extractorKey: string, slot: 0 | 1) => void;
}) {
  const resources = node.resources ?? [];
  const totalRate = resources.reduce((s, r) => s + r.rate, 0);
  const [slotTooltip, setSlotTooltip] = useState<{ upg: typeof EXTRACTOR_UPGRADES[number]; x: number; y: number } | null>(null);

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
): TipContent {
  if (!recipe) return { title: '', desc, rows: [] };
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
  return { title: recipe.name, time: craftTimeLabel(recipe.craftHours), desc, rows, note };
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
          {pendingEquip.nodeName} · {pendingEquip.resourceLabel} · Slot {pendingEquip.slot + 1}
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
                      {upg.effect.upgType === 'detection' ? 'mask' : `${upg.effect.multiplier}x`}
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
        const id = slot.inProduction?.upgradeId ?? slot.targetUpgradeId;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [fabricatorStates]);

  const total = Object.values(stockpile).reduce((a, b) => a + b, 0);
  const rareTotal = Object.values(rares).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="lm-inventory-context">
        Stockpile · {total} held{rareTotal > 0 ? ` · ${rareTotal} rare` : ''}
      </div>
      <div className="lm-inventory-list">
        {MATERIAL_TIERS.map((tier) => {
          const items = CRAFT_MATERIALS.filter((m) => m.tier === tier);
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
                    {...bind(recipeTip(getCraftable(m.id), m.desc, stockpile, note))}
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
