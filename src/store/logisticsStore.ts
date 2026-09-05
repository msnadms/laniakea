import { create } from 'zustand';
import type {
  Extractor, LogisticsRoute, RouteEdge, ExtractorKey, Fabricator, Resource,
  FabricatorProductionItem, FabricatorState, MaterialCost, SlotStatus,
  RouteAutomationPolicy,
} from '../game/types';
import { extractorNodeId, fabricatorNodeId, bufferDepth, COST_KEY_TO_RESOURCE } from '../game/types';
import { getCraftable } from '../data/upgrades';
import type { FabricatorDelivery } from './extractorStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from './extractorStore';
import {
  useFabricatorStore, hasDispatchableFabricatorCargo,
  slotResourceDemand, slotMaterialDemand, slotStatus, processFabricator,
} from './fabricatorStore';
import type { MaterialBudget, SlotRunResult } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, computeStorageCap, computeDriveMultiplier, computeMaterialBandwidth, EXTRACTOR_HOLD_CAPS } from './uiStore';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost } from './travelCosts';

const FABRICATOR_PREFIX = 'fabricator:';
const RAW_TYPES: Resource['type'][] = ['exotic', 'alloys', 'nutrients', 'helium-3', 'metallicHydrogen', 'neutronStarMatter'];

export const DEFAULT_AUTOMATION_POLICY: RouteAutomationPolicy = {
  sourceFillPercent: 50,
  requireRecipeReady: false,
  detectionCeiling: 4,
  pauseOnJam: true,
  quiet: false,
  minimumShipReserve: { exotic: 0, helium3: 0 },
};

export interface NodeGroup {
  nodeId: string;
  extractors: Extractor[];
  fabricatorKeys: string[];
  galaxySeed: number;
  systemId: number;
  systemX: number;
  systemY: number;
  galaxyX: number;
  galaxyY: number;
  superclusSeed: number;
}

export function resolveNodeGroup(
  nodeId: string,
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator>,
): NodeGroup | null {
  const isFabricator = nodeId.startsWith(FABRICATOR_PREFIX);
  const systemKey = isFabricator ? nodeId.slice(FABRICATOR_PREFIX.length) : nodeId;
  const members = isFabricator
    ? Object.values(fabricators).filter((f) => extractorNodeId(f.galaxySeed, f.systemId) === systemKey)
    : Object.values(extractors).filter((e) => extractorNodeId(e.galaxySeed, e.systemId) === systemKey);
  const rep = members[0];
  if (!rep) return null;
  return {
    nodeId,
    extractors: isFabricator ? [] : members as Extractor[],
    fabricatorKeys: isFabricator ? members.map((member) => member.key) : [],
    galaxySeed: rep.galaxySeed, systemId: rep.systemId,
    systemX: rep.systemX, systemY: rep.systemY,
    galaxyX: rep.galaxyX, galaxyY: rep.galaxyY,
    superclusSeed: rep.superclusSeed,
  };
}

export function resolveNodeGroups(
  nodeIds: string[],
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator>,
): Map<string, NodeGroup> {
  const groups = new Map<string, NodeGroup>();
  for (const id of [...nodeIds].sort()) {
    const group = resolveNodeGroup(id, extractors, fabricators);
    if (group) groups.set(id, group);
  }
  return groups;
}

function hopCost(a: NodeGroup, b: NodeGroup): { exotic: number; helium: number } {
  if (a.galaxySeed === b.galaxySeed && a.systemId === b.systemId) return { exotic: 0, helium: 0 };
  if (a.galaxySeed === b.galaxySeed) return galaxyTravelCost(Math.hypot(a.systemX - b.systemX, a.systemY - b.systemY));
  if (a.superclusSeed === b.superclusSeed) return superclusterTravelCost(Math.hypot(a.galaxyX - b.galaxyX, a.galaxyY - b.galaxyY));
  return flatTravelCost(100);
}

export function successors(edges: RouteEdge[], nodeId: string): string[] {
  return edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to).sort();
}

export function reaches(edges: RouteEdge[], from: string, target: string): boolean {
  if (from === target) return true;
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of successors(edges, current)) {
      if (next === target) return true;
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return false;
}

export function wouldCreateCycle(edges: RouteEdge[], from: string, to: string): boolean {
  return from === to || reaches(edges, to, from);
}

