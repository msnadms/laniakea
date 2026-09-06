import { create } from 'zustand';
import type {
  Extractor, LogisticsRoute, RouteEdge, ExtractorKey, Fabricator, Resource,
  FabricatorProductionItem, FabricatorState, MaterialCost, SlotStatus,
  RouteAutomationPolicy,
} from '../game/types';
import { extractorNodeId, fabricatorNodeId, bufferDepth, RAW_TYPES } from '../game/types';
import { getCraftable } from '../data/upgrades';
import type { FabricatorDelivery } from './extractorStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from './extractorStore';
import {
  useFabricatorStore,
  slotResourceDemand, slotMaterialDemand, slotStatus, processFabricator,
} from './fabricatorStore';
import type { MaterialBudget, SlotRunResult } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, computeStorageCap, computeDriveMultiplier, computeMaterialBandwidth, resourceAmount, EXTRACTOR_HOLD_CAPS } from './uiStore';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost } from './travelCosts';

const FABRICATOR_PREFIX = 'fabricator:';

export const DEFAULT_AUTOMATION_POLICY: RouteAutomationPolicy = {
  dispatchMode: 'fill',
  sourceFillPercent: 50,
  detectionCeiling: 4,
  pauseOnJam: true,
};

export function resolveAutomationPolicy(route: LogisticsRoute): RouteAutomationPolicy {
  return { ...DEFAULT_AUTOMATION_POLICY, ...(route.automation ?? {}) };
}

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

