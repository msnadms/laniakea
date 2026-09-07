import { create } from 'zustand';
import type {
  Extractor, LogisticsRoute, RouteEdge, ExtractorKey, Fabricator, Resource,
  FabricatorProductionItem, FabricatorState, MaterialCost, SlotStatus,
  RouteAutomationPolicy, Colony,
} from '../game/types';
import { extractorNodeId, fabricatorNodeId, bufferDepth, RAW_TYPES } from '../game/types';
import { getCraftable } from '../data/upgrades';
import type { FabricatorDelivery } from './extractorStore';
import { useExtractorStore, peekAccumulated, getExtractorMultipliers } from './extractorStore';
import {
  useFabricatorStore,
  slotResourceDemand, slotMaterialDemand, slotStatus, processFabricator,
} from './fabricatorStore';
import type { FeedResult, MaterialBudget, SlotRunResult } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore, computeStorageCap, computeDriveMultiplier, computeMaterialBandwidth, resourceAmount, EXTRACTOR_HOLD_CAPS, DETECTION_HEAT_PER_BAR, decayDetectionHeat, computeDetectionDecayPerMs } from './uiStore';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost } from './travelCosts';
import { getSuperclusterCoords } from '../game/superclusters';
import { OBS_UNIVERSE_RADIUS } from '../game/constants';
import { useColonyStore, colonyDemand, deliverColony, colonyFuelCap, colonyExport, colonyRawExport, usesDistrictModel } from './colonyStore';
import { RARE_RESOURCES } from '../data/rareResources';
const rareIds = new Set(RARE_RESOURCES.map(r => r.id));

const FABRICATOR_PREFIX = 'fabricator:';
export const AUTOMATION_POLL_MS = 60_000;

export const ROUTE_DISPATCH_EXOTIC = 10;
export const ROUTE_DISPATCH_HELIUM = 5;
export const ROUTE_EXOTIC_PER_UNIT = 0.05;
export const ROUTE_HELIUM_PER_UNIT = 0.05;
// Drones fly the DAG one way, so a hop is not priced as the ship's round trip.
export const ROUTE_HOP_DISCOUNT = 0.25;
export const ROUTE_HELIUM_PER_HOP = 4;
export const MIN_DISPATCH_UNITS = 25;
export const AUTOMATION_CATCHUP_PASSES = 50;
export const AUTOMATION_CATCHUP_CREDIT_CAP = 12;
export const MAX_DETECTION_CEILING = 4;

let catchUpDetectionCredit = 0;

export function detectionCatchUpCredit(): number {
  return catchUpDetectionCredit;
}

export const DEFAULT_AUTOMATION_POLICY: RouteAutomationPolicy = {
  dispatchMode: 'fill',
  sourceFillPercent: 70,
  fillAggregate: 'weighted',
  detectionCeiling: 4,
  pauseOnJam: true,
  fuelReserveExotic: 0,
  fuelReserveHelium3: 0,
};

export function resolveAutomationPolicy(route: LogisticsRoute): RouteAutomationPolicy {
  const policy = { ...DEFAULT_AUTOMATION_POLICY, ...(route.automation ?? {}) };
  return { ...policy, detectionCeiling: Math.max(0, Math.min(MAX_DETECTION_CEILING, policy.detectionCeiling)) };
}

export interface NodeGroup {
  nodeId: string;
  extractors: Extractor[];
  fabricatorKeys: string[];
  colonyKeys?: string[];
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
  colonies: Record<string, Colony> = useColonyStore.getState().colonies,
): NodeGroup | null {
  if (nodeId.startsWith('colony:')) {
    const members = Object.values(colonies).filter(c => extractorNodeId(c.galaxySeed, c.systemId) === nodeId.slice(7));
    const rep = members[0];
    if (!rep) return null;
    return { ...rep, nodeId, extractors: [], fabricatorKeys: [], colonyKeys: members.map(c => c.key) };
  }
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

function sameSystem(a: NodeGroup, b: NodeGroup): boolean {
  return a.galaxySeed === b.galaxySeed && a.systemId === b.systemId;
}

function hopExotic(a: NodeGroup, b: NodeGroup): number {
  if (sameSystem(a, b)) return 0;
  if (a.galaxySeed === b.galaxySeed) return galaxyTravelCost(Math.hypot(a.systemX - b.systemX, a.systemY - b.systemY)).exotic;
  if (a.superclusSeed === b.superclusSeed) return superclusterTravelCost(Math.hypot(a.galaxyX - b.galaxyX, a.galaxyY - b.galaxyY)).exotic;
  const from = getSuperclusterCoords(a.superclusSeed);
  const to = getSuperclusterCoords(b.superclusSeed);
  const distance = Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
  return flatTravelCost(100 + Math.round(100 * Math.min(1, distance / (2 * OBS_UNIVERSE_RADIUS)))).exotic;
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
  const adjacent = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    adjacent.get(edge.from)?.push(edge.to);
    adjacent.get(edge.to)?.push(edge.from);
  }
  const seen = new Set([nodes[0]]);
  const queue = [nodes[0]];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacent.get(current) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
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

export const PROBE_ATTENTION_RISK_THRESHOLD = 3;

export function probeAttentionFromRisk(risk: number): number {
  return risk > PROBE_ATTENTION_RISK_THRESHOLD ? 1 : 0;
}

export function routeDetectionRisk(
  _edges: RouteEdge[],
  groups: Map<string, NodeGroup>,
): number {
  const { extractors, nodeEquipped } = useExtractorStore.getState();
  const nearbyExtractors = Object.values(extractors);
  const routeExtractors = [...groups.values()].flatMap((group) => group.extractors);
  let risk = 0;
  for (const routeExtractor of routeExtractors) {
    const localRisk = nearbyExtractors.reduce((sum, extractor) => {
      if (extractor.galaxySeed === routeExtractor.galaxySeed) return sum + 1;
      if (extractor.superclusSeed === routeExtractor.superclusSeed) return sum + 0.5;
      return sum;
    }, 0);
    risk += localRisk * getExtractorMultipliers(routeExtractor.key, nodeEquipped).signalRiskMultiplier;
  }
  return risk;
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
  throughputUnits = 0,
): { exotic: number; helium: number } {
  const groups = resolveNodeGroups(routeNodes(edges), extractors, fabricators);
  if (groups.size === 0) return { exotic: 0, helium: 0 };
  const { driveA, driveB } = useUIStore.getState();
  const [exoticMultiplier, heliumMultiplier] = computeDriveMultiplier(driveA, driveB);
  let hopExoticTotal = 0;
  let billableHops = 0;
  for (const edge of [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))) {
    const from = groups.get(edge.from);
    const to = groups.get(edge.to);
    if (!from || !to || sameSystem(from, to)) continue;
    hopExoticTotal += hopExotic(from, to);
    billableHops += 1;
  }
  return {
    exotic: Math.max(1, Math.round(
      (ROUTE_DISPATCH_EXOTIC + throughputUnits * ROUTE_EXOTIC_PER_UNIT) * exoticMultiplier
      + hopExoticTotal * ROUTE_HOP_DISCOUNT)),
    helium: Math.max(1, Math.round(
      (ROUTE_DISPATCH_HELIUM + throughputUnits * ROUTE_HELIUM_PER_UNIT
        + billableHops * ROUTE_HELIUM_PER_HOP) * heliumMultiplier)),
  };
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
  colonyKeys: string[];
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
  expectedOutputs: MaterialCost;
  expectedEdgeUse: Record<string, { used: number; capacity: number }>;
  shortages: string[];
  throughputUnits: number;
}