export function topoOrder(nodes: string[], edges: RouteEdge[]): string[] | null {
  const sortedNodes = [...new Set(nodes)].sort();
  const indegree = new Map(sortedNodes.map((node) => [node, 0]));
  for (const edge of edges) if (indegree.has(edge.from) && indegree.has(edge.to)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const queue = sortedNodes.filter((node) => (indegree.get(node) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const current = queue.shift()!;
    order.push(current);
    for (const next of successors(edges, current)) {
      if (!indegree.has(next)) continue;
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return order.length === sortedNodes.length ? order : null;
}

export function routeNodes(edges: RouteEdge[]): string[] {
  return [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();
}

export function routeIslandNodes(edges: RouteEdge[]): string[] {
  const nodes = routeNodes(edges);
  if (nodes.length === 0) return [];
  const seen = new Set([nodes[0]]);
  const queue = [nodes[0]];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return nodes.filter((node) => !seen.has(node));
}

export function routeIsValid(edges: RouteEdge[]): boolean {
  const nodes = routeNodes(edges);
  return edges.length > 0 && routeIslandNodes(edges).length === 0 && topoOrder(nodes, edges) !== null;
}

export function edgeKey(edge: Pick<RouteEdge, 'from' | 'to'>): string {
  return `${edge.from}->${edge.to}`;
}

function edgeAllowsRaw(edge: RouteEdge, type: Resource['type']): boolean {
  return edge.allowedRaw === undefined || edge.allowedRaw.includes(type);
}

function edgeAllowsMaterial(edge: RouteEdge, id: string): boolean {
  return edge.allowedMaterials === undefined || edge.allowedMaterials.includes(id);
}

function edgeCapacity(edge: RouteEdge, bandwidth: number): number {
  return Math.max(0, Math.min(bandwidth, Math.floor(edge.unitCap ?? bandwidth)));
}

export function willRaiseDetection(keys: ExtractorKey[], extractors: Record<string, Extractor>): boolean {
  const equipped = useExtractorStore.getState().nodeEquipped;
  return keys.filter((key) => extractors[key] && !getExtractorMultipliers(key, equipped).dampened).length > 4;
}

export function routeDetectionRisk(
  edges: RouteEdge[],
  groups: Map<string, NodeGroup>,
  quiet = false,
): number {
  const equipped = useExtractorStore.getState().nodeEquipped;
  let points = 0;
  for (const group of groups.values()) {
    points += group.extractors.filter((extractor) => !getExtractorMultipliers(extractor.key, equipped).dampened).length;
  }
  for (const edge of edges) {
    const from = groups.get(edge.from);
    const to = groups.get(edge.to);
    if (!from || !to) continue;
    if (from.superclusSeed !== to.superclusSeed) points += 3;
    else if (from.galaxySeed !== to.galaxySeed) points += 2;
    else if (from.systemId !== to.systemId) points += 1;
  }
  return Math.max(0, Math.ceil(points * (quiet ? 0.5 : 1)));
}

export function routeExtractorKeys(groups: Map<string, NodeGroup>): ExtractorKey[] {
  return [...groups.values()].flatMap((group) => group.extractors.map((extractor) => extractor.key)).sort();
}

export function routeFabricatorKeys(groups: Map<string, NodeGroup>): string[] {
  return [...groups.values()].flatMap((group) => group.fabricatorKeys).sort();
}

export function canFeedFabricatorMaterials(
  fabricatorKeys: string[],
  fabricatorStates: Record<string, FabricatorState>,
  fabricators: Record<string, Fabricator>,
  held: MaterialCost,
): boolean {
  return fabricatorKeys.some((key) => {
    const depth = bufferDepth(fabricators[key]?.tier);
    return (fabricatorStates[key]?.slots ?? []).some((slot) => {
      const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
      if (!recipe) return false;
      return Object.entries(slotMaterialDemand(slot, recipe, depth)).some(([id, amount]) => amount > 0 && (held[id] ?? 0) > 0);
    });
  });
}

export function computeRouteCost(
  edges: RouteEdge[],
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator> = {},
): { exotic: number; helium: number } {
  const groups = resolveNodeGroups(routeNodes(edges), extractors, fabricators);
  if (groups.size === 0) return { exotic: 0, helium: 0 };
  const { driveA, driveB } = useUIStore.getState();
  const [exoticMultiplier, heliumMultiplier] = computeDriveMultiplier(driveA, driveB);
  let exotic = Math.max(1, Math.round(50 * exoticMultiplier));
  let helium = Math.max(1, Math.round(25 * heliumMultiplier));
  for (const edge of [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))) {
    const from = groups.get(edge.from);
    const to = groups.get(edge.to);
    if (!from || !to) continue;
    const cost = hopCost(from, to);
    exotic += cost.exotic;
    helium += cost.helium;
  }
  return { exotic, helium };
}

interface Cargo { raw: Partial<Record<Resource['type'], number>>; materials: MaterialCost }
function emptyCargo(): Cargo { return { raw: {}, materials: {} } }

export interface EdgeFlowResult {
  from: string;
  to: string;
  capacity: number;
  used: number;
  raw: Partial<Record<Resource['type'], number>>;
  materials: MaterialCost;
  rejected: MaterialCost;
}

export interface DispatchResult {
  order: string[];
  collected: { key: ExtractorKey; amount: number }[];
  deliveries: FabricatorDelivery[];
  carried: MaterialCost;
  materialsMoved: number;
  bandwidth: number;
  stalled: { fabricatorKey: string; status: SlotStatus }[];
  edgeFlows: Record<string, EdgeFlowResult>;
  slotResults: Record<string, SlotRunResult[]>;
  deposited: Cargo;
  detectionRisk: number;
}

export interface RoutePreview {
  valid: boolean;
  canRun: boolean;
  reason: string;
  cost: { exotic: number; helium: number };
  detectionRisk: number;
  islandNodes: string[];
  expectedBatches: number;
  expectedRecipes: string[];
  expectedEdgeUse: Record<string, { used: number; capacity: number }>;
  shortages: string[];
}

function routePreview(route: LogisticsRoute): RoutePreview {
  const extractors = useExtractorStore.getState().extractors;
  const { fabricators, fabricatorStates } = useFabricatorStore.getState();
  const nodes = routeNodes(route.edges);
  const groups = resolveNodeGroups(nodes, extractors, fabricators);
  const cost = computeRouteCost(route.edges, extractors, fabricators);
  const islands = routeIslandNodes(route.edges);
  const valid = routeIsValid(route.edges) && groups.size === nodes.length;
  const policy = {
    ...DEFAULT_AUTOMATION_POLICY,
    ...(route.automation ?? {}),
    minimumShipReserve: {
      ...DEFAULT_AUTOMATION_POLICY.minimumShipReserve,
      ...(route.automation?.minimumShipReserve ?? {}),
    },
  };
  const risk = routeDetectionRisk(route.edges, groups, policy.quiet);
  const ui = useUIStore.getState();
  const affordable = ui.exoticMatter - cost.exotic >= policy.minimumShipReserve.exotic
    && ui.helium3Reserves - cost.helium >= policy.minimumShipReserve.helium3;
  const extractorKeys = routeExtractorKeys(groups);
  const fabricatorKeys = routeFabricatorKeys(groups);
  const rawDemand = new Map<string, Partial<Record<Resource['type'], number>>>();
  const previewMaterialDemand = new Map<string, MaterialCost>();
  const shortages: string[] = [];
  for (const [nodeId, group] of groups) {
    const demand: Partial<Record<Resource['type'], number>> = {};
    const materials: MaterialCost = {};
    for (const key of group.fabricatorKeys) {
      const depth = bufferDepth(fabricators[key]?.tier);
      for (const slot of fabricatorStates[key]?.slots ?? []) {
        const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
        if (!recipe) continue;
        for (const [type, amount] of Object.entries(slotResourceDemand(slot, recipe, depth))) {
          demand[type as Resource['type']] = (demand[type as Resource['type']] ?? 0) + (amount ?? 0);
        }
        for (const [id, amount] of Object.entries(slotMaterialDemand(slot, recipe, depth))) {
          materials[id] = (materials[id] ?? 0) + amount;
        }
        if (slotStatus(slot, recipe, depth) === 'starved') shortages.push(`${fabricators[key]?.planetName ?? 'Fabricator'}: ${recipe.name}`);
      }
    }
    rawDemand.set(nodeId, demand);
    previewMaterialDemand.set(nodeId, materials);
  }
  const rawWanted = (nodeId: string, type: Resource['type']) => [...rawDemand].reduce(
    (sum, [target, demand]) => sum + (reaches(route.edges, nodeId, target) ? demand[type] ?? 0 : 0), 0,
  );
  const storageCap = computeStorageCap(ui.storageA);
  const held: Record<Resource['type'], number> = {
    exotic: ui.exoticMatter, 'helium-3': ui.helium3Reserves, alloys: ui.alloys,
    nutrients: ui.nutrients, metallicHydrogen: ui.metallicHydrogen, neutronStarMatter: ui.neutronStarMatter,
  };
  const anyCargo = extractorKeys.some((key) => {
    const extractor = extractors[key];
    if (!extractor) return false;
    const outgoing = route.edges.filter((edge) => edge.from === extractorNodeId(extractor.galaxySeed, extractor.systemId));
    const reserve = Math.max(0, ...outgoing.map((edge) => edge.minimumReserve?.raw?.[extractor.resourceType] ?? 0));
    if (peekAccumulated(extractor) <= reserve) return false;
    const explicit = outgoing.some((edge) => edge.allowedRaw?.includes(extractor.resourceType));
    return storageCap - held[extractor.resourceType] + rawWanted(extractorNodeId(extractor.galaxySeed, extractor.systemId), extractor.resourceType) > 0 || explicit;
  });
  const processable = [...groups].some(([nodeId, group]) => {
    const outgoing = route.edges.filter((edge) => edge.from === nodeId);
    return group.fabricatorKeys.some((key) => processFabricator(
      fabricatorStates[key]?.slots ?? [], fabricators[key]?.tier, {}, {},
      { canRouteByproduct: (id) => outgoing.length === 0 || outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow !== 'hold') },
    ).changed);
  });
  const byproducts = hasDispatchableFabricatorCargo(fabricatorKeys, fabricatorStates, fabricators) && processable;
  const heldUseful = Object.entries(route.heldCargo ?? {}).some(([nodeId, cargo]) => {
    const outgoing = route.edges.filter((edge) => edge.from === nodeId);
    if (outgoing.length === 0) return Object.values(cargo.raw ?? {}).some((amount) => (amount ?? 0) > 0)
      || Object.values(cargo.materials ?? {}).some((amount) => amount > 0);
    for (const [type, amount] of Object.entries(cargo.raw ?? {})) {
      if ((amount ?? 0) <= 0) continue;
      const rawType = type as Resource['type'];
      const matching = outgoing.filter((edge) => edgeAllowsRaw(edge, rawType));
      if (matching.length === 0 || matching.some((edge) => edge.overflow !== 'hold') || rawWanted(nodeId, rawType) > 0) return true;
    }
    for (const [id, amount] of Object.entries(cargo.materials ?? {})) {
      if (amount <= 0) continue;
      const matching = outgoing.filter((edge) => edgeAllowsMaterial(edge, id));
      const wanted = [...previewMaterialDemand].some(([target, demand]) => reaches(route.edges, nodeId, target) && (demand[id] ?? 0) > 0);
      if (matching.length === 0 || matching.some((edge) => edge.overflow !== 'hold') || wanted) return true;
    }
    return false;
  });
  const stocked = canFeedFabricatorMaterials(fabricatorKeys, fabricatorStates, fabricators, useStockpileStore.getState().materials);
  const availableRaw: Partial<Record<Resource['type'], number>> = {};
  for (const key of extractorKeys) {
    const extractor = extractors[key];
    availableRaw[extractor.resourceType] = (availableRaw[extractor.resourceType] ?? 0) + peekAccumulated(extractor);
  }
  for (const cargo of Object.values(route.heldCargo ?? {})) {
    for (const [type, amount] of Object.entries(cargo.raw ?? {})) {
      availableRaw[type as Resource['type']] = (availableRaw[type as Resource['type']] ?? 0) + (amount ?? 0);
    }
  }
  const availableMaterials: MaterialCost = { ...useStockpileStore.getState().materials };
  for (const cargo of Object.values(route.heldCargo ?? {})) {
    for (const [id, amount] of Object.entries(cargo.materials ?? {})) availableMaterials[id] = (availableMaterials[id] ?? 0) + amount;
  }
  const expectedRecipes: string[] = [];
  const expectedBatches = fabricatorKeys.reduce((count, key) => count + (fabricatorStates[key]?.slots ?? []).filter((slot) => {
    const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
    if (!recipe) return false;
    const rawReady = Object.entries(recipe.cost).every(([costKey, amount]) => {
      if (!amount) return true;
      const type = COST_KEY_TO_RESOURCE[costKey];
      return !!type && (slot.pendingResources[type] ?? 0) + (availableRaw[type] ?? 0) >= amount;
    });
    const materialReady = Object.entries(recipe.materials).every(
      ([id, amount]) => (slot.pendingMaterials[id] ?? 0) + (availableMaterials[id] ?? 0) >= amount,
    );
    const ready = rawReady && materialReady;
    if (ready) expectedRecipes.push(recipe.name);
    return ready;
  }).length, 0);
  const previewBandwidth = computeMaterialBandwidth(ui.logisticsA, ui.logisticsB);
  const expectedEdgeUse: Record<string, { used: number; capacity: number }> = {};
  for (const edge of route.edges) {
    const capacity = edgeCapacity(edge, previewBandwidth);
    const wanted = [...previewMaterialDemand].reduce((sum, [target, demand]) => {
      if (!reaches(route.edges, edge.to, target)) return sum;
      return sum + Object.values(demand).reduce((total, amount) => total + amount, 0);
    }, 0);
    expectedEdgeUse[edgeKey(edge)] = { used: Math.min(capacity, wanted), capacity };
  }
  let reason = 'Ready';
  if (!valid) reason = islands.length > 0 ? 'Disconnected route islands' : 'Incomplete or cyclic route';
  else if (!affordable) reason = 'Insufficient route fuel';
  else if (ui.detectionRating + Math.floor(risk / 5) > policy.detectionCeiling) reason = 'Detection ceiling would be exceeded';
  else if (!anyCargo && !processable && !byproducts && !stocked && !heldUseful) reason = 'Waiting for useful cargo';
  else if (policy.requireRecipeReady && expectedBatches === 0 && !processable) reason = 'Waiting for a complete recipe batch';
  return {
    valid, canRun: reason === 'Ready', reason, cost, detectionRisk: risk,
    islandNodes: islands, expectedBatches, expectedRecipes, expectedEdgeUse, shortages,
  };
}

function mergeCargo(target: Cargo, source: Cargo) {
  for (const type of RAW_TYPES) if ((source.raw[type] ?? 0) > 0) target.raw[type] = (target.raw[type] ?? 0) + (source.raw[type] ?? 0);
  for (const [id, amount] of Object.entries(source.materials)) if (amount > 0) target.materials[id] = (target.materials[id] ?? 0) + amount;
}

function cargoHasValues(cargo: Cargo): boolean {
  return Object.values(cargo.raw).some((amount) => (amount ?? 0) > 0)
    || Object.values(cargo.materials).some((amount) => amount > 0);
}

interface AllocationCandidate { edge: RouteEdge; flow: EdgeFlowResult; demand: number; explicit: boolean }

function allocateUnits(amount: number, candidates: AllocationCandidate[], material: boolean): Array<[AllocationCandidate, number]> {
  const allocations = new Map<AllocationCandidate, number>();
  const priorities = [...new Set(candidates.map((candidate) => candidate.edge.priority ?? 0))].sort((a, b) => a - b);
  let left = Math.floor(amount);
  for (const priority of priorities) {
    const group = candidates.filter((candidate) => (candidate.edge.priority ?? 0) === priority);
    while (left > 0) {
      const eligible = group.filter((candidate) => {
        const assigned = allocations.get(candidate) ?? 0;
        const capacity = material ? candidate.flow.capacity - candidate.flow.used - assigned : Number.POSITIVE_INFINITY;
        const demandRoom = candidate.explicit ? Number.POSITIVE_INFINITY : candidate.demand - assigned;
        return capacity > 0 && demandRoom > 0;
      });
      if (eligible.length === 0) break;
      eligible.sort((a, b) => {
        const ar = (allocations.get(a) ?? 0) / Math.max(1, a.edge.weight ?? 1);
        const br = (allocations.get(b) ?? 0) / Math.max(1, b.edge.weight ?? 1);
        return ar - br || edgeKey(a.edge).localeCompare(edgeKey(b.edge));
      });
      const pick = eligible[0];
      allocations.set(pick, (allocations.get(pick) ?? 0) + 1);
      left--;
    }
    if (left > 0 && group.length > 0 && !group.some((candidate) => candidate.edge.overflow === 'next')) break;
  }
  return [...allocations.entries()];
}

/** Pure policy allocator used by tests and dry-run tooling. */
export function allocateEdgeCargo(
  edges: RouteEdge[],
  amount: number,
  cargo: { kind: 'raw'; id: Resource['type'] } | { kind: 'material'; id: string },
  downstreamDemand: Record<string, number>,
  bandwidth: number,
): { allocations: Record<string, number>; leftover: number } {
  const material = cargo.kind === 'material';
  const candidates = [...edges]
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || edgeKey(a).localeCompare(edgeKey(b)))
    .filter((edge) => material ? edgeAllowsMaterial(edge, cargo.id) : edgeAllowsRaw(edge, cargo.id))
    .map((edge) => ({
      edge,
      flow: {
        from: edge.from, to: edge.to, capacity: edgeCapacity(edge, bandwidth), used: 0,
        raw: {}, materials: {}, rejected: {},
      },
      demand: downstreamDemand[edge.to] ?? 0,
      explicit: material ? edge.allowedMaterials !== undefined : edge.allowedRaw !== undefined,
    }));
  const allocations: Record<string, number> = {};
  let moved = 0;
  for (const [candidate, count] of allocateUnits(amount, candidates, material)) {
    allocations[edgeKey(candidate.edge)] = count;
    moved += count;
  }
  return { allocations, leftover: amount - moved };
}

interface LogisticsState {
  routes: LogisticsRoute[];
  lastRuns: Record<string, DispatchResult>;
  automationNotices: Record<string, string>;
  addRoute: (route: LogisticsRoute) => void;
  updateRoute: (id: string, patch: Partial<LogisticsRoute>) => void;
  removeRoute: (id: string) => void;
  setRouteActive: (id: string, active: boolean) => void;
  previewRoute: (id: string) => RoutePreview | null;
  dispatchRoute: (id: string, automatic?: boolean) => DispatchResult | false;
  runAutomation: () => DispatchResult[];
  restoreRoutes: (routes: LogisticsRoute[]) => void;
}

export const useLogisticsStore = create<LogisticsState>()((set, get) => ({
  routes: [], lastRuns: {}, automationNotices: {},
  addRoute: (route) => set((state) => ({ routes: [...state.routes, route] })),
  updateRoute: (id, patch) => set((state) => ({ routes: state.routes.map((route) => route.id === id ? { ...route, ...patch } : route) })),
  removeRoute: (id) => set((state) => ({ routes: state.routes.filter((route) => route.id !== id) })),
  setRouteActive: (id, active) => set((state) => ({ routes: state.routes.map((route) => route.id === id ? { ...route, active } : route) })),
  previewRoute: (id) => {
    const route = get().routes.find((candidate) => candidate.id === id);
    return route ? routePreview(route) : null;
  },

  dispatchRoute: (id, automatic = false) => {
    if (useUIStore.getState().checkDetectionLethal()) return false;
    const route = get().routes.find((candidate) => candidate.id === id);
    if (!route) return false;
    const preview = routePreview(route);
    const currentUI = useUIStore.getState();
    const manualPolicyOverride = !automatic && (
      preview.reason === 'Detection ceiling would be exceeded'
      || (preview.reason === 'Insufficient route fuel'
        && currentUI.exoticMatter >= preview.cost.exotic
        && currentUI.helium3Reserves >= preview.cost.helium)
    );
    if (!preview.canRun && !manualPolicyOverride) {
      if (!automatic) useUIStore.getState().triggerHudFlash();
      return false;
    }

    const extractors = useExtractorStore.getState().extractors;
    const { fabricators, fabricatorStates } = useFabricatorStore.getState();
    const groups = resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
    const edges = route.edges.filter((edge) => groups.has(edge.from) && groups.has(edge.to));
    const order = topoOrder([...groups.keys()], edges);
    if (!order || order.length < 2) return false;

    const rawDemand = new Map<string, Partial<Record<Resource['type'], number>>>();
    const materialDemand = new Map<string, MaterialCost>();
    for (const [nodeId, group] of groups) {
      const raw: Partial<Record<Resource['type'], number>> = {};
      const materials: MaterialCost = {};
      for (const key of group.fabricatorKeys) {
        const depth = bufferDepth(fabricators[key]?.tier);
        for (const slot of fabricatorStates[key]?.slots ?? []) {
          const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
          if (!recipe) continue;
          for (const [type, amount] of Object.entries(slotResourceDemand(slot, recipe, depth))) raw[type as Resource['type']] = (raw[type as Resource['type']] ?? 0) + (amount ?? 0);
          for (const [matId, amount] of Object.entries(slotMaterialDemand(slot, recipe, depth))) materials[matId] = (materials[matId] ?? 0) + amount;
        }
      }
      rawDemand.set(nodeId, raw);
      materialDemand.set(nodeId, materials);
    }
    const reachableRaw = (nodeId: string, type: Resource['type']) => [...rawDemand].reduce((sum, [target, demand]) => sum + (reaches(edges, nodeId, target) ? demand[type] ?? 0 : 0), 0);
    const reachableMaterial = (nodeId: string, id: string) => [...materialDemand].reduce((sum, [target, demand]) => sum + (reaches(edges, nodeId, target) ? demand[id] ?? 0 : 0), 0);

    const ui = useUIStore.getState();
    ui.consumeResources(preview.cost.exotic, preview.cost.helium);
    const bandwidth = computeMaterialBandwidth(ui.logisticsA, ui.logisticsB);
    const storageCap = computeStorageCap(ui.storageA);
    const heldRaw: Record<string, number> = {
      exotic: ui.exoticMatter, 'helium-3': ui.helium3Reserves, alloys: ui.alloys,
      nutrients: ui.nutrients, metallicHydrogen: ui.metallicHydrogen, neutronStarMatter: ui.neutronStarMatter,
    };
    const incoming = new Map<string, Cargo>();
    // Only material held before the run may be injected. Overflow deposited by
    // an upstream node cannot reappear at a later fabricator in this dispatch.
    const stockpileInjection = { ...useStockpileStore.getState().materials };
    const heldCargo: Record<string, Cargo> = Object.fromEntries(Object.entries(route.heldCargo ?? {}).map(
      ([nodeId, cargo]) => [nodeId, { raw: { ...(cargo.raw ?? {}) }, materials: { ...(cargo.materials ?? {}) } }],
    ));
    const collected: { key: ExtractorKey; amount: number }[] = [];
    const endItems: FabricatorProductionItem[] = [];
    const carried: MaterialCost = {};
    const stalled: { fabricatorKey: string; status: SlotStatus }[] = [];
    const slotResults: Record<string, SlotRunResult[]> = {};
    let didWork = false;
    const deposited = emptyCargo();
    const edgeFlows: Record<string, EdgeFlowResult> = {};
    for (const edge of edges) edgeFlows[edgeKey(edge)] = { from: edge.from, to: edge.to, capacity: edgeCapacity(edge, bandwidth), used: 0, raw: {}, materials: {}, rejected: {} };

    const deposit = (cargo: Cargo) => {
      mergeCargo(deposited, cargo);
      for (const [type, amount] of Object.entries(cargo.raw)) if ((amount ?? 0) > 0) useUIStore.getState().addCargo(type as Resource['type'], amount ?? 0);
      for (const [id, amount] of Object.entries(cargo.materials)) if (amount > 0) useStockpileStore.getState().addMaterial(id, amount);
    };

    for (const nodeId of order) {
      const group = groups.get(nodeId)!;
      const cargo = incoming.get(nodeId) ?? emptyCargo();
      if (heldCargo[nodeId]) {
        mergeCargo(cargo, heldCargo[nodeId]);
        delete heldCargo[nodeId];
      }
      const beganWithHeldCargo = cargoHasValues(cargo) && !incoming.has(nodeId);
      const outgoing = edges.filter((edge) => edge.from === nodeId).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || edgeKey(a).localeCompare(edgeKey(b)));

      for (const extractor of group.extractors) {
        const type = extractor.resourceType;
        const room = Math.max(0, storageCap - (heldRaw[type] ?? 0));
        const demand = reachableRaw(nodeId, type);
        const explicitRoute = outgoing.some((edge) => edge.allowedRaw?.includes(type));
        const available = peekAccumulated(extractor);
        const maxCollect = Math.min(available, room + demand + (explicitRoute ? available : 0));
        if (maxCollect <= 0) continue;
        const amount = useExtractorStore.getState().collectExtractor(extractor.key, maxCollect);
        if (amount <= 0) continue;
        didWork = true;
        cargo.raw[type] = (cargo.raw[type] ?? 0) + amount;
        collected.push({ key: extractor.key, amount });
        heldRaw[type] = (heldRaw[type] ?? 0) + Math.max(0, amount - Math.min(amount, demand));
      }

      for (const key of group.fabricatorKeys) {
        const injectionBudget: MaterialBudget = { remaining: bandwidth };
        const result = useFabricatorStore.getState().feedFabricator(
          key, cargo.raw, cargo.materials, injectionBudget,
          (id) => outgoing.length === 0 || outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow !== 'hold'),
          stockpileInjection,
        );
        slotResults[key] = result.slotResults;
        if (result.changed) didWork = true;
        for (const [type, amount] of Object.entries(result.consumed)) cargo.raw[type as Resource['type']] = Math.max(0, (cargo.raw[type as Resource['type']] ?? 0) - (amount ?? 0));
        for (const [id, amount] of Object.entries(result.consumedCarried)) cargo.materials[id] = Math.max(0, (cargo.materials[id] ?? 0) - amount);
        for (const item of result.readyItems) {
          if (item.category === 'material') {
            cargo.materials[item.upgradeId] = (cargo.materials[item.upgradeId] ?? 0) + item.count;
            carried[item.upgradeId] = (carried[item.upgradeId] ?? 0) + item.count;
          } else endItems.push(item);
        }
        result.statuses.forEach((status) => {
          if (status === 'starved' || status === 'jammed') stalled.push({ fabricatorKey: key, status });
        });
      }

      if (outgoing.length === 0) {
        if (beganWithHeldCargo && cargoHasValues(cargo)) didWork = true;
        deposit(cargo);
        continue;
      }
      const shares = new Map(outgoing.map((edge) => [edgeKey(edge), emptyCargo()]));
      const reservedRaw: Partial<Record<Resource['type'], number>> = {};
      const reservedMaterials: MaterialCost = {};
      for (const type of RAW_TYPES) {
        const amount = cargo.raw[type] ?? 0;
        if (amount <= 0) continue;
        const reserve = Math.max(0, ...outgoing.map((edge) => edge.minimumReserve?.raw?.[type] ?? 0));
        reservedRaw[type] = Math.min(amount, reserve);
        const transferable = Math.max(0, amount - reserve);
        const candidates = outgoing.filter((edge) => edgeAllowsRaw(edge, type)).map((edge) => ({
          edge, flow: edgeFlows[edgeKey(edge)], demand: reachableRaw(edge.to, type), explicit: edge.allowedRaw !== undefined && edge.allowedRaw.includes(type),
        }));
        let routed = 0;
        for (const [candidate, count] of allocateUnits(transferable, candidates, false)) {
          shares.get(edgeKey(candidate.edge))!.raw[type] = count;
          candidate.flow.raw[type] = count;
          routed += count;
        }
        cargo.raw[type] = amount - routed;
        if (routed > 0) didWork = true;
      }
      for (const [id, amount] of Object.entries(cargo.materials)) {
        if (amount <= 0) continue;
        const reserve = Math.max(0, ...outgoing.map((edge) => edge.minimumReserve?.materials?.[id] ?? 0));
        reservedMaterials[id] = Math.min(amount, reserve);
        const transferable = Math.max(0, amount - reserve);
        const candidates = outgoing.filter((edge) => edgeAllowsMaterial(edge, id)).map((edge) => ({
          edge, flow: edgeFlows[edgeKey(edge)], demand: reachableMaterial(edge.to, id), explicit: edge.allowedMaterials !== undefined && edge.allowedMaterials.includes(id),
        }));
        let routed = 0;
        for (const [candidate, count] of allocateUnits(transferable, candidates, true)) {
          shares.get(edgeKey(candidate.edge))!.materials[id] = count;
          candidate.flow.materials[id] = count;
          candidate.flow.used += count;
          routed += count;
        }
        cargo.materials[id] = amount - routed;
        if (routed > 0) didWork = true;
        if (amount - routed > 0) for (const candidate of candidates) candidate.flow.rejected[id] = (candidate.flow.rejected[id] ?? 0) + amount - routed;
      }
      for (const edge of outgoing) {
        const target = incoming.get(edge.to) ?? emptyCargo();
        mergeCargo(target, shares.get(edgeKey(edge))!);
        incoming.set(edge.to, target);
      }
      const held = emptyCargo();
      const spill = emptyCargo();
      for (const type of RAW_TYPES) {
        const amount = cargo.raw[type] ?? 0;
        if (amount <= 0) continue;
        const overflowHold = outgoing.some((edge) => edgeAllowsRaw(edge, type) && edge.overflow === 'hold');
        const keep = overflowHold ? amount : Math.min(amount, reservedRaw[type] ?? 0);
        if (keep > 0) held.raw[type] = keep;
        if (amount - keep > 0) spill.raw[type] = amount - keep;
      }
      for (const [materialId, amount] of Object.entries(cargo.materials)) {
        if (amount <= 0) continue;
        const overflowHold = outgoing.some((edge) => edgeAllowsMaterial(edge, materialId) && edge.overflow === 'hold');
        const keep = overflowHold ? amount : Math.min(amount, reservedMaterials[materialId] ?? 0);
        if (keep > 0) held.materials[materialId] = keep;
        if (amount - keep > 0) spill.materials[materialId] = amount - keep;
      }
      if (Object.values(held.raw).some((amount) => (amount ?? 0) > 0) || Object.values(held.materials).some((amount) => amount > 0)) {
        heldCargo[nodeId] = held;
      }
      if (beganWithHeldCargo && cargoHasValues(spill)) didWork = true;
      deposit(spill);
    }

    if (!didWork) {
      useUIStore.getState().addCargo('exotic', preview.cost.exotic);
      useUIStore.getState().addCargo('helium-3', preview.cost.helium);
      return false;
    }
    const deliveries = endItems.length > 0 ? useExtractorStore.getState().receiveFabricatorItems(endItems) : [];
    const detectionIncrease = Math.floor(preview.detectionRisk / 5);
    if (detectionIncrease > 0) ui.raiseDetection(detectionIncrease);
    const result: DispatchResult = {
      order, collected, deliveries, carried,
      materialsMoved: Object.values(edgeFlows).reduce((sum, flow) => sum + flow.used, 0),
      bandwidth, stalled, edgeFlows, slotResults, deposited,
      detectionRisk: preview.detectionRisk,
    };
    set((state) => ({
      lastRuns: { ...state.lastRuns, [id]: result },
      routes: state.routes.map((candidate) => candidate.id === id ? { ...candidate, heldCargo } : candidate),
    }));
    const jam = stalled.find((entry) => entry.status === 'jammed');
    if (jam) {
      const name = fabricators[jam.fabricatorKey]?.planetName ?? 'Fabricator';
      ui.triggerHudNotify(`${name.toUpperCase()} JAMMED — BYPRODUCT HAS NO ROUTE`);
      if (automatic && (route.automation?.pauseOnJam ?? true)) get().setRouteActive(id, false);
    }
    return result;
  },

  runAutomation: () => {
    const results: DispatchResult[] = [];
    for (const route of get().routes.filter((candidate) => candidate.active)) {
      const policy = {
        ...DEFAULT_AUTOMATION_POLICY,
        ...(route.automation ?? {}),
        minimumShipReserve: {
          ...DEFAULT_AUTOMATION_POLICY.minimumShipReserve,
          ...(route.automation?.minimumShipReserve ?? {}),
        },
      };
      const extractors = useExtractorStore.getState().extractors;
      const groups = resolveNodeGroups(routeNodes(route.edges), extractors, useFabricatorStore.getState().fabricators);
      const sources = routeExtractorKeys(groups).map((key) => extractors[key]);
      const fill = sources.length === 0 ? 100 : Math.max(...sources.map((source) => 100 * peekAccumulated(source) / Math.max(1, EXTRACTOR_HOLD_CAPS[useUIStore.getState().storageB])));
      if (fill < policy.sourceFillPercent) continue;
      const preview = routePreview(route);
      if (!preview.canRun) {
        if (get().automationNotices[route.id] !== preview.reason && (preview.reason.includes('jam') || preview.reason.includes('fuel') || preview.reason.includes('Detection'))) {
          useUIStore.getState().triggerHudNotify(`${route.name.toUpperCase()} PAUSED — ${preview.reason.toUpperCase()}`);
          set((state) => ({ automationNotices: { ...state.automationNotices, [route.id]: preview.reason } }));
        }
        if (preview.reason === 'Detection ceiling would be exceeded' || preview.reason === 'Insufficient route fuel') {
          get().setRouteActive(route.id, false);
        }
        continue;
      }
      const result = get().dispatchRoute(route.id, true);
      if (result) {
        results.push(result);
        set((state) => ({ automationNotices: { ...state.automationNotices, [route.id]: '' } }));
      }
    }
    return results;
  },

  restoreRoutes: (routes) => set({ routes: routes.map((route) => ({
    ...route,
    active: route.active ?? false,
    automation: {
      ...DEFAULT_AUTOMATION_POLICY,
      ...(route.automation ?? {}),
      minimumShipReserve: {
        ...DEFAULT_AUTOMATION_POLICY.minimumShipReserve,
        ...(route.automation?.minimumShipReserve ?? {}),
      },
    },
    edges: route.edges.map((edge) => ({ ...edge, priority: edge.priority ?? 0, weight: edge.weight ?? 1, overflow: edge.overflow ?? 'stockpile' })),
    heldCargo: route.heldCargo ?? {},
  })), lastRuns: {}, automationNotices: {} }),
}));