export function cargoReaches(
  edges: RouteEdge[],
  from: string,
  target: string,
  cargo: { kind: 'raw'; id: Resource['type'] } | { kind: 'material'; id: string },
): boolean {
  if (from === target) return true;
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const nextNodes = edges
      .filter((edge) => edge.from === current)
      .filter((edge) => cargo.kind === 'raw' ? edgeAllowsRaw(edge, cargo.id) : edgeAllowsMaterial(edge, cargo.id))
      .map((edge) => edge.to)
      .sort();
    for (const next of nextNodes) {
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
  return Math.max(0, Math.min(bandwidth, Math.floor(edge.materialDraw ?? bandwidth)));
}

export const DETECTION_DENSITY_DIVISOR = 2;
export const DETECTION_CROSSING_POINTS = 1;

function localHopRisk(hops: number): number {
  return Math.floor(hops * (hops - 1) / DETECTION_DENSITY_DIVISOR);
}

function nodeIsDampened(group: NodeGroup, equipped: Record<string, [string | null, string | null]>): boolean {
  return group.extractors.length > 0
    && group.extractors.every((extractor) => getExtractorMultipliers(extractor.key, equipped).dampened);
}

export function routeDetectionRisk(
  edges: RouteEdge[],
  groups: Map<string, NodeGroup>,
): number {
  const equipped = useExtractorStore.getState().nodeEquipped;
  const dampened = new Map([...groups].map(([nodeId, group]) => [nodeId, nodeIsDampened(group, equipped)]));
  const localHops = new Map<number, number>();
  let crossings = 0;
  for (const edge of edges) {
    const from = groups.get(edge.from);
    const to = groups.get(edge.to);
    if (!from || !to) continue;
    if (dampened.get(edge.from) || dampened.get(edge.to)) continue;
    if (from.superclusSeed !== to.superclusSeed) crossings += DETECTION_CROSSING_POINTS;
    else localHops.set(from.superclusSeed, (localHops.get(from.superclusSeed) ?? 0) + 1);
  }
  const density = [...localHops.values()].reduce((sum, hops) => sum + localHopRisk(hops), 0);
  return Math.max(0, density + crossings);
}

export function routeExtractorKeys(groups: Map<string, NodeGroup>): ExtractorKey[] {
  return [...groups.values()].flatMap((group) => group.extractors.map((extractor) => extractor.key)).sort();
}

export function routeFabricatorKeys(groups: Map<string, NodeGroup>): string[] {
  return [...groups.values()].flatMap((group) => group.fabricatorKeys).sort();
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

function simulateRoutePreview(
  route: LogisticsRoute,
  groups: Map<string, NodeGroup>,
  extractors: Record<string, Extractor>,
  fabricators: Record<string, Fabricator>,
  fabricatorStates: Record<string, FabricatorState>,
  stockpile: MaterialCost,
  bandwidth: number,
): {
  didWork: boolean;
  expectedBatches: number;
  expectedRecipes: string[];
  expectedEdgeUse: Record<string, { used: number; capacity: number }>;
  shortages: string[];
  injectedStockpile: number;
} {
  const edges = route.edges.filter((edge) => groups.has(edge.from) && groups.has(edge.to));
  const order = topoOrder([...groups.keys()], edges);
  if (!order) return {
    didWork: false, expectedBatches: 0, expectedRecipes: [], expectedEdgeUse: {}, shortages: [], injectedStockpile: 0,
  };

  const rawDemand = new Map<string, Partial<Record<Resource['type'], number>>>();
  const materialDemand = new Map<string, MaterialCost>();
  const simulatedStates: Record<string, FabricatorState> = Object.fromEntries(
    Object.entries(fabricatorStates).map(([key, state]) => [key, {
      slots: state.slots.map((slot) => ({
        ...slot,
        pendingResources: { ...slot.pendingResources },
        pendingMaterials: { ...slot.pendingMaterials },
        byproducts: { ...slot.byproducts },
      })),
    }]),
  );
  for (const [nodeId, group] of groups) {
    const raw: Partial<Record<Resource['type'], number>> = {};
    const materials: MaterialCost = {};
    for (const key of group.fabricatorKeys) {
      const depth = bufferDepth(fabricators[key]?.tier);
      for (const slot of simulatedStates[key]?.slots ?? []) {
        const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
        if (!recipe) continue;
        for (const [type, amount] of Object.entries(slotResourceDemand(slot, recipe, depth))) {
          raw[type as Resource['type']] = (raw[type as Resource['type']] ?? 0) + (amount ?? 0);
        }
        for (const [id, amount] of Object.entries(slotMaterialDemand(slot, recipe, depth))) {
          materials[id] = (materials[id] ?? 0) + amount;
        }
      }
    }
    rawDemand.set(nodeId, raw);
    materialDemand.set(nodeId, materials);
  }
  const remainingCollectionDemand = new Map(
    [...rawDemand].map(([target, demand]) => [target, { ...demand }]),
  );
  const reachableCollection = (nodeId: string, type: Resource['type']) => [...remainingCollectionDemand].reduce(
    (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'raw', id: type }) ? demand[type] ?? 0 : 0), 0,
  );
  const reachableRawDemand = (nodeId: string, type: Resource['type']) => [...rawDemand].reduce(
    (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'raw', id: type }) ? demand[type] ?? 0 : 0), 0,
  );
  const claimRaw = (nodeId: string, type: Resource['type'], amount: number) => {
    let left = amount;
    for (const [target, demand] of [...remainingCollectionDemand].sort(([a], [b]) => a.localeCompare(b))) {
      if (left <= 0) break;
      if (!cargoReaches(edges, nodeId, target, { kind: 'raw', id: type })) continue;
      const take = Math.min(left, demand[type] ?? 0);
      demand[type] = Math.max(0, (demand[type] ?? 0) - take);
      left -= take;
    }
  };
  const reachableMaterial = (nodeId: string, id: string) => [...materialDemand].reduce(
    (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'material', id }) ? demand[id] ?? 0 : 0), 0,
  );

  const incoming = new Map<string, Cargo>();
  const heldCargo: Record<string, Cargo> = Object.fromEntries(Object.entries(route.heldCargo ?? {}).map(
    ([nodeId, cargo]) => [nodeId, { raw: { ...(cargo.raw ?? {}) }, materials: { ...(cargo.materials ?? {}) } }],
  ));
  const remainingStockpile = { ...stockpile };
  const edgeFlows: Record<string, EdgeFlowResult> = {};
  for (const edge of edges) edgeFlows[edgeKey(edge)] = {
    from: edge.from, to: edge.to, capacity: edgeCapacity(edge, bandwidth), used: 0, raw: {}, materials: {}, rejected: {},
  };
  const expectedRecipes = new Set<string>();
  const shortages: string[] = [];
  let expectedBatches = 0;
  let injectedStockpile = 0;
  let didWork = false;

  for (const nodeId of order) {
    const group = groups.get(nodeId)!;
    const cargo = incoming.get(nodeId) ?? emptyCargo();
    const restoredHeld = heldCargo[nodeId];
    if (restoredHeld) {
      mergeCargo(cargo, restoredHeld);
      for (const [type, amount] of Object.entries(restoredHeld.raw)) claimRaw(nodeId, type as Resource['type'], amount ?? 0);
    }
    const outgoing = edges.filter((edge) => edge.from === nodeId)
      .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
    for (const extractor of group.extractors) {
      const spare = Math.max(0, peekAccumulated(extractor) - Math.max(0, extractor.reserve ?? 0));
      const amount = Math.min(spare, reachableCollection(nodeId, extractor.resourceType));
      if (amount <= 0) continue;
      cargo.raw[extractor.resourceType] = (cargo.raw[extractor.resourceType] ?? 0) + amount;
      claimRaw(nodeId, extractor.resourceType, amount);
      didWork = true;
    }

    for (const key of group.fabricatorKeys) {
      const incomingEdges = edges.filter((edge) => edge.to === nodeId)
        .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
      const incomingCapacity = incomingEdges.reduce(
        (sum, edge) => sum + Math.max(0, edgeFlows[edgeKey(edge)].capacity - edgeFlows[edgeKey(edge)].used), 0,
      );
      const injectable: MaterialCost = {};
      for (const [id, amount] of Object.entries(remainingStockpile)) {
        const capacity = incomingEdges.reduce((sum, edge) => {
          const flow = edgeFlows[edgeKey(edge)];
          return sum + (edgeAllowsMaterial(edge, id) ? Math.max(0, flow.capacity - flow.used) : 0);
        }, 0);
        injectable[id] = Math.min(amount, capacity);
      }
      const result = processFabricator(
        simulatedStates[key]?.slots ?? [], fabricators[key]?.tier, cargo.raw, cargo.materials,
        {
          stockpile: injectable,
          stockpileBudget: { remaining: incomingCapacity },
          canRouteByproduct: (id) => outgoing.length === 0
            || outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow !== 'hold'),
          fillMode: fabricators[key]?.fillMode,
        },
      );
      if (result.changed) didWork = true;
      simulatedStates[key] = { slots: result.slots };
      for (const [type, amount] of Object.entries(result.consumed)) {
        cargo.raw[type as Resource['type']] = Math.max(0, (cargo.raw[type as Resource['type']] ?? 0) - (amount ?? 0));
      }
      for (const [id, amount] of Object.entries(result.consumedCarried)) cargo.materials[id] = Math.max(0, (cargo.materials[id] ?? 0) - amount);
      for (const [id, amount] of Object.entries(result.consumedStockpile)) {
        const candidates = incomingEdges.filter((edge) => edgeAllowsMaterial(edge, id)).map((edge) => ({
          edge, flow: edgeFlows[edgeKey(edge)], demand: Number.POSITIVE_INFINITY, explicit: true,
        }));
        for (const [candidate, count] of allocateUnits(amount, candidates, true)) {
          candidate.flow.used += count;
          candidate.flow.materials[id] = (candidate.flow.materials[id] ?? 0) + count;
          remainingStockpile[id] = Math.max(0, (remainingStockpile[id] ?? 0) - count);
          injectedStockpile += count;
        }
      }
      for (const item of result.readyItems) if (item.category === 'material') {
        cargo.materials[item.upgradeId] = (cargo.materials[item.upgradeId] ?? 0) + item.count;
      }
      for (const slotResult of result.slotResults) {
        if (slotResult.batches > 0) {
          expectedBatches += slotResult.batches;
          const recipe = slotResult.targetUpgradeId ? getCraftable(slotResult.targetUpgradeId) : undefined;
          if (recipe) expectedRecipes.add(recipe.name);
          didWork = true;
        }
        if (slotResult.status === 'starved') {
          const recipe = slotResult.targetUpgradeId ? getCraftable(slotResult.targetUpgradeId) : undefined;
          if (recipe) shortages.push(`${fabricators[key]?.planetName ?? 'Fabricator'}: ${recipe.name}`);
        }
      }
    }

    if (outgoing.length === 0) continue;
    const shares = new Map(outgoing.map((edge) => [edgeKey(edge), emptyCargo()]));
    for (const type of RAW_TYPES) {
      const amount = cargo.raw[type] ?? 0;
      if (amount <= 0) continue;
      const candidates = outgoing.filter((edge) => edgeAllowsRaw(edge, type)).map((edge) => ({
        edge, flow: edgeFlows[edgeKey(edge)], demand: reachableRawDemand(edge.to, type), explicit: edge.allowedRaw !== undefined,
      }));
      for (const [candidate, count] of allocateUnits(amount, candidates, false)) {
        shares.get(edgeKey(candidate.edge))!.raw[type] = count;
      }
    }
    for (const [id, amount] of Object.entries(cargo.materials)) {
      if (amount <= 0) continue;
      const candidates = outgoing.filter((edge) => edgeAllowsMaterial(edge, id)).map((edge) => ({
        edge, flow: edgeFlows[edgeKey(edge)], demand: reachableMaterial(edge.to, id), explicit: edge.allowedMaterials !== undefined,
      }));
      for (const [candidate, count] of allocateUnits(amount, candidates, true)) {
        shares.get(edgeKey(candidate.edge))!.materials[id] = count;
        candidate.flow.used += count;
        candidate.flow.materials[id] = (candidate.flow.materials[id] ?? 0) + count;
      }
    }
    for (const edge of outgoing) {
      const target = incoming.get(edge.to) ?? emptyCargo();
      mergeCargo(target, shares.get(edgeKey(edge))!);
      incoming.set(edge.to, target);
    }
  }

  return {
    didWork, expectedBatches, expectedRecipes: [...expectedRecipes],
    expectedEdgeUse: Object.fromEntries(Object.entries(edgeFlows).map(([key, flow]) => [key, { used: flow.used, capacity: flow.capacity }])),
    shortages: [...new Set(shortages)], injectedStockpile,
  };
}