export interface RouteWorld {
  colony?(key: string): Colony | undefined;
  feedColony?(key: string, raw: Cargo['raw'], materials: MaterialCost): ReturnType<typeof deliverColony> | undefined;
  withdrawStockpile?(id: string, amount: number): void;
  collectColonyOutput?(key: string): MaterialCost;
  collectColonyRawOutput?(key: string): Cargo['raw'];
  peekExtractor(key: ExtractorKey): number;
  collectExtractor(key: ExtractorKey, max: number): number;
  fabricator(key: string): { fabricator?: Fabricator; state?: FabricatorState };
  feedFabricator(key: string, raw: Cargo['raw'], materials: MaterialCost, budget: MaterialBudget,
    canRouteByproduct: (id: string) => boolean, stockpile: MaterialCost): FeedResult;
  depositRaw(type: Resource['type'], amount: number): number;
  depositMaterial(id: string, amount: number): void;
  readStockpile(): MaterialCost;
  holdRoom(type: Resource['type']): number;
}

export interface TraversalResult {
  order: string[];
  collected: { key: ExtractorKey; amount: number }[];
  endItems: FabricatorProductionItem[];
  carried: MaterialCost;
  materialsMoved: number;
  bandwidth: number;
  stalled: { fabricatorKey: string; status: SlotStatus }[];
  edgeFlows: Record<string, EdgeFlowResult>;
  slotResults: Record<string, SlotRunResult[]>;
  deposited: Cargo;
  heldCargo: Record<string, Cargo>;
  didWork: boolean;
  expectedBatches: number;
  expectedRecipes: string[];
  expectedOutputs: MaterialCost;
  shortages: string[];
  injectedStockpile: number;
  throughputUnits: number;
}

function cloneFabricatorState(state: FabricatorState | undefined): FabricatorState | undefined {
  if (!state) return undefined;
  return { slots: state.slots.map((slot) => ({
    ...slot,
    pendingResources: { ...slot.pendingResources },
    pendingMaterials: { ...slot.pendingMaterials },
    byproducts: { ...slot.byproducts },
  })) };
}

class ShadowWorld implements RouteWorld {
  private readonly colonies: Record<string, Colony> = { ...useColonyStore.getState().colonies };
  colony(key: string) { return this.colonies[key]; }
  collectColonyOutput(key: string) {
    const c = this.colonies[key];
    if (!c) return {};
    const output = colonyExport(c);
    const field = usesDistrictModel(c) ? 'produced' : 'assemblies';
    this.colonies[key] = { ...c, [field]: { ...c[field] } };
    for (const [id, n] of Object.entries(output)) this.colonies[key][field][id] -= n;
    return output;
  }
  collectColonyRawOutput(key: string) {
    const c = this.colonies[key];
    if (!c) return {};
    const output = colonyRawExport(c);
    this.colonies[key] = { ...c, supplies: { ...c.supplies } };
    for (const [type, amount] of Object.entries(output)) this.colonies[key].supplies[type as Resource['type']] = (this.colonies[key].supplies[type as Resource['type']] ?? 0) - (amount ?? 0);
    return output;
  }
  feedColony(key: string, raw: Cargo['raw'], materials: MaterialCost) {
    if (!this.colonies[key]) return;
    const result = deliverColony(this.colonies[key], raw, materials, Date.now());
    this.colonies[key] = result.colony;
    return result;
  }
  withdrawStockpile(id: string, amount: number) { this.stockpile[id] = (this.stockpile[id] ?? 0) - amount; }
  private readonly extractors: Record<string, Extractor>;
  private readonly fabricators: Record<string, Fabricator>;
  private readonly available: Record<string, number>;
  private readonly states: Record<string, FabricatorState>;
  private readonly hold: Record<Resource['type'], number>;
  private readonly cap: number;
  private readonly stockpile: MaterialCost;

  constructor(
    extractors: Record<string, Extractor>,
    fabricators: Record<string, Fabricator>,
    fabricatorStates: Record<string, FabricatorState>,
    stockpile: MaterialCost,
    ui: ReturnType<typeof useUIStore.getState>,
  ) {
    this.extractors = extractors;
    this.fabricators = fabricators;
    this.available = Object.fromEntries(Object.entries(extractors).map(([key, extractor]) => [key, peekAccumulated(extractor)]));
    this.states = Object.fromEntries(Object.entries(fabricatorStates).map(([key, state]) => [key, cloneFabricatorState(state)!]));
    this.stockpile = { ...stockpile };
    this.cap = computeStorageCap(ui.storageA);
    this.hold = Object.fromEntries(RAW_TYPES.map((type) => [type, resourceAmount(ui, type)])) as Record<Resource['type'], number>;
  }

  peekExtractor(key: string) { return this.available[key] ?? 0; }
  collectExtractor(key: string, max: number) {
    const amount = Math.min(this.available[key] ?? 0, Math.max(0, max));
    this.available[key] = Math.max(0, (this.available[key] ?? 0) - amount);
    return amount;
  }
  fabricator(key: string) { return { fabricator: this.fabricators[key], state: this.states[key] }; }
  feedFabricator(key: string, raw: Cargo['raw'], materials: MaterialCost, budget: MaterialBudget,
    canRouteByproduct: (id: string) => boolean, stockpile: MaterialCost) {
    const fabricator = this.fabricators[key];
    const result = processFabricator(this.states[key]?.slots ?? [], fabricator?.tier, raw, materials, {
      stockpile, stockpileBudget: budget, canRouteByproduct, fillMode: fabricator?.fillMode,
    });
    this.states[key] = { slots: result.slots };
    for (const [id, amount] of Object.entries(result.consumedStockpile)) this.stockpile[id] = Math.max(0, (this.stockpile[id] ?? 0) - amount);
    return result;
  }
  depositRaw(type: Resource['type'], amount: number) {
    const accepted = Math.min(Math.max(0, amount), type === 'alienMatter' ? Infinity : Math.max(0, this.cap - this.hold[type]));
    this.hold[type] += accepted;
    return accepted;
  }
  depositMaterial(id: string, amount: number) { this.stockpile[id] = (this.stockpile[id] ?? 0) + amount; }
  readStockpile() { return { ...this.stockpile }; }
  holdRoom(type: Resource['type']) { return type === 'alienMatter' ? Infinity : Math.max(0, this.cap - this.hold[type]); }
}