export function fabricatorNodeStatus(
  fabricatorKeys: string[],
  fabricatorStates: Record<string, FabricatorState>,
  fabricators: Record<string, Fabricator>,
): SlotStatus {
  const recent = useFabricatorStore.getState().lastRun;
  const rank: SlotStatus[] = ['jammed', 'flowing', 'ready', 'starved', 'idle'];
  let best: SlotStatus = 'idle';
  for (const key of fabricatorKeys) {
    const depth = bufferDepth(fabricators[key]?.tier);
    for (let index = 0; index < (fabricatorStates[key]?.slots ?? []).length; index++) {
      const slot = fabricatorStates[key].slots[index];
      const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
      const status = recent[key]?.[index]?.status ?? slotStatus(slot, recipe, depth);
      if (rank.indexOf(status) < rank.indexOf(best)) best = status;
    }
  }
  return best;
}

/** Extractor rates remain useful in node details; edge labels now use measured flows. */
export function nodeThroughputPerHour(
  group: NodeGroup,
  _fabricatorStates: Record<string, FabricatorState>,
  nodeEquipped: Record<string, [string | null, string | null]>,
): number {
  return group.extractors.reduce((sum, extractor) => sum + extractor.rate * getExtractorMultipliers(extractor.key, nodeEquipped).rateMultiplier, 0);
}

export { fabricatorNodeId, extractorNodeId };