function routePreview(route: LogisticsRoute): RoutePreview {
  const extractors = useExtractorStore.getState().extractors;
  const { fabricators, fabricatorStates } = useFabricatorStore.getState();
  const nodes = routeNodes(route.edges);
  const groups = resolveNodeGroups(nodes, extractors, fabricators);
  const cost = computeRouteCost(route.edges, extractors, fabricators);
  const islands = routeIslandNodes(route.edges);
  const valid = routeIsValid(route.edges) && groups.size === nodes.length;
  const policy = resolveAutomationPolicy(route);
  const risk = routeDetectionRisk(route.edges, groups);
  const ui = useUIStore.getState();
  const affordable = ui.exoticMatter - cost.exotic >= ui.fuelReserveExotic
    && ui.helium3Reserves - cost.helium >= ui.fuelReserveHelium3;
  const extractorKeys = routeExtractorKeys(groups);
  const rawDemand = new Map<string, Partial<Record<Resource['type'], number>>>();
  const previewMaterialDemand = new Map<string, MaterialCost>();
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
      }
    }
    rawDemand.set(nodeId, demand);
    previewMaterialDemand.set(nodeId, materials);
  }
  const rawWanted = (nodeId: string, type: Resource['type']) => [...rawDemand].reduce(
    (sum, [target, demand]) => sum + (cargoReaches(route.edges, nodeId, target, { kind: 'raw', id: type }) ? demand[type] ?? 0 : 0), 0,
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
    if (peekAccumulated(extractor) <= Math.max(0, extractor.reserve ?? 0)) return false;
    const canHold = outgoing.some((edge) => edgeAllowsRaw(edge, extractor.resourceType) && edge.overflow === 'hold');
    return storageCap - held[extractor.resourceType] + rawWanted(extractorNodeId(extractor.galaxySeed, extractor.systemId), extractor.resourceType) > 0 || canHold;
  });
  const heldUseful = Object.entries(route.heldCargo ?? {}).some(([nodeId, cargo]) => {
    const outgoing = route.edges.filter((edge) => edge.from === nodeId);
    if (outgoing.length === 0) return Object.entries(cargo.raw ?? {}).some(
      ([type, amount]) => (amount ?? 0) > 0 && held[type as Resource['type']] < storageCap,
    )
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
      const wanted = [...previewMaterialDemand].some(([target, demand]) => cargoReaches(route.edges, nodeId, target, { kind: 'material', id }) && (demand[id] ?? 0) > 0);
      if (matching.length === 0 || matching.some((edge) => edge.overflow !== 'hold') || wanted) return true;
    }
    return false;
  });
  const previewBandwidth = computeMaterialBandwidth(ui.logisticsA, ui.logisticsB);
  const simulation = simulateRoutePreview(
    route, groups, extractors, fabricators, fabricatorStates,
    useStockpileStore.getState().materials, previewBandwidth,
  );
  let reason = 'Ready';
  if (!valid) reason = islands.length > 0 ? 'Disconnected route islands' : 'Incomplete or cyclic route';
  else if (!affordable) reason = 'Insufficient route fuel';
  else if (ui.detectionRating + Math.floor(risk / 5) > policy.detectionCeiling) reason = 'Detection ceiling would be exceeded';
  else if (!anyCargo && !simulation.didWork && !heldUseful) reason = 'Waiting for useful cargo';
  else if (policy.dispatchMode === 'batch' && simulation.expectedBatches === 0) reason = 'Waiting for a complete recipe batch';
  return {
    valid, canRun: reason === 'Ready', reason, cost, detectionRisk: risk,
    islandNodes: islands,
    expectedBatches: simulation.expectedBatches,
    expectedRecipes: simulation.expectedRecipes,
    expectedEdgeUse: simulation.expectedEdgeUse,
    shortages: simulation.shortages,
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
  let left = Math.floor(amount);
  while (left > 0) {
    const eligible = candidates.filter((candidate) => {
      const assigned = allocations.get(candidate) ?? 0;
      const capacity = material ? candidate.flow.capacity - candidate.flow.used - assigned : Number.POSITIVE_INFINITY;
      const demandRoom = candidate.explicit ? Number.POSITIVE_INFINITY : candidate.demand - assigned;
      return capacity > 0 && demandRoom > 0;
    });
    if (eligible.length === 0) break;
    eligible.sort((a, b) => (allocations.get(a) ?? 0) - (allocations.get(b) ?? 0)
      || edgeKey(a.edge).localeCompare(edgeKey(b.edge)));
    const pick = eligible[0];
    allocations.set(pick, (allocations.get(pick) ?? 0) + 1);
    left--;
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
    .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
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
    const reachableRaw = (nodeId: string, type: Resource['type']) => [...rawDemand].reduce(
      (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'raw', id: type }) ? demand[type] ?? 0 : 0), 0,
    );
    const reachableMaterial = (nodeId: string, materialId: string) => [...materialDemand].reduce(
      (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'material', id: materialId }) ? demand[materialId] ?? 0 : 0), 0,
    );
    const remainingCollectionDemand = new Map(
      [...rawDemand].map(([target, demand]) => [target, { ...demand }]),
    );
    const reachableCollectionDemand = (nodeId: string, type: Resource['type']) => [...remainingCollectionDemand].reduce(
      (sum, [target, demand]) => sum + (cargoReaches(edges, nodeId, target, { kind: 'raw', id: type }) ? demand[type] ?? 0 : 0), 0,
    );
    const claimCollectionDemand = (nodeId: string, type: Resource['type'], amount: number) => {
      let left = amount;
      for (const [target, demand] of [...remainingCollectionDemand].sort(([a], [b]) => a.localeCompare(b))) {
        if (left <= 0) break;
        if (!cargoReaches(edges, nodeId, target, { kind: 'raw', id: type })) continue;
        const take = Math.min(left, demand[type] ?? 0);
        if (take > 0) demand[type] = (demand[type] ?? 0) - take;
        left -= take;
      }
      return amount - left;
    };

    const ui = useUIStore.getState();
    ui.consumeResources(preview.cost.exotic, preview.cost.helium);
    const bandwidth = computeMaterialBandwidth(ui.logisticsA, ui.logisticsB);
    const storageCap = computeStorageCap(ui.storageA);
    const afterFuel = useUIStore.getState();
    const heldRaw = Object.fromEntries(
      RAW_TYPES.map((type) => [type, resourceAmount(afterFuel, type)]),
    ) as Record<Resource['type'], number>;
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

    const deposit = (cargo: Cargo): { rejected: Cargo; accepted: boolean } => {
      const rejected = emptyCargo();
      let accepted = false;
      mergeCargo(deposited, cargo);
      for (const [type, amount] of Object.entries(cargo.raw)) {
        if ((amount ?? 0) <= 0) continue;
        const rawType = type as Resource['type'];
        const stored = useUIStore.getState().depositCargo(rawType, amount ?? 0);
        if (stored > 0) accepted = true;
        const leftover = (amount ?? 0) - stored;
        if (leftover > 0) rejected.raw[rawType] = leftover;
      }
      for (const [id, amount] of Object.entries(cargo.materials)) if (amount > 0) {
        useStockpileStore.getState().addMaterial(id, amount);
        accepted = true;
      }
      for (const type of RAW_TYPES) {
        const rejectedAmount = rejected.raw[type] ?? 0;
        if (rejectedAmount > 0) deposited.raw[type] = Math.max(0, (deposited.raw[type] ?? 0) - rejectedAmount);
      }
      return { rejected, accepted };
    };

    for (const nodeId of order) {
      const group = groups.get(nodeId)!;
      const cargo = incoming.get(nodeId) ?? emptyCargo();
      if (heldCargo[nodeId]) {
        const restoredHeld = heldCargo[nodeId];
        mergeCargo(cargo, restoredHeld);
        for (const [type, amount] of Object.entries(restoredHeld.raw)) {
          claimCollectionDemand(nodeId, type as Resource['type'], amount ?? 0);
        }
        delete heldCargo[nodeId];
      }
      const beganWithHeldCargo = cargoHasValues(cargo) && !incoming.has(nodeId);
      const outgoing = edges.filter((edge) => edge.from === nodeId).sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));

      for (const extractor of group.extractors) {
        const type = extractor.resourceType;
        const room = Math.max(0, storageCap - (heldRaw[type] ?? 0));
        const demand = reachableCollectionDemand(nodeId, type);
        const canHold = outgoing.some((edge) => edgeAllowsRaw(edge, type) && edge.overflow === 'hold');
        const available = Math.max(0, peekAccumulated(extractor) - Math.max(0, extractor.reserve ?? 0));
        const maxCollect = Math.min(available, room + demand + (canHold ? available : 0));
        if (maxCollect <= 0) continue;
        const amount = useExtractorStore.getState().collectExtractor(extractor.key, maxCollect);
        if (amount <= 0) continue;
        didWork = true;
        cargo.raw[type] = (cargo.raw[type] ?? 0) + amount;
        collected.push({ key: extractor.key, amount });
        const claimed = claimCollectionDemand(nodeId, type, amount);
        heldRaw[type] = (heldRaw[type] ?? 0) + Math.max(0, amount - claimed);
      }

      for (const key of group.fabricatorKeys) {
        const incomingEdges = edges
          .filter((edge) => edge.to === nodeId)
          .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
        const remainingIncomingCapacity = incomingEdges.reduce(
          (sum, edge) => sum + Math.max(0, edgeFlows[edgeKey(edge)].capacity - edgeFlows[edgeKey(edge)].used),
          0,
        );
        const injectableStockpile: MaterialCost = {};
        for (const [materialId, amount] of Object.entries(stockpileInjection)) {
          const materialCapacity = incomingEdges.reduce((sum, edge) => {
            const flow = edgeFlows[edgeKey(edge)];
            return sum + (edgeAllowsMaterial(edge, materialId) ? Math.max(0, flow.capacity - flow.used) : 0);
          }, 0);
          injectableStockpile[materialId] = Math.min(amount, materialCapacity);
        }
        const injectionBudget: MaterialBudget = { remaining: remainingIncomingCapacity };
        const result = useFabricatorStore.getState().feedFabricator(
          key, cargo.raw, cargo.materials, injectionBudget,
          (id) => outgoing.length === 0 || outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow !== 'hold'),
          injectableStockpile,
        );
        for (const [materialId, amount] of Object.entries(result.consumedStockpile)) {
          const candidates = incomingEdges
            .filter((edge) => edgeAllowsMaterial(edge, materialId))
            .map((edge) => ({
              edge,
              flow: edgeFlows[edgeKey(edge)],
              demand: Number.POSITIVE_INFINITY,
              explicit: true,
            }));
          let allocated = 0;
          for (const [candidate, count] of allocateUnits(amount, candidates, true)) {
            candidate.flow.materials[materialId] = (candidate.flow.materials[materialId] ?? 0) + count;
            candidate.flow.used += count;
            allocated += count;
          }
          stockpileInjection[materialId] = Math.max(0, (stockpileInjection[materialId] ?? 0) - allocated);
        }
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
        const depositResult = deposit(cargo);
        if (beganWithHeldCargo && depositResult.accepted) didWork = true;
        if (cargoHasValues(depositResult.rejected)) heldCargo[nodeId] = depositResult.rejected;
        continue;
      }
      const shares = new Map(outgoing.map((edge) => [edgeKey(edge), emptyCargo()]));
      for (const type of RAW_TYPES) {
        const transferable = cargo.raw[type] ?? 0;
        if (transferable <= 0) continue;
        const candidates = outgoing.filter((edge) => edgeAllowsRaw(edge, type)).map((edge) => ({
          edge, flow: edgeFlows[edgeKey(edge)], demand: reachableRaw(edge.to, type), explicit: edge.allowedRaw !== undefined && edge.allowedRaw.includes(type),
        }));
        let routed = 0;
        for (const [candidate, count] of allocateUnits(transferable, candidates, false)) {
          shares.get(edgeKey(candidate.edge))!.raw[type] = count;
          candidate.flow.raw[type] = (candidate.flow.raw[type] ?? 0) + count;
          routed += count;
        }
        cargo.raw[type] = transferable - routed;
        if (routed > 0) didWork = true;
      }
      for (const [id, transferable] of Object.entries(cargo.materials)) {
        if (transferable <= 0) continue;
        const candidates = outgoing.filter((edge) => edgeAllowsMaterial(edge, id)).map((edge) => ({
          edge, flow: edgeFlows[edgeKey(edge)], demand: reachableMaterial(edge.to, id), explicit: edge.allowedMaterials !== undefined && edge.allowedMaterials.includes(id),
        }));
        let routed = 0;
        const allocated = new Map<string, number>();
        for (const [candidate, count] of allocateUnits(transferable, candidates, true)) {
          shares.get(edgeKey(candidate.edge))!.materials[id] = count;
          candidate.flow.materials[id] = (candidate.flow.materials[id] ?? 0) + count;
          candidate.flow.used += count;
          allocated.set(edgeKey(candidate.edge), count);
          routed += count;
        }
        cargo.materials[id] = transferable - routed;
        if (routed > 0) didWork = true;
        // An edge reports what it wanted but could not take, never cargo a sibling legitimately won.
        for (const edge of outgoing) {
          const flow = edgeFlows[edgeKey(edge)];
          if (!edgeAllowsMaterial(edge, id)) {
            flow.rejected[id] = (flow.rejected[id] ?? 0) + transferable;
            continue;
          }
          const candidate = candidates.find((entry) => entry.edge === edge);
          const wanted = Math.min(transferable, candidate?.explicit ? transferable : candidate?.demand ?? 0);
          const short = Math.max(0, wanted - (allocated.get(edgeKey(edge)) ?? 0));
          if (short > 0) flow.rejected[id] = (flow.rejected[id] ?? 0) + short;
        }
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
        if (outgoing.some((edge) => edgeAllowsRaw(edge, type) && edge.overflow === 'hold')) held.raw[type] = amount;
        else spill.raw[type] = amount;
      }
      for (const [materialId, amount] of Object.entries(cargo.materials)) {
        if (amount <= 0) continue;
        if (outgoing.some((edge) => edgeAllowsMaterial(edge, materialId) && edge.overflow === 'hold')) held.materials[materialId] = amount;
        else spill.materials[materialId] = amount;
      }
      const depositResult = deposit(spill);
      if (beganWithHeldCargo && depositResult.accepted) didWork = true;
      mergeCargo(held, depositResult.rejected);
      if (cargoHasValues(held)) heldCargo[nodeId] = held;
    }

    if (!didWork) {
      useUIStore.getState().addCargo('exotic', preview.cost.exotic);
      useUIStore.getState().addCargo('helium-3', preview.cost.helium);
      return false;
    }
    const deliveries = endItems.length > 0 ? useExtractorStore.getState().receiveFabricatorItems(endItems) : [];
    const detectionIncrease = Math.floor(preview.detectionRisk / 5);
    if (detectionIncrease > 0) ui.raiseDetectionBy(detectionIncrease);
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
      if (automatic && resolveAutomationPolicy(route).pauseOnJam) get().setRouteActive(id, false);
    }
    return result;
  },

  runAutomation: () => {
    const results: DispatchResult[] = [];
    for (const route of get().routes.filter((candidate) => candidate.active)) {
      const policy = resolveAutomationPolicy(route);
      const extractors = useExtractorStore.getState().extractors;
      const groups = resolveNodeGroups(routeNodes(route.edges), extractors, useFabricatorStore.getState().fabricators);
      const sources = routeExtractorKeys(groups).map((key) => extractors[key]);
      const fill = sources.length === 0 ? 100 : Math.max(...sources.map((source) => 100 * peekAccumulated(source) / Math.max(1, EXTRACTOR_HOLD_CAPS[useUIStore.getState().storageB])));
      if (fill < policy.sourceFillPercent) continue;
      const preview = routePreview(route);
      if (!preview.canRun) {
        if (get().automationNotices[route.id] !== preview.reason && (preview.reason.includes('jam') || preview.reason.includes('fuel') || preview.reason.includes('Detection'))) {
          useUIStore.getState().triggerHudNotify(`${route.name.toUpperCase()} HOLDING — ${preview.reason.toUpperCase()}`);
          set((state) => ({ automationNotices: { ...state.automationNotices, [route.id]: preview.reason } }));
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

  restoreRoutes: (routes) => {
    const extractors = useExtractorStore.getState().extractors;
    const fabricators = useFabricatorStore.getState().fabricators;
    set({ routes: routes.map((route) => {
      let edges = route.edges;
      if (route.legacyNodeKeys !== undefined) {
        const migratedNodes: string[] = [];
        for (const key of route.legacyNodeKeys) {
          const extractor = extractors[key];
          const fabricator = fabricators[key];
          const nodeId = extractor
            ? extractorNodeId(extractor.galaxySeed, extractor.systemId)
            : fabricator
              ? fabricatorNodeId(fabricator.galaxySeed, fabricator.systemId)
              : null;
          if (nodeId && !migratedNodes.includes(nodeId)) migratedNodes.push(nodeId);
        }
        edges = migratedNodes.slice(1).map((to, index) => ({ from: migratedNodes[index], to }));
      }
      const { legacyNodeKeys: _legacyNodeKeys, ...persistedRoute } = route;
      return {
        ...persistedRoute,
        active: route.active ?? false,
        automation: migrateAutomationPolicy(route.automation),
        edges: edges.map(migrateEdge),
        heldCargo: route.heldCargo ?? {},
      };
    }), lastRuns: {}, automationNotices: {} });
    useUIStore.getState().adoptLegacyFuelReserve(legacyFuelReserve(routes));
  },
}));

interface LegacyRouteEdge extends RouteEdge {
  priority?: number;
  weight?: number;
  unitCap?: number;
  minimumReserve?: { raw?: Partial<Record<Resource['type'], number>>; materials?: MaterialCost };
}

interface LegacyAutomationPolicy extends Partial<RouteAutomationPolicy> {
  requireRecipeReady?: boolean;
  quiet?: boolean;
  minimumShipReserve?: { exotic?: number; helium3?: number };
}

function migrateEdge(edge: RouteEdge): RouteEdge {
  const {
    priority: _priority, weight: _weight, unitCap, minimumReserve: _minimumReserve, ...kept
  } = edge as LegacyRouteEdge;
  return {
    ...kept,
    materialDraw: kept.materialDraw ?? unitCap,
    overflow: kept.overflow === 'hold' ? 'hold' : 'stockpile',
  };
}

function migrateAutomationPolicy(automation: RouteAutomationPolicy | undefined): RouteAutomationPolicy {
  const legacy = (automation ?? {}) as LegacyAutomationPolicy;
  return {
    dispatchMode: legacy.dispatchMode ?? (legacy.requireRecipeReady ? 'batch' : 'fill'),
    sourceFillPercent: legacy.sourceFillPercent ?? DEFAULT_AUTOMATION_POLICY.sourceFillPercent,
    detectionCeiling: legacy.detectionCeiling ?? DEFAULT_AUTOMATION_POLICY.detectionCeiling,
    pauseOnJam: legacy.pauseOnJam ?? DEFAULT_AUTOMATION_POLICY.pauseOnJam,
  };
}

function legacyFuelReserve(routes: LogisticsRoute[]): { exotic: number; helium3: number } {
  const reserves = routes.map((route) => (route.automation as LegacyAutomationPolicy | undefined)?.minimumShipReserve);
  return {
    exotic: Math.max(0, ...reserves.map((reserve) => reserve?.exotic ?? 0)),
    helium3: Math.max(0, ...reserves.map((reserve) => reserve?.helium3 ?? 0)),
  };
}

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

export { fabricatorNodeId, extractorNodeId };