class LiveWorld implements RouteWorld {
  colony(key: string) { return useColonyStore.getState().colonies[key]; }
  collectColonyOutput(key: string) {
    const c = this.colony(key);
    if (!c) return {};
    const output = colonyExport(c);
    const field = usesDistrictModel(c) ? 'produced' : 'assemblies';
    const remaining = { ...c[field] };
    for (const [id, n] of Object.entries(output)) remaining[id] -= n;
    if (Object.keys(output).length) useColonyStore.setState(s => ({ colonies: { ...s.colonies, [key]: { ...c, [field]: remaining } } }));
    return output;
  }
  collectColonyRawOutput(key: string) {
    const c = this.colony(key);
    if (!c) return {};
    const output = colonyRawExport(c);
    const supplies = { ...c.supplies };
    for (const [type, amount] of Object.entries(output)) supplies[type as Resource['type']] = (supplies[type as Resource['type']] ?? 0) - (amount ?? 0);
    if (Object.keys(output).length) useColonyStore.setState(state => ({ colonies: { ...state.colonies, [key]: { ...c, supplies } } }));
    return output;
  }
  feedColony(key: string, raw: Cargo['raw'], materials: MaterialCost) {
    const c = this.colony(key);
    if (!c) return;
    const result = deliverColony(c, raw, materials, Date.now());
    if (result.changed) useColonyStore.setState(s => ({ colonies: { ...s.colonies, [key]: result.colony } }));
    return result;
  }
  withdrawStockpile(id: string, amount: number) {
    const field = rareIds.has(id) ? 'rares' : 'materials';
    useStockpileStore.setState(s => ({ [field]: { ...s[field], [id]: (s[field][id] ?? 0) - amount } }));
  }
  private readonly extractors: Record<string, Extractor>;
  private readonly fabricators: Record<string, Fabricator>;
  constructor(
    extractors: Record<string, Extractor>,
    fabricators: Record<string, Fabricator>,
  ) {
    this.extractors = extractors;
    this.fabricators = fabricators;
  }
  peekExtractor(key: string) { return this.extractors[key] ? peekAccumulated(this.extractors[key]) : 0; }
  collectExtractor(key: string, max: number) { return useExtractorStore.getState().collectExtractor(key, max); }
  fabricator(key: string) {
    const store = useFabricatorStore.getState();
    return { fabricator: this.fabricators[key], state: store.fabricatorStates[key] };
  }
  feedFabricator(key: string, raw: Cargo['raw'], materials: MaterialCost, budget: MaterialBudget,
    canRouteByproduct: (id: string) => boolean, stockpile: MaterialCost) {
    return useFabricatorStore.getState().feedFabricator(key, raw, materials, budget, canRouteByproduct, stockpile);
  }
  depositRaw(type: Resource['type'], amount: number) { return useUIStore.getState().depositCargo(type, amount); }
  depositMaterial(id: string, amount: number) {
    if (rareIds.has(id)) useStockpileStore.getState().addRare(id, amount);
    else useStockpileStore.getState().addMaterial(id, amount);
  }
  readStockpile() { const s = useStockpileStore.getState(); return { ...s.materials, ...s.rares }; }
  holdRoom(type: Resource['type']) {
    const ui = useUIStore.getState();
    return type === 'alienMatter' ? Infinity : Math.max(0, computeStorageCap(ui.storageA) - resourceAmount(ui, type));
  }
}

type Reachability = Map<string, Map<string, Set<string>>>;

function buildDemandReachability(
  edges: RouteEdge[],
  rawDemand: Map<string, Cargo['raw']>,
  materialDemand: Map<string, MaterialCost>,
): Reachability {
  const result: Reachability = new Map();
  const build = (kind: 'raw' | 'material', id: string, targets: string[]) => {
    const cargoKey = `${kind}:${id}`;
    const byNode = new Map<string, Set<string>>();
    const incomingByNode = new Map<string, RouteEdge[]>();
    for (const edge of edges) {
      const allowed = kind === 'raw' ? edgeAllowsRaw(edge, id as Resource['type']) : edgeAllowsMaterial(edge, id);
      if (!allowed) continue;
      const incoming = incomingByNode.get(edge.to) ?? [];
      incoming.push(edge);
      incomingByNode.set(edge.to, incoming);
    }
    for (const incoming of incomingByNode.values()) incoming.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
    for (const target of [...targets].sort()) {
      const seen = new Set([target]);
      const queue = [target];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of incomingByNode.get(current) ?? []) if (!seen.has(edge.from)) { seen.add(edge.from); queue.push(edge.from); }
      }
      for (const node of seen) {
        const reachable = byNode.get(node) ?? new Set<string>();
        reachable.add(target);
        byNode.set(node, reachable);
      }
    }
    result.set(cargoKey, byNode);
  };
  for (const type of RAW_TYPES) build('raw', type, [...rawDemand].filter(([, demand]) => (demand[type] ?? 0) > 0).map(([target]) => target));
  const materialIds = new Set([...materialDemand.values()].flatMap((demand) => Object.keys(demand)));
  for (const id of [...materialIds].sort()) build('material', id, [...materialDemand].filter(([, demand]) => (demand[id] ?? 0) > 0).map(([target]) => target));
  return result;
}

export function runRouteTraversal(
  route: LogisticsRoute,
  groups: Map<string, NodeGroup>,
  edges: RouteEdge[],
  world: RouteWorld,
  bandwidth: number,
): TraversalResult {
  const order = topoOrder([...groups.keys()], edges) ?? [];
  const rawDemand = new Map<string, Cargo['raw']>();
  const materialDemand = new Map<string, MaterialCost>();
  for (const [nodeId, group] of groups) {
    const raw: Cargo['raw'] = {};
    const materials: MaterialCost = {};
    for (const key of group.colonyKeys ?? []) {
      const c = world.colony?.(key);
      if (!c) continue;
      const demand = colonyDemand(c);
      for (const [id, n] of Object.entries(demand.raw)) raw[id as Resource['type']] = (raw[id as Resource['type']] ?? 0) + (n ?? 0);
      for (const [id, n] of Object.entries(demand.materials)) materials[id] = (materials[id] ?? 0) + n;
    }
    for (const key of group.fabricatorKeys) {
      const { fabricator, state } = world.fabricator(key);
      const depth = bufferDepth(fabricator?.tier);
      for (const slot of state?.slots ?? []) {
        const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
        if (!recipe) continue;
        for (const [type, amount] of Object.entries(slotResourceDemand(slot, recipe, depth))) raw[type as Resource['type']] = (raw[type as Resource['type']] ?? 0) + (amount ?? 0);
        for (const [id, amount] of Object.entries(slotMaterialDemand(slot, recipe, depth))) materials[id] = (materials[id] ?? 0) + amount;
      }
    }
    rawDemand.set(nodeId, raw);
    materialDemand.set(nodeId, materials);
  }
  const reachability = buildDemandReachability(edges, rawDemand, materialDemand);
  const targetsFor = (kind: 'raw' | 'material', id: string, nodeId: string) => reachability.get(`${kind}:${id}`)?.get(nodeId) ?? new Set<string>();
  const reachableDemand = (demands: Map<string, Cargo['raw'] | MaterialCost>, kind: 'raw' | 'material', nodeId: string, id: string) =>
    [...targetsFor(kind, id, nodeId)].reduce((sum, target) => sum + ((demands.get(target) as Record<string, number> | undefined)?.[id] ?? 0), 0);
  const remainingCollectionDemand = new Map([...rawDemand].map(([target, demand]) => [target, { ...demand }]));
  const claimCollection = (nodeId: string, type: Resource['type'], amount: number) => {
    let left = amount;
    for (const target of [...targetsFor('raw', type, nodeId)].sort()) {
      if (left <= 0) break;
      const demand = remainingCollectionDemand.get(target)!;
      const take = Math.min(left, demand[type] ?? 0);
      demand[type] = Math.max(0, (demand[type] ?? 0) - take);
      left -= take;
    }
    return amount - left;
  };

  const incoming = new Map<string, Cargo>();
  const heldCargo: Record<string, Cargo> = Object.fromEntries(Object.entries(route.heldCargo ?? {}).map(
    ([nodeId, cargo]) => [nodeId, { raw: { ...(cargo.raw ?? {}) }, materials: { ...(cargo.materials ?? {}) } }],
  ));
  const remainingStockpile = world.readStockpile();
  const reservedHold = Object.fromEntries(RAW_TYPES.map((type) => [type, 0])) as Record<Resource['type'], number>;
  const edgeFlows: Record<string, EdgeFlowResult> = {};
  for (const edge of edges) edgeFlows[edgeKey(edge)] = { from: edge.from, to: edge.to, capacity: edgeCapacity(edge, bandwidth), used: 0, raw: {}, materials: {}, rejected: {} };
  const outgoingByNode = new Map<string, RouteEdge[]>();
  const incomingByNode = new Map<string, RouteEdge[]>();
  for (const node of order) {
    outgoingByNode.set(node, edges.filter((edge) => edge.from === node).sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))));
    incomingByNode.set(node, edges.filter((edge) => edge.to === node).sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))));
  }
  const collected: TraversalResult['collected'] = [];
  const endItems: FabricatorProductionItem[] = [];
  const carried: MaterialCost = {};
  const stalled: TraversalResult['stalled'] = [];
  const slotResults: Record<string, SlotRunResult[]> = {};
  const deposited = emptyCargo();
  const expectedRecipes = new Set<string>();
  const expectedOutputs: MaterialCost = {};
  const shortages: string[] = [];
  let expectedBatches = 0;
  let injectedStockpile = 0;
  let didWork = false;

  const deposit = (cargo: Cargo) => {
    const rejected = emptyCargo();
    let accepted = false;
    for (const type of RAW_TYPES) {
      const amount = cargo.raw[type] ?? 0;
      if (amount <= 0) continue;
      const stored = world.depositRaw(type, amount);
      if (stored > 0) { accepted = true; deposited.raw[type] = (deposited.raw[type] ?? 0) + stored; }
      if (amount > stored) rejected.raw[type] = amount - stored;
    }
    for (const [id, amount] of Object.entries(cargo.materials)) if (amount > 0) {
      world.depositMaterial(id, amount);
      deposited.materials[id] = (deposited.materials[id] ?? 0) + amount;
      accepted = true;
    }
    return { rejected, accepted };
  };

  for (const nodeId of order) {
    const group = groups.get(nodeId)!;
    const cargo = incoming.get(nodeId) ?? emptyCargo();
    const restoredHeld = heldCargo[nodeId];
    if (restoredHeld) {
      mergeCargo(cargo, restoredHeld);
      for (const [type, amount] of Object.entries(restoredHeld.raw)) claimCollection(nodeId, type as Resource['type'], amount ?? 0);
      delete heldCargo[nodeId];
    }
    const beganWithHeldCargo = !!restoredHeld && cargoHasValues(restoredHeld);
    const outgoing = outgoingByNode.get(nodeId) ?? [];
    if (outgoing.length > 0) for (const key of group.colonyKeys ?? []) {
      const rawOutput = world.collectColonyRawOutput?.(key) ?? {};
      for (const [type, amount] of Object.entries(rawOutput)) {
        cargo.raw[type as Resource['type']] = (cargo.raw[type as Resource['type']] ?? 0) + (amount ?? 0);
        didWork = true;
      }
      const output = world.collectColonyOutput?.(key) ?? {};
      for (const [id, n] of Object.entries(output)) {
        cargo.materials[id] = (cargo.materials[id] ?? 0) + n;
        carried[id] = (carried[id] ?? 0) + n;
        didWork = true;
      }
    }

    for (const extractor of [...group.extractors].sort((a, b) => a.key.localeCompare(b.key))) {
      const type = extractor.resourceType;
      const available = Math.max(0, world.peekExtractor(extractor.key) - Math.max(0, extractor.reserve ?? 0));
      const demand = reachableDemand(remainingCollectionDemand, 'raw', nodeId, type);
      const room = Math.max(0, world.holdRoom(type) - reservedHold[type]);
      const canHold = outgoing.some((edge) => edgeAllowsRaw(edge, type) && edge.overflow === 'hold');
      const amount = world.collectExtractor(extractor.key, Math.min(available, room + demand + (canHold ? available : 0)));
      if (amount <= 0) continue;
      cargo.raw[type] = (cargo.raw[type] ?? 0) + amount;
      collected.push({ key: extractor.key, amount });
      reservedHold[type] += Math.max(0, amount - claimCollection(nodeId, type, amount));
      didWork = true;
    }

    for (const key of [...group.fabricatorKeys].sort()) {
      const incomingEdges = incomingByNode.get(nodeId) ?? [];
      const incomingCapacity = incomingEdges.reduce((sum, edge) => sum + Math.max(0, edgeFlows[edgeKey(edge)].capacity - edgeFlows[edgeKey(edge)].used), 0);
      const injectable: MaterialCost = {};
      for (const [id, amount] of Object.entries(remainingStockpile)) {
        const capacity = incomingEdges.reduce((sum, edge) => sum + (edgeAllowsMaterial(edge, id) ? Math.max(0, edgeFlows[edgeKey(edge)].capacity - edgeFlows[edgeKey(edge)].used) : 0), 0);
        injectable[id] = Math.min(amount, capacity);
      }
      const result = world.feedFabricator(
        key, cargo.raw, cargo.materials, { remaining: incomingCapacity },
        (id) => outgoing.length === 0 || outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow !== 'hold'),
        injectable,
      );
      slotResults[key] = result.slotResults;
      if (result.changed) didWork = true;
      for (const [type, amount] of Object.entries(result.consumed)) cargo.raw[type as Resource['type']] = Math.max(0, (cargo.raw[type as Resource['type']] ?? 0) - (amount ?? 0));
      for (const [id, amount] of Object.entries(result.consumedCarried)) cargo.materials[id] = Math.max(0, (cargo.materials[id] ?? 0) - amount);
      for (const [id, amount] of Object.entries(result.consumedStockpile)) {
        const candidates = incomingEdges.filter((edge) => edgeAllowsMaterial(edge, id)).map((edge) => ({ edge, flow: edgeFlows[edgeKey(edge)], demand: Number.POSITIVE_INFINITY, explicit: true }));
        for (const [candidate, count] of allocateUnits(amount, candidates, true)) {
          candidate.flow.used += count;
          candidate.flow.materials[id] = (candidate.flow.materials[id] ?? 0) + count;
          remainingStockpile[id] = Math.max(0, (remainingStockpile[id] ?? 0) - count);
          injectedStockpile += count;
        }
      }
      for (const item of result.readyItems) {
        expectedOutputs[item.upgradeId] = (expectedOutputs[item.upgradeId] ?? 0) + item.count;
        if (item.category === 'material' || item.category === 'rare') {
          cargo.materials[item.upgradeId] = (cargo.materials[item.upgradeId] ?? 0) + item.count;
          carried[item.upgradeId] = (carried[item.upgradeId] ?? 0) + item.count;
        } else endItems.push(item);
      }
      for (const slotResult of result.slotResults) {
        if (slotResult.batches > 0) {
          expectedBatches += slotResult.batches;
          const recipe = slotResult.targetUpgradeId ? getCraftable(slotResult.targetUpgradeId) : undefined;
          if (recipe) expectedRecipes.add(recipe.name);
        }
        if (slotResult.status === 'starved') {
          const recipe = slotResult.targetUpgradeId ? getCraftable(slotResult.targetUpgradeId) : undefined;
          const name = world.fabricator(key).fabricator?.planetName ?? 'Fabricator';
          if (recipe) shortages.push(`${name}: ${recipe.name}`);
        }
      }
      result.statuses.forEach((status) => { if (status === 'starved' || status === 'jammed') stalled.push({ fabricatorKey: key, status }); });
    }

    for (const key of [...(group.colonyKeys ?? [])].sort()) {
      const c = world.colony?.(key);
      if (!c) continue;
      // Cargo already on the route wins; remaining demand draws the stockpile only
      // through incoming edges, sharing their material bandwidth with fabricators.
      const demand = colonyDemand(c);
      const supplied = { ...cargo.materials };
      const injected: MaterialCost = {};
      const injectionPlan: { flow: EdgeFlowResult; id: string; take: number }[] = [];
      for (const [id, wanted] of Object.entries(demand.materials)) {
        let left = Math.min(Math.max(0, wanted - (supplied[id] ?? 0)), remainingStockpile[id] ?? 0);
        for (const edge of incomingByNode.get(nodeId) ?? []) {
          if (!edgeAllowsMaterial(edge, id)) continue;
          const flow = edgeFlows[edgeKey(edge)];
          const planned = injectionPlan.reduce((n, entry) => entry.flow === flow ? n + entry.take : n, 0);
          const take = Math.min(left, Math.max(0, flow.capacity - flow.used - planned));
          if (take <= 0) continue;
          injectionPlan.push({ flow, id, take });
          supplied[id] = (supplied[id] ?? 0) + take;
          injected[id] = (injected[id] ?? 0) + take;
          left -= take;
        }
      }
      const result = world.feedColony?.(key, cargo.raw, supplied);
      if (!result) continue;
      for (const { flow, id, take } of injectionPlan) {
        flow.used += take;
        flow.materials[id] = (flow.materials[id] ?? 0) + take;
        remainingStockpile[id] -= take;
      }
      if (result.changed) didWork = true;
      for (const [id, n] of Object.entries(result.consumedRaw)) cargo.raw[id as Resource['type']] = Math.max(0, (cargo.raw[id as Resource['type']] ?? 0) - (n ?? 0));
      for (const [id, n] of Object.entries(result.consumedMaterials)) cargo.materials[id] = Math.max(0, (cargo.materials[id] ?? 0) - (n - (injected[id] ?? 0)));
      for (const [id, n] of Object.entries(injected)) { world.withdrawStockpile?.(id, n); injectedStockpile += n; }
    }

    if (outgoing.length === 0) {
      const depositedAtSink = deposit(cargo);
      if (beganWithHeldCargo && depositedAtSink.accepted) didWork = true;
      if (cargoHasValues(depositedAtSink.rejected)) heldCargo[nodeId] = depositedAtSink.rejected;
      continue;
    }
    const shares = new Map(outgoing.map((edge) => [edgeKey(edge), emptyCargo()]));
    for (const type of RAW_TYPES) {
      const transferable = cargo.raw[type] ?? 0;
      if (transferable <= 0) continue;
      const candidates = outgoing.filter((edge) => edgeAllowsRaw(edge, type)).map((edge) => ({
        edge,
        flow: edgeFlows[edgeKey(edge)],
        demand: edge.overflow === 'hold' ? Number.POSITIVE_INFINITY : reachableDemand(rawDemand, 'raw', edge.to, type),
        explicit: edge.overflow === 'hold' || (edge.allowedRaw !== undefined && edge.allowedRaw.includes(type)),
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
        edge, flow: edgeFlows[edgeKey(edge)], demand: reachableDemand(materialDemand, 'material', edge.to, id), explicit: edge.allowedMaterials !== undefined && edge.allowedMaterials.includes(id),
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
      for (const edge of outgoing) {
        const flow = edgeFlows[edgeKey(edge)];
        if (!edgeAllowsMaterial(edge, id)) { flow.rejected[id] = (flow.rejected[id] ?? 0) + transferable; continue; }
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
      (outgoing.some((edge) => edgeAllowsRaw(edge, type) && edge.overflow === 'hold') ? held : spill).raw[type] = amount;
    }
    for (const [id, amount] of Object.entries(cargo.materials)) {
      if (amount <= 0) continue;
      (outgoing.some((edge) => edgeAllowsMaterial(edge, id) && edge.overflow === 'hold') ? held : spill).materials[id] = amount;
    }
    const depositResult = deposit(spill);
    if (beganWithHeldCargo && depositResult.accepted) didWork = true;
    mergeCargo(held, depositResult.rejected);
    if (cargoHasValues(held)) heldCargo[nodeId] = held;
  }

  const materialsMoved = Object.values(edgeFlows).reduce((sum, flow) => sum + flow.used, 0);
  const throughputUnits = collected.reduce((sum, entry) => sum + entry.amount, 0) + injectedStockpile;
  return {
    order, collected, endItems, carried, materialsMoved, bandwidth, stalled, edgeFlows, slotResults,
    deposited, heldCargo, didWork, expectedBatches, expectedRecipes: [...expectedRecipes], expectedOutputs,
    shortages: [...new Set(shortages)], injectedStockpile, throughputUnits,
  };
}

interface PreviewCacheEntry {
  colonies: Record<string, Colony>;
  rares: MaterialCost;
  route: LogisticsRoute;
  extractors: Record<string, Extractor>;
  fabricators: Record<string, Fabricator>;
  fabricatorStates: Record<string, FabricatorState>;
  stockpile: MaterialCost;
  nodeEquipped: Record<string, [string | null, string | null]>;
  uiKey: string;
  groups: Map<string, NodeGroup>;
  traversal: TraversalResult;
}

const previewCache = new Map<string, PreviewCacheEntry>();

function previewTraversal(route: LogisticsRoute, force = false): { groups: Map<string, NodeGroup>; traversal: TraversalResult } {
  const extractors = useExtractorStore.getState().extractors;
  const nodeEquipped = useExtractorStore.getState().nodeEquipped;
  const { fabricators, fabricatorStates } = useFabricatorStore.getState();
  const stockpile = useStockpileStore.getState().materials;
  const rares = useStockpileStore.getState().rares;
  const colonies = useColonyStore.getState().colonies;
  const ui = useUIStore.getState();
  const uiKey = [ui.storageA, ui.storageB, ui.logisticsA, ui.logisticsB, ...RAW_TYPES.map((type) => resourceAmount(ui, type))].join('|');
  const cached = previewCache.get(route.id);
  if (!force && cached?.route === route && cached.colonies === colonies && cached.rares === rares && cached.extractors === extractors
    && cached.fabricators === fabricators && cached.fabricatorStates === fabricatorStates
    && cached.stockpile === stockpile && cached.nodeEquipped === nodeEquipped && cached.uiKey === uiKey) {
    return cached;
  }
  const groups = resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
  const edges = route.edges.filter((edge) => groups.has(edge.from) && groups.has(edge.to));
  const bandwidth = computeMaterialBandwidth(ui.logisticsA, ui.logisticsB);
  const traversal = runRouteTraversal(
    route, groups, edges,
    new ShadowWorld(extractors, fabricators, fabricatorStates, { ...stockpile, ...rares }, ui),
    bandwidth,
  );
  const entry = { route, extractors, fabricators, fabricatorStates, stockpile, rares, colonies, nodeEquipped, uiKey, groups, traversal };
  previewCache.set(route.id, entry);
  return entry;
}

function optimizedRoutePreview(route: LogisticsRoute, force = false): RoutePreview {
  const extractors = useExtractorStore.getState().extractors;
  const fabricators = useFabricatorStore.getState().fabricators;
  const nodes = routeNodes(route.edges);
  const { groups, traversal } = previewTraversal(route, force);
  const islands = routeIslandNodes(route.edges);
  const valid = routeIsValid(route.edges) && groups.size === nodes.length;
  const policy = resolveAutomationPolicy(route);
  const risk = routeDetectionRisk(route.edges, groups);
  const attentionIncrease = Math.max(0, probeAttentionFromRisk(risk) - catchUpDetectionCredit);
  const ui = useUIStore.getState();
  const cost = computeRouteCost(route.edges, extractors, fabricators, traversal.throughputUnits);
  const affordable = !!routeSponsor(groups, cost) || (ui.exoticMatter - cost.exotic >= policy.fuelReserveExotic
    && ui.helium3Reserves - cost.helium >= policy.fuelReserveHelium3);
  let reason = 'Ready';
  const storedHeat = Math.floor(ui.detectionHeat / DETECTION_HEAT_PER_BAR) === ui.detectionRating
    ? ui.detectionHeat
    : ui.detectionRating * DETECTION_HEAT_PER_BAR;
  const effectiveHeat = decayDetectionHeat(
    storedHeat, ui.lastDetectionChangeAt, Date.now(), computeDetectionDecayPerMs(ui.logisticsA),
  ).detectionHeat;
  const hasConfiguredRecipe = routeFabricatorKeys(groups).some((key) =>
    (useFabricatorStore.getState().fabricatorStates[key]?.slots ?? []).some((slot) => !!slot.targetUpgradeId));
  const tank = computeStorageCap(ui.storageA);
  const exceedsTank = cost.exotic > tank || cost.helium > tank;
  if (!valid) reason = islands.length > 0 ? 'Disconnected route islands' : 'Incomplete or cyclic route';
  else if (!affordable) reason = exceedsTank ? 'Route costs more fuel than the hold can carry' : 'Insufficient route fuel';
  else if (effectiveHeat + attentionIncrease > policy.detectionCeiling * DETECTION_HEAT_PER_BAR) reason = 'Probe attention ceiling would be exceeded';
  else if (!traversal.didWork) reason = 'Waiting for useful cargo';
  else if (policy.dispatchMode === 'batch' && traversal.expectedBatches === 0 && hasConfiguredRecipe) reason = 'Waiting for a complete recipe batch';
  return {
    valid, canRun: reason === 'Ready', reason, cost, detectionRisk: risk, islandNodes: islands,
    expectedBatches: traversal.expectedBatches,
    expectedRecipes: traversal.expectedRecipes,
    expectedOutputs: traversal.expectedOutputs,
    expectedEdgeUse: Object.fromEntries(Object.entries(traversal.edgeFlows).map(([key, flow]) => [key, {
      used: flow.used + Object.values(flow.raw).reduce((sum, amount) => sum + (amount ?? 0), 0),
      capacity: flow.capacity,
    }])),
    shortages: traversal.shortages,
    throughputUnits: traversal.throughputUnits,
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

function routeSponsor(groups: Map<string, NodeGroup>, cost: { exotic: number; helium: number }): Colony | undefined {
  return [...groups.values()].flatMap(g => g.colonyKeys ?? []).sort()
    .map(key => useColonyStore.getState().colonies[key])
    .find(c => c && c.population > 0 && colonyFuelCap(c) > 0
      && (c.supplies.exotic ?? 0) >= cost.exotic && (c.supplies['helium-3'] ?? 0) >= cost.helium);
}

function executeRouteDispatch(id: string, automatic: boolean): DispatchResult | false {
  const logistics = useLogisticsStore.getState();
  if (useUIStore.getState().checkDetectionLethal()) return false;
  const route = logistics.routes.find((candidate) => candidate.id === id);
  if (!route) return false;
  const preview = optimizedRoutePreview(route, true);
  const currentUI = useUIStore.getState();
  const manualPolicyOverride = !automatic && (
    preview.reason === 'Probe attention ceiling would be exceeded'
    || (preview.reason === 'Insufficient route fuel'
      && currentUI.exoticMatter >= preview.cost.exotic
      && currentUI.helium3Reserves >= preview.cost.helium)
  );
  if (!preview.canRun && !manualPolicyOverride) {
    if (!automatic) currentUI.triggerHudFlash();
    return false;
  }

  const extractors = useExtractorStore.getState().extractors;
  const { fabricators } = useFabricatorStore.getState();
  const groups = resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
  const edges = route.edges.filter((edge) => groups.has(edge.from) && groups.has(edge.to));
  const bandwidth = computeMaterialBandwidth(currentUI.logisticsA, currentUI.logisticsB);
  const sponsor = routeSponsor(groups, preview.cost);
  const traversal = runRouteTraversal(route, groups, edges, new LiveWorld(extractors, fabricators), bandwidth);
  if (!traversal.didWork) return false;
  const liveSponsor = sponsor ? useColonyStore.getState().colonies[sponsor.key] : undefined;
  const sponsorCanPay = !!liveSponsor && liveSponsor.population > 0
    && (liveSponsor.supplies.exotic ?? 0) >= preview.cost.exotic
    && (liveSponsor.supplies['helium-3'] ?? 0) >= preview.cost.helium;

  // The useful-work decision is made by the dry run. Charge exactly once, after
  // the traversal succeeds, so a failed dispatch can never need a clamped refund.
  if (sponsorCanPay) useColonyStore.setState(s => {
    const colony = s.colonies[liveSponsor!.key];
    if (!colony) return {};
    return { colonies: { ...s.colonies, [colony.key]: { ...colony, supplies: {
      ...colony.supplies, exotic: (colony.supplies.exotic ?? 0) - preview.cost.exotic,
      'helium-3': (colony.supplies['helium-3'] ?? 0) - preview.cost.helium,
    } } } };
  });
  else useUIStore.getState().consumeResources(preview.cost.exotic, preview.cost.helium);
  const deliveries = traversal.endItems.length > 0
    ? useExtractorStore.getState().receiveFabricatorItems(traversal.endItems)
    : [];
  const attentionIncrease = Math.max(0, probeAttentionFromRisk(preview.detectionRisk) - catchUpDetectionCredit);
  if (attentionIncrease > 0) useUIStore.getState().raiseDetectionHeat(attentionIncrease);
  catchUpDetectionCredit = Math.max(0, catchUpDetectionCredit - probeAttentionFromRisk(preview.detectionRisk));
  const result: DispatchResult = {
    colonyKeys: [...groups.values()].flatMap(g => g.colonyKeys ?? []),
    order: traversal.order,
    collected: traversal.collected,
    deliveries,
    carried: traversal.carried,
    materialsMoved: traversal.materialsMoved,
    bandwidth,
    stalled: traversal.stalled,
    edgeFlows: traversal.edgeFlows,
    slotResults: traversal.slotResults,
    deposited: traversal.deposited,
    detectionRisk: preview.detectionRisk,
  };
  useLogisticsStore.setState((state) => ({
    lastRuns: { ...state.lastRuns, [id]: result },
    routes: state.routes.map((candidate) => candidate.id === id ? { ...candidate, heldCargo: traversal.heldCargo } : candidate),
  }));
  previewCache.delete(id);
  const jam = traversal.stalled.find((entry) => entry.status === 'jammed');
  if (jam) {
    const name = fabricators[jam.fabricatorKey]?.planetName ?? 'Fabricator';
    useUIStore.getState().triggerHudNotify(`${name.toUpperCase()} JAMMED — BYPRODUCT HAS NO ROUTE`);
    if (automatic && resolveAutomationPolicy(route).pauseOnJam) useLogisticsStore.getState().setRouteActive(id, false);
  }
  return result;
}

interface LogisticsState {
  routes: LogisticsRoute[];
  lastRuns: Record<string, DispatchResult>;
  automationNotices: Record<string, string>;
  addRoute: (route: LogisticsRoute) => void;
  updateRoute: (id: string, patch: Partial<LogisticsRoute>) => void;
  removeRoute: (id: string) => void;
  setRouteActive: (id: string, active: boolean) => void;
  flushHeldCargo: (id: string, nodeId: string) => boolean;
  previewRoute: (id: string) => RoutePreview | null;
  dispatchRoute: (id: string, automatic?: boolean) => DispatchResult | false;
  runAutomation: () => DispatchResult[];
  catchUpAutomation: (offlineMs?: number) => DispatchResult[];
  restoreRoutes: (routes: LogisticsRoute[]) => void;
}

export const useLogisticsStore = create<LogisticsState>()((set, get) => ({
  routes: [], lastRuns: {}, automationNotices: {},
  addRoute: (route) => set((state) => ({ routes: [...state.routes, route] })),
  updateRoute: (id, patch) => set((state) => ({ routes: state.routes.map((route) => route.id === id ? { ...route, ...patch } : route) })),
  removeRoute: (id) => {
    previewCache.delete(id);
    set((state) => ({ routes: state.routes.filter((route) => route.id !== id) }));
  },
  setRouteActive: (id, active) => set((state) => ({ routes: state.routes.map((route) => route.id === id ? { ...route, active } : route) })),
  flushHeldCargo: (id, nodeId) => {
    const route = get().routes.find((candidate) => candidate.id === id);
    const cargo = route?.heldCargo?.[nodeId];
    if (!route || !cargo) return false;
    const rejected = emptyCargo();
    let moved = false;
    for (const [type, amount] of Object.entries(cargo.raw ?? {})) {
      const accepted = useUIStore.getState().depositCargo(type as Resource['type'], amount ?? 0);
      if (accepted > 0) moved = true;
      if ((amount ?? 0) > accepted) rejected.raw[type as Resource['type']] = (amount ?? 0) - accepted;
    }
    for (const [materialId, amount] of Object.entries(cargo.materials ?? {})) if (amount > 0) {
      if (rareIds.has(materialId)) useStockpileStore.getState().addRare(materialId, amount);
      else useStockpileStore.getState().addMaterial(materialId, amount);
      moved = true;
    }
    set((state) => ({ routes: state.routes.map((candidate) => {
      if (candidate.id !== id) return candidate;
      const heldCargo = { ...(candidate.heldCargo ?? {}) };
      if (cargoHasValues(rejected)) heldCargo[nodeId] = rejected;
      else delete heldCargo[nodeId];
      return { ...candidate, heldCargo };
    }) }));
    previewCache.delete(id);
    return moved;
  },
  previewRoute: (id) => {
    const route = get().routes.find((candidate) => candidate.id === id);
    return route ? optimizedRoutePreview(route) : null;
  },

  dispatchRoute: (id, automatic = false) => executeRouteDispatch(id, automatic),

  runAutomation: () => {
    const results: DispatchResult[] = [];
    for (const route of get().routes.filter((candidate) => candidate.active)) {
      const policy = resolveAutomationPolicy(route);
      const extractors = useExtractorStore.getState().extractors;
      const { fabricators, fabricatorStates } = useFabricatorStore.getState();
      const groups = resolveNodeGroups(routeNodes(route.edges), extractors, fabricators);
      const sources = routeExtractorKeys(groups).map((key) => extractors[key]);
      const fills = sources.map((source) => {
        const { storageMultiplier } = getExtractorMultipliers(source.key, useExtractorStore.getState().nodeEquipped);
        return 100 * peekAccumulated(source) / Math.max(1, EXTRACTOR_HOLD_CAPS[useUIStore.getState().storageB] * storageMultiplier);
      });
      const demandWeights = sources.map((source) => {
        const from = extractorNodeId(source.galaxySeed, source.systemId);
        let demand = 0;
        for (const [nodeId, group] of groups) for (const key of group.fabricatorKeys) {
          const depth = bufferDepth(fabricators[key]?.tier);
          for (const slot of fabricatorStates[key]?.slots ?? []) {
            const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
            if (!recipe || !cargoReaches(route.edges, from, nodeId, { kind: 'raw', id: source.resourceType })) continue;
            demand += slotResourceDemand(slot, recipe, depth)[source.resourceType] ?? 0;
          }
        }
        return demand;
      });
      const weightTotal = demandWeights.reduce((sum, weight) => sum + weight, 0);
      const fill = sources.length === 0 ? 100
        : policy.fillAggregate === 'all' ? Math.min(...fills)
          : policy.fillAggregate === 'any' ? Math.max(...fills)
            : weightTotal > 0
              ? fills.reduce((sum, value, index) => sum + value * demandWeights[index], 0) / weightTotal
              : fills.reduce((sum, value) => sum + value, 0) / fills.length;
      if (fill < policy.sourceFillPercent) continue;
      const preview = optimizedRoutePreview(route, true);
      if (!preview.canRun) {
        if (get().automationNotices[route.id] !== preview.reason && (preview.reason.includes('jam') || preview.reason.includes('fuel') || preview.reason.includes('attention'))) {
          useUIStore.getState().triggerHudNotify(`${route.name.toUpperCase()} HOLDING — ${preview.reason.toUpperCase()}`);
          set((state) => ({ automationNotices: { ...state.automationNotices, [route.id]: preview.reason } }));
        }
        continue;
      }
      if (preview.throughputUnits < MIN_DISPATCH_UNITS && preview.expectedBatches === 0) continue;
      const result = get().dispatchRoute(route.id, true);
      if (result) {
        results.push(result);
        set((state) => ({ automationNotices: { ...state.automationNotices, [route.id]: '' } }));
      }
    }
    return results;
  },

  catchUpAutomation: (offlineMs = 0) => {
    const ui = useUIStore.getState();
    catchUpDetectionCredit = Math.min(
      AUTOMATION_CATCHUP_CREDIT_CAP,
      Math.max(0, offlineMs) * computeDetectionDecayPerMs(ui.logisticsA),
    );
    const results: DispatchResult[] = [];
    try {
      for (let pass = 0; pass < AUTOMATION_CATCHUP_PASSES; pass += 1) {
        const batch = get().runAutomation();
        if (batch.length === 0) break;
        results.push(...batch);
      }
    } finally {
      catchUpDetectionCredit = 0;
    }
    return results;
  },

  restoreRoutes: (routes) => {
    previewCache.clear();
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
    fillAggregate: legacy.fillAggregate ?? 'any',
    detectionCeiling: legacy.detectionCeiling ?? DEFAULT_AUTOMATION_POLICY.detectionCeiling,
    pauseOnJam: legacy.pauseOnJam ?? DEFAULT_AUTOMATION_POLICY.pauseOnJam,
    fuelReserveExotic: legacy.fuelReserveExotic ?? 0,
    fuelReserveHelium3: legacy.fuelReserveHelium3 ?? 0,
  };
}

export function fabricatorNodeStatus(
  fabricatorKeys: string[],
  fabricatorStates: Record<string, FabricatorState>,
  fabricators: Record<string, Fabricator>,
): SlotStatus {
  const recent = useFabricatorStore.getState().lastRun;
  const tieBreak: SlotStatus[] = ['flowing', 'ready', 'starved', 'jammed', 'idle'];
  const counts = new Map<SlotStatus, number>();
  for (const key of fabricatorKeys) {
    const depth = bufferDepth(fabricators[key]?.tier);
    for (let index = 0; index < (fabricatorStates[key]?.slots ?? []).length; index++) {
      const slot = fabricatorStates[key].slots[index];
      const recipe = slot.targetUpgradeId ? getCraftable(slot.targetUpgradeId) : undefined;
      const status = recent[key]?.[index]?.status ?? slotStatus(slot, recipe, depth);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  }
  const candidates = tieBreak.filter((status) => status !== 'idle' && (counts.get(status) ?? 0) > 0);
  if (candidates.length === 0) return 'idle';
  return candidates.reduce((best, status) => (counts.get(status) ?? 0) > (counts.get(best) ?? 0) ? status : best);
}

export { fabricatorNodeId, extractorNodeId };
