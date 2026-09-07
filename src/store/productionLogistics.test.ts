import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import type { Extractor, Fabricator, FabricatorProductionSlot, LogisticsRoute, Resource } from '../game/types';
import type { NodeGroup } from './logisticsStore';
import { COST_KEY_TO_RESOURCE, extractorNodeId, fabricatorNodeId, makeEmptyFabricatorSlot } from '../game/types';
import { processFabricator, useFabricatorStore } from './fabricatorStore';
import { HOUR } from './colonyStore';
import { DETECTION_CROSSING_POINTS, allocateEdgeCargo, cargoReaches, computeRouteCost, routeDetectionRisk, routeIslandNodes, routeIsValid, routeNodes, topoOrder, useLogisticsStore } from './logisticsStore';
import { computeDetectionDecayPerMs, computeStorageCap, decayDetectionHeat, DETECTION_HEAT_DECAY_PER_MS } from './uiStore';
import { generatePlanets, generateSystemLayout } from '../game/planetGen';
import { useExtractorStore } from './extractorStore';
import { useStockpileStore } from './stockpileStore';
import { getCraftable } from '../data/upgrades';
import { useUIStore } from './uiStore';
import { migrateSavedFabricatorSlots } from '../firebase/fabricators';
import { migratePendingUpgrades } from '../firebase/extractorUpgrades';

function slot(targetUpgradeId: string, priority = 0): FabricatorProductionSlot {
  return { ...makeEmptyFabricatorSlot(), targetUpgradeId, priority };
}

function output(result: ReturnType<typeof processFabricator>, id: string): number {
  return result.readyItems.filter((item) => item.upgradeId === id).reduce((sum, item) => sum + item.count, 0);
}

function feed(...recipes: [string, number][]): Partial<Record<Resource['type'], number>> {
  const raw: Partial<Record<Resource['type'], number>> = {};
  for (const [id, batches] of recipes) {
    for (const [key, amount] of Object.entries(getCraftable(id)?.cost ?? {})) {
      const type = COST_KEY_TO_RESOURCE[key];
      raw[type] = (raw[type] ?? 0) + amount * batches;
    }
  }
  return raw;
}

function unitCost(id: string, key: string): number {
  return (getCraftable(id)?.cost as Record<string, number>)[key];
}

describe('instant fixed-point production', () => {
  it('processes every feasible batch and is inert without new input', () => {
    const first = processFabricator([slot('graphene_lattice')], 1, feed(['graphene_lattice', 2]), {});
    expect(first.slotResults[0].batches).toBe(2);
    expect(output(first, 'graphene_lattice')).toBe(4);

    const second = processFabricator(first.slots, 1, {}, {});
    expect(second.changed).toBe(false);
    expect(second.readyItems).toEqual([]);
  });

  it('retains an insufficient partial batch', () => {
    const short = unitCost('graphene_lattice', 'alloys') - 1;
    const result = processFabricator([slot('graphene_lattice')], 1,
      { ...feed(['graphene_lattice', 1]), alloys: short }, {});
    expect(result.slotResults[0].batches).toBe(0);
    expect(result.slots[0].pendingResources.alloys).toBe(short);
    expect(result.slotResults[0].missingResources.alloys).toBe(1);
  });

  it('maps alternate recipes to their canonical output', () => {
    const result = processFabricator([slot('graphene_lattice_carbide')], 1, feed(['graphene_lattice_carbide', 1]), {});
    expect(output(result, 'graphene_lattice')).toBe(3);
    expect(output(result, 'graphene_lattice_carbide')).toBe(0);
  });

  it('completes a multi-tier chain in one ordered traversal', () => {
    const tierOne = processFabricator([slot('graphene_lattice')], 1, feed(['graphene_lattice', 1]), {});
    const tierTwo = processFabricator(
      [slot('hea_billet')], 1,
      { alloys: 900, metallicHydrogen: 200 },
      { graphene_lattice: output(tierOne, 'graphene_lattice'), boron_ceramic: 1 },
    );
    expect(tierTwo.slotResults[0].batches).toBe(1);
    expect(output(tierTwo, 'hea_billet')).toBe(2);
  });

  it('consumes a co-located byproduct during the same fixed-point visit', () => {
    const result = processFabricator([
      slot('deuterium_slush', 0), slot('boron_ceramic', 1),
      slot('silica_aerogel', 2), slot('tritium_getter', 3),
    ], 1, feed(['deuterium_slush', 3], ['boron_ceramic', 3], ['silica_aerogel', 3], ['tritium_getter', 1]), {});
    expect(result.slotResults[3].batches).toBe(1);
    expect(output(result, 'tritium_getter')).toBe(1);
    expect(result.slots.every((entry) => (entry.byproducts.tritium_residue ?? 0) === 0)).toBe(true);
  });

  it('jams when a full byproduct buffer has no valid route', () => {
    const result = processFabricator(
      [slot('deuterium_slush')], 1,
      feed(['deuterium_slush', 4]), {},
      { canRouteByproduct: () => false },
    );
    expect(result.slotResults[0].batches).toBe(3);
    expect(result.slotResults[0].status).toBe('jammed');
    expect(result.slots[0].byproducts.tritium_residue).toBe(3);
  });

  it('routes an unconsumed byproduct when an eligible destination exists', () => {
    const result = processFabricator(
      [slot('deuterium_slush')], 1,
      feed(['deuterium_slush', 1]), {},
      { canRouteByproduct: () => true },
    );
    expect(output(result, 'tritium_residue')).toBe(1);
    expect(result.slots[0].byproducts.tritium_residue ?? 0).toBe(0);
  });

  it('processes past the local buffer once the byproduct has somewhere to go', () => {
    const routed = processFabricator(
      [slot('deuterium_slush')], 1,
      feed(['deuterium_slush', 10]), {},
      { canRouteByproduct: () => true },
    );
    const trapped = processFabricator(
      [slot('deuterium_slush')], 1,
      feed(['deuterium_slush', 10]), {},
      { canRouteByproduct: () => false },
    );
    expect(routed.slotResults[0].batches).toBe(10);
    expect(output(routed, 'tritium_residue')).toBe(10);
    expect(trapped.slotResults[0].batches).toBe(3);
    expect(trapped.slotResults[0].status).toBe('jammed');
  });

  it('keeps a byproduct no current recipe emits instead of destroying it', () => {
    const orphan = { ...slot('graphene_lattice'), byproducts: { tritium_residue: 7 } };
    const result = processFabricator([orphan], 1, {}, {}, { canRouteByproduct: () => false });
    expect(result.slots[0].byproducts.tritium_residue).toBe(7);
    expect(result.slotResults[0].status).toBe('jammed');
  });

  it('returns a retargeted slot buffer without losing what the hold cannot take', () => {
    const fabricator: Fabricator = {
      key: 'refund', tier: 1, galaxySeed: 21, systemId: 1, systemName: 'Refund', planetName: 'Yard',
      builtAt: 1, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useFabricatorStore.setState({
      fabricators: { [fabricator.key]: fabricator },
      fabricatorStates: { [fabricator.key]: { slots: [{ ...slot('graphene_lattice'), pendingResources: { alloys: 300 } }] } },
      lastRun: {},
    });
    useUIStore.setState({ storageA: 0, alloys: computeStorageCap(0) });
    useFabricatorStore.getState().setSlotTarget(fabricator.key, 0, 'boron_ceramic');
    const after = useFabricatorStore.getState().fabricatorStates[fabricator.key].slots[0];
    expect(after.targetUpgradeId).toBe('boron_ceramic');
    expect(after.pendingResources.alloys).toBe(300);

    useUIStore.setState({ alloys: 0 });
    useFabricatorStore.getState().setSlotTarget(fabricator.key, 0, 'graphene_lattice');
    expect(useUIStore.getState().alloys).toBe(300);
    expect(useFabricatorStore.getState().fabricatorStates[fabricator.key].slots[0].pendingResources.alloys ?? 0).toBe(0);
  });

  it('ignores a retarget to the recipe the slot already runs', () => {
    const fabricator: Fabricator = {
      key: 'same', tier: 1, galaxySeed: 22, systemId: 1, systemName: 'Same', planetName: 'Yard',
      builtAt: 1, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useFabricatorStore.setState({
      fabricators: { [fabricator.key]: fabricator },
      fabricatorStates: { [fabricator.key]: { slots: [{ ...slot('graphene_lattice'), pendingResources: { alloys: 300 } }] } },
      lastRun: {},
    });
    useUIStore.setState({ storageA: 0, alloys: 0 });
    useFabricatorStore.getState().setSlotTarget(fabricator.key, 0, 'graphene_lattice');
    expect(useFabricatorStore.getState().fabricatorStates[fabricator.key].slots[0].pendingResources.alloys).toBe(300);
    expect(useUIStore.getState().alloys).toBe(0);
  });

  it('uses stable priorities when slots compete for one input', () => {
    const scarce = { alloys: 3 * unitCost('graphene_lattice', 'alloys'), nutrients: 1000 };
    const grapheneFirst = processFabricator([
      slot('graphene_lattice', 0), slot('silica_aerogel', 1),
    ], 1, scarce, {});
    const silicaFirst = processFabricator([
      slot('graphene_lattice', 1), slot('silica_aerogel', 0),
    ], 1, scarce, {});
    expect(output(grapheneFirst, 'graphene_lattice')).toBe(6);
    expect(output(grapheneFirst, 'silica_aerogel')).toBe(0);
    expect(output(silicaFirst, 'silica_aerogel')).toBe(6);
    expect(output(silicaFirst, 'graphene_lattice')).toBe(0);
  });

  it('spreads a scarce input across slots in shared fill mode', () => {
    const slots = [slot('graphene_lattice', 0), slot('silica_aerogel', 1)];
    const shared = processFabricator(slots, 1, { alloys: 3 * unitCost('graphene_lattice', 'alloys'), nutrients: 1000 }, {}, { fillMode: 'shared' });
    expect(output(shared, 'graphene_lattice')).toBeGreaterThan(0);
    expect(output(shared, 'silica_aerogel')).toBeGreaterThan(0);
  });

  it('still buffers to depth in shared mode once nothing else can progress', () => {
    const partial = { alloys: 100_000 };
    const shared = processFabricator([slot('graphene_lattice')], 1, { ...partial }, {}, { fillMode: 'shared' });
    const priority = processFabricator([slot('graphene_lattice')], 1, { ...partial }, {});
    expect(shared.slots[0].pendingResources.alloys).toBe(priority.slots[0].pendingResources.alloys);
    expect(shared.consumed.alloys).toBe(priority.consumed.alloys);
  });
});

describe('production save migration', () => {
  it('credits the timed craft schema used immediately before instant production', () => {
    const migrated = migrateSavedFabricatorSlots([{
      ...slot('graphene_lattice'),
      inProduction: { upgradeId: 'graphene_lattice', category: 'material' as const },
    }]);
    expect(migrated.legacyProductionItems).toEqual([{
      upgradeId: 'graphene_lattice', category: 'material', count: 1,
    }]);
    expect('inProduction' in migrated.state.slots[0]).toBe(false);
  });

  it('credits queued legacy outputs instead of dropping them', () => {
    expect(migratePendingUpgrades([
      { id: 'old', upgradeId: 'signal_dampener', availableAt: Date.now(), category: 'extractor' },
    ])).toEqual([{ upgradeId: 'signal_dampener', category: 'extractor', count: 1 }]);
  });
});

describe('deterministic connected route graphs', () => {
  it('rejects disconnected DAG islands and identifies them', () => {
    const edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
    expect(routeIsValid(edges)).toBe(false);
    expect(routeIslandNodes(edges)).toEqual(['c', 'd']);
  });

  it('produces the same topological order regardless of edge storage order', () => {
    const edges = [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }];
    const shuffled = [edges[2], edges[1], edges[0]];
    expect(topoOrder(['d', 'c', 'b', 'a'], edges)).toEqual(['a', 'b', 'c', 'd']);
    expect(topoOrder(['b', 'd', 'a', 'c'], shuffled)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('enforces filters and per-edge bandwidth', () => {
    const allocation = allocateEdgeCargo([
      { from: 'a', to: 'b', allowedMaterials: ['graphene_lattice'], materialDraw: 2 },
      { from: 'a', to: 'c', allowedMaterials: [], materialDraw: 10 },
    ], 5, { kind: 'material', id: 'graphene_lattice' }, { b: 5, c: 5 }, 10);
    expect(allocation.allocations['a->b']).toBe(2);
    expect(allocation.allocations['a->c']).toBeUndefined();
    expect(allocation.leftover).toBe(3);
  });

  it('splits by downstream demand however its edges are stored', () => {
    const edges = [
      { from: 'a', to: 'b', allowedRaw: ['alloys' as const] },
      { from: 'a', to: 'c', allowedRaw: ['alloys' as const] },
    ];
    const even = allocateEdgeCargo(edges, 6, { kind: 'raw', id: 'alloys' }, { b: 10, c: 10 }, 10);
    expect(even.allocations).toEqual({ 'a->b': 3, 'a->c': 3 });
    expect(allocateEdgeCargo([...edges].reverse(), 6, { kind: 'raw', id: 'alloys' }, { b: 10, c: 10 }, 10)).toEqual(even);

    const unfiltered = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }];
    const lopsided = allocateEdgeCargo(unfiltered, 6, { kind: 'raw', id: 'alloys' }, { b: 2, c: 10 }, 10);
    expect(lopsided.allocations).toEqual({ 'a->b': 2, 'a->c': 4 });
    expect(lopsided.leftover).toBe(0);
  });

  it('orders a diamond identically however its edges are stored', () => {
    const edges = [
      { from: 'src', to: 'left' }, { from: 'src', to: 'right' },
      { from: 'left', to: 'sink' }, { from: 'right', to: 'sink' },
    ];
    const expected = ['left', 'right', 'sink', 'src'].sort();
    for (const order of [edges, [...edges].reverse(), [edges[2], edges[0], edges[3], edges[1]]]) {
      expect(routeIsValid(order)).toBe(true);
      expect(topoOrder(routeNodes(order), order)).toEqual(['src', 'left', 'right', 'sink']);
      expect(routeNodes(order)).toEqual(expected);
    }
  });

  it('splits a diamond by downstream demand rather than evenly', () => {
    const edges = [{ from: 'src', to: 'left' }, { from: 'src', to: 'right' }];
    const allocation = allocateEdgeCargo(
      edges, 9, { kind: 'material', id: 'graphene_lattice' }, { left: 6, right: 3 }, 20,
    );
    expect(allocation.allocations).toEqual({ 'src->left': 6, 'src->right': 3 });
    expect(allocation.leftover).toBe(0);
  });

  it('does not treat a consumer as reachable through a filtered edge', () => {
    const edges = [
      { from: 'source', to: 'branch' },
      { from: 'branch', to: 'consumer', allowedMaterials: [] as string[] },
    ];
    expect(cargoReaches(edges, 'source', 'consumer', { kind: 'material', id: 'graphene_lattice' })).toBe(false);
  });
});

describe('rare source generation', () => {
  it('guarantees neutron-star matter in every neutron-star system', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const planets = generatePlanets(generateSystemLayout(seed, 'N'));
      expect(planets.some((planet) => planet.resources?.some((resource) => resource.type === 'neutronStarMatter'))).toBe(true);
    }
  });
});

describe('route dispatch integration', () => {
  afterEach(() => {
    vi.useRealTimers();
    useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {}, lastRun: {} });
    useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });
    useLogisticsStore.setState({ routes: [], lastRuns: {}, automationNotices: {} });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({ detectionRating: 0, detectionHeat: 0, destroyed: false, lastDetectionChangeAt: 0 });
  });

  it('accumulates and continuously decays fractional detection heat', () => {
    const start = 1_000_000;
    useUIStore.setState({ detectionRating: 0, detectionHeat: 0, lastDetectionChangeAt: start });
    useUIStore.getState().raiseDetectionHeat(0.34);
    useUIStore.getState().raiseDetectionHeat(0.34);
    useUIStore.getState().raiseDetectionHeat(0.34);
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(1.02);
    expect(useUIStore.getState().detectionRating).toBe(1);

    const decayed = decayDetectionHeat(1.02, start, start + 30_000);
    expect(decayed.detectionHeat).toBeCloseTo(1.02 - 30_000 * DETECTION_HEAT_DECAY_PER_MS);
    expect(decayed.lastDetectionChangeAt).toBe(start + 30_000);
  });

  it('carries fractional route heat across several dispatches until a bar lands', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const fabricators = Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
      const id = index + 1;
      const fab: Fabricator = {
        key: `heat-fab-${id}`, tier: 1, galaxySeed: 84, systemId: id,
        systemName: `Heat ${id}`, planetName: `Heat ${id}`, builtAt: 1,
        systemX: id, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
      };
      return [fab.key, fab];
    }));
    useFabricatorStore.setState({
      fabricators,
      fabricatorStates: Object.fromEntries(Object.keys(fabricators).map((key) => [key, { slots: [] }])),
      lastRun: {},
    });
    const nodes = Array.from({ length: 5 }, (_, index) => fabricatorNodeId(84, index + 1));
    const edges = nodes.slice(1).map((to, index) => ({
      from: nodes[index], to, allowedMaterials: ['graphene_lattice'],
    }));
    useUIStore.setState({
      exoticMatter: 10_000, helium3Reserves: 10_000,
      detectionHeat: 0, detectionRating: 0, lastDetectionChangeAt: Date.now(),
    });
    useLogisticsStore.setState({ routes: [{ id: 'heat', name: 'Heat', edges }], lastRuns: {}, automationNotices: {} });

    for (let dispatch = 0; dispatch < 5; dispatch++) {
      useLogisticsStore.getState().updateRoute('heat', {
        heldCargo: { [nodes[0]]: { raw: {}, materials: { graphene_lattice: 1 } } },
      });
      expect(useLogisticsStore.getState().dispatchRoute('heat')).not.toBe(false);
    }
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(1);
    expect(useUIStore.getState().detectionRating).toBe(1);
  });

  it('sheds heat faster as the logistics fleet grows', () => {
    const start = 2_000_000;
    const base = decayDetectionHeat(3, start, start + 60_000, computeDetectionDecayPerMs(0));
    const fleet = decayDetectionHeat(3, start, start + 60_000, computeDetectionDecayPerMs(4));
    expect(base.detectionHeat).toBeCloseTo(2.5);
    expect(fleet.detectionHeat).toBeCloseTo(1.5);

    useUIStore.setState({ detectionHeat: 3, detectionRating: 3, lastDetectionChangeAt: start, logisticsA: 4 });
    vi.useFakeTimers();
    vi.setSystemTime(start + 60_000);
    useUIStore.getState().tickDetectionDecay();
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(1.5);
    useUIStore.setState({ logisticsA: 0 });
  });

  it('spends banked offline decay as catch-up detection credit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-02-01T00:00:00Z'));
    const now = Date.now();
    const extractor: Extractor = {
      key: 'credit-source', galaxySeed: 85, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: now - 50 * HOUR, lastCollectedAt: now - 50 * HOUR,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const fabricators = Object.fromEntries([2, 3, 4, 5].map((id) => {
      const fab: Fabricator = {
        key: `credit-fab-${id}`, tier: 1, galaxySeed: 85, systemId: id,
        systemName: `Credit ${id}`, planetName: `Credit ${id}`, builtAt: 1,
        systemX: id, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
      };
      return [fab.key, fab];
    }));
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({
      fabricators,
      fabricatorStates: Object.fromEntries(Object.keys(fabricators).map((key) => [key, { slots: [] }])),
      lastRun: {},
    });
    const nodes = [extractorNodeId(85, 1), ...[2, 3, 4, 5].map((id) => fabricatorNodeId(85, id))];
    const edges = nodes.slice(1).map((to, index) => ({ from: nodes[index], to }));
    useUIStore.setState({
      exoticMatter: 10_000, helium3Reserves: 10_000, logisticsA: 4, logisticsB: 0, storageA: 4, storageB: 4,
      detectionHeat: 0, detectionRating: 0, lastDetectionChangeAt: now,
    });
    const route: LogisticsRoute = {
      id: 'credit', name: 'Credit', edges, active: true,
      automation: { dispatchMode: 'fill', sourceFillPercent: 1, fillAggregate: 'any', detectionCeiling: 4, pauseOnJam: false },
    };
    useLogisticsStore.setState({ routes: [route], lastRuns: {}, automationNotices: {} });
    expect(useLogisticsStore.getState().previewRoute('credit')?.detectionRisk).toBeCloseTo(0.2);

    useLogisticsStore.getState().catchUpAutomation(30 * 60_000);
    expect(useUIStore.getState().detectionHeat).toBe(0);

    useExtractorStore.setState({
      extractors: { [extractor.key]: { ...extractor, lastCollectedAt: now - 50 * HOUR } },
    });
    useUIStore.setState({ lastDetectionChangeAt: Date.now() });
    useLogisticsStore.getState().catchUpAutomation(0);
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(0.2);
    useUIStore.setState({ logisticsA: 0, logisticsB: 0, storageA: 0, storageB: 0 });
  });

  it('purge clears the underlying detection heat', () => {
    useUIStore.setState({
      detectionHeat: 3.75, detectionRating: 3, lastDetectionChangeAt: Date.now(), lastPurgeAt: 0,
      exoticMatter: 10_000, helium3Reserves: 10_000, destroyed: false,
    });
    expect(useUIStore.getState().purgeDetection()).toBe(true);
    expect(useUIStore.getState().detectionHeat).toBe(0);
    expect(useUIStore.getState().detectionRating).toBe(0);
  });

  it('railgun suppression removes heat rather than only the displayed bars', () => {
    const now = Date.now();
    useUIStore.setState({
      detectionHeat: 2.5, detectionRating: 2, lastDetectionChangeAt: now,
      lastFireAt: now - 60_000, railgunAmmo: 20, destroyed: false,
    });
    useUIStore.getState().tickRailgunSuppression();
    // Two shots land, but the first killed at observation range and its wreckage half-suppresses.
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(1);
    expect(useUIStore.getState().alienMatter).toBe(1);
    useUIStore.setState({
      detectionHeat: 1.5, detectionRating: 1, lastDetectionChangeAt: now,
      lastFireAt: now - 30_000, railgunAmmo: 20, alienMatter: 0,
    });
    useUIStore.getState().tickRailgunSuppression();
    expect(useUIStore.getState().detectionHeat).toBeCloseTo(0.5);
    expect(useUIStore.getState().detectionRating).toBe(0);
    expect(useUIStore.getState().alienMatter).toBe(0);
  });

  it('previews and dispatches hold-bound cargo in batch mode', () => {
    const now = Date.now();
    const extractor: Extractor = {
      key: 'hold-only-source', galaxySeed: 81, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: now - 50 * HOUR, lastCollectedAt: now - 50 * HOUR,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const sink: Fabricator = {
      key: 'hold-only-sink', tier: 1, galaxySeed: 81, systemId: 2, systemName: 'Sink', planetName: 'Depot',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({ fabricators: { [sink.key]: sink }, fabricatorStates: { [sink.key]: { slots: [] } }, lastRun: {} });
    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000, alloys: 0, storageA: 0 });
    const edge = { from: extractorNodeId(81, 1), to: fabricatorNodeId(81, 2), overflow: 'hold' as const };
    useLogisticsStore.setState({ routes: [{
      id: 'hold-only', name: 'Hold only', edges: [edge],
      automation: { dispatchMode: 'batch', sourceFillPercent: 50, fillAggregate: 'weighted', detectionCeiling: 4, pauseOnJam: true },
    }], lastRuns: {}, automationNotices: {} });

    const preview = useLogisticsStore.getState().previewRoute('hold-only');
    expect(preview?.canRun).toBe(true);
    expect(preview?.expectedEdgeUse[`${edge.from}->${edge.to}`].used).toBeGreaterThan(0);
    expect(preview!.cost.exotic).toBeGreaterThan(computeRouteCost([edge], useExtractorStore.getState().extractors, useFabricatorStore.getState().fabricators).exotic);
    expect(useLogisticsStore.getState().dispatchRoute('hold-only')).not.toBe(false);
  });

  it('does not let a full irrelevant source trigger demand-weighted automation', () => {
    const now = Date.now();
    const source = (key: string, systemId: number, type: Extractor['resourceType'], age: number): Extractor => ({
      key, galaxySeed: 82, systemId, systemName: key, planetName: key,
      resourceType: type, rate: 1, placedAt: now - age, lastCollectedAt: now - age,
      systemX: systemId, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    });
    const relevant = source('relevant', 1, 'alloys', 100 * HOUR);
    const irrelevant = source('irrelevant', 2, 'exotic', 300 * HOUR);
    const fab: Fabricator = {
      key: 'weighted-fab', tier: 1, galaxySeed: 82, systemId: 3, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 3, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { relevant, irrelevant }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({
      fabricators: { [fab.key]: fab },
      fabricatorStates: { [fab.key]: { slots: [slot('graphene_lattice')] } },
      lastRun: {},
    });
    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000, alloys: 0, nutrients: 0, storageA: 0 });
    const edges = [
      { from: extractorNodeId(82, 1), to: fabricatorNodeId(82, 3) },
      { from: extractorNodeId(82, 2), to: fabricatorNodeId(82, 3) },
    ];
    useLogisticsStore.setState({ routes: [{
      id: 'weighted', name: 'Weighted', active: true, edges,
      automation: { dispatchMode: 'fill', sourceFillPercent: 50, fillAggregate: 'weighted', detectionCeiling: 4, pauseOnJam: true },
    }], lastRuns: {}, automationNotices: {} });
    expect(useLogisticsStore.getState().runAutomation()).toEqual([]);

    useLogisticsStore.getState().updateRoute('weighted', { automation: {
      dispatchMode: 'fill', sourceFillPercent: 50, fillAggregate: 'any', detectionCeiling: 4, pauseOnJam: true,
    } });
    expect(useLogisticsStore.getState().runAutomation()).toHaveLength(1);
  });

  it('does not charge fuel when a capped hold rejects all stranded cargo', () => {
    const now = Date.now();
    const extractor: Extractor = {
      key: 'idle-source', galaxySeed: 83, systemId: 1, systemName: 'Idle', planetName: 'Idle',
      resourceType: 'alloys', rate: 1, placedAt: now, lastCollectedAt: now,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const sink: Fabricator = {
      key: 'idle-sink', tier: 1, galaxySeed: 83, systemId: 2, systemName: 'Sink', planetName: 'Sink',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({ fabricators: { [sink.key]: sink }, fabricatorStates: { [sink.key]: { slots: [] } }, lastRun: {} });
    const cap = computeStorageCap(0);
    useUIStore.setState({ exoticMatter: cap, helium3Reserves: cap, alloys: cap, storageA: 0 });
    const sinkNode = fabricatorNodeId(83, 2);
    useLogisticsStore.setState({ routes: [{
      id: 'rejected', name: 'Rejected',
      edges: [{ from: extractorNodeId(83, 1), to: sinkNode }],
      heldCargo: { [sinkNode]: { raw: { alloys: 20 }, materials: {} } },
    }], lastRuns: {}, automationNotices: {} });
    const before = { exotic: useUIStore.getState().exoticMatter, helium: useUIStore.getState().helium3Reserves };
    expect(useLogisticsStore.getState().dispatchRoute('rejected')).toBe(false);
    expect(useUIStore.getState().exoticMatter).toBe(before.exotic);
    expect(useUIStore.getState().helium3Reserves).toBe(before.helium);
  });

  it('finishes an ordered multi-site chain and does not charge an unchanged rerun', () => {
    const makeFabricator = (key: string, systemId: number): Fabricator => ({
      key, tier: 1, galaxySeed: 7, systemId, systemName: `System ${systemId}`,
      planetName: `World ${systemId}`, builtAt: 1, systemX: systemId, systemY: 0,
      galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    });
    const first = makeFabricator('fab-a', 1);
    const second = makeFabricator('fab-b', 2);
    useFabricatorStore.setState({
      fabricators: { [first.key]: first, [second.key]: second },
      fabricatorStates: {
        [first.key]: { slots: [{
          ...slot('graphene_lattice'), pendingResources: { alloys: 400, nutrients: 250 },
        }] },
        [second.key]: { slots: [{
          ...slot('hea_billet'),
          pendingResources: { alloys: 900, metallicHydrogen: 200 },
          pendingMaterials: { boron_ceramic: 1 },
        }] },
      },
      lastRun: {},
    });
    useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000, detectionRating: 0, logisticsA: 1, logisticsB: 0 });
    const route = {
      id: 'chain', name: 'Chain',
      edges: [{ from: fabricatorNodeId(7, 1), to: fabricatorNodeId(7, 2) }],
    };
    useLogisticsStore.setState({ routes: [route], lastRuns: {}, automationNotices: {} });

    const preview = useLogisticsStore.getState().previewRoute(route.id);
    const result = useLogisticsStore.getState().dispatchRoute(route.id);
    expect(result).not.toBe(false);
    if (result === false) return;
    const committedBatches = Object.values(result.slotResults).flat()
      .reduce((sum, slotResult) => sum + slotResult.batches, 0);
    expect(preview?.expectedBatches).toBe(committedBatches);
    expect(preview?.expectedEdgeUse).toEqual(Object.fromEntries(
      Object.entries(result.edgeFlows).map(([key, flow]) => [key, { used: flow.used, capacity: flow.capacity }]),
    ));
    expect(useStockpileStore.getState().materials.hea_billet).toBe(2);
    const fuelAfterFirst = {
      exotic: useUIStore.getState().exoticMatter,
      helium: useUIStore.getState().helium3Reserves,
    };

    expect(useLogisticsStore.getState().dispatchRoute(route.id)).toBe(false);
    expect(useUIStore.getState().exoticMatter).toBe(fuelAfterFirst.exotic);
    expect(useUIStore.getState().helium3Reserves).toBe(fuelAfterFirst.helium);
  });

  it('does not inject upstream stockpile overflow into a later node during the same run', () => {
    const makeFabricator = (key: string, systemId: number): Fabricator => ({
      key, tier: 1, galaxySeed: 9, systemId, systemName: `System ${systemId}`,
      planetName: `World ${systemId}`, builtAt: 1, systemX: systemId, systemY: 0,
      galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    });
    const first = makeFabricator('overflow-a', 1);
    const second = makeFabricator('overflow-b', 2);
    useFabricatorStore.setState({
      fabricators: { [first.key]: first, [second.key]: second },
      fabricatorStates: {
        [first.key]: { slots: [{ ...slot('graphene_lattice'), pendingResources: {
          alloys: unitCost('graphene_lattice', 'alloys'),
          nutrients: unitCost('graphene_lattice', 'nutrients'),
        } }] },
        [second.key]: { slots: [{
          ...slot('hea_billet'), pendingResources: { alloys: 900, metallicHydrogen: 200 },
          pendingMaterials: { boron_ceramic: 1 },
        }] },
      },
      lastRun: {},
    });
    useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000, detectionRating: 0, logisticsA: 1, logisticsB: 0 });
    const route = {
      id: 'overflow', name: 'Overflow',
      edges: [{
        from: fabricatorNodeId(9, 1), to: fabricatorNodeId(9, 2),
        allowedMaterials: [] as string[], overflow: 'stockpile' as const,
      }],
    };
    useLogisticsStore.setState({ routes: [route], lastRuns: {}, automationNotices: {} });

    expect(useLogisticsStore.getState().dispatchRoute(route.id)).not.toBe(false);
    expect(useStockpileStore.getState().materials.graphene_lattice).toBe(2);
    expect(useStockpileStore.getState().materials.hea_billet ?? 0).toBe(0);
  });

  it('charges stockpile injection against an incoming edge', () => {
    const extractor: Extractor = {
      key: 'source', galaxySeed: 11, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'exotic', rate: 1, placedAt: Date.now(), lastCollectedAt: Date.now(),
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const fabricator: Fabricator = {
      key: 'fab', tier: 1, galaxySeed: 11, systemId: 2, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({
      fabricators: { [fabricator.key]: fabricator },
      fabricatorStates: { [fabricator.key]: { slots: [{
        ...slot('hea_billet'), pendingResources: { alloys: 900, metallicHydrogen: 200 },
      }] } },
      lastRun: {},
    });
    useStockpileStore.getState().restoreStockpile({ graphene_lattice: 2, boron_ceramic: 1 }, {});
    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000, detectionRating: 0, logisticsA: 1, logisticsB: 0 });
    const edge = {
      from: extractorNodeId(11, 1), to: fabricatorNodeId(11, 2), materialDraw: 1,
    };
    useLogisticsStore.setState({ routes: [{ id: 'injection', name: 'Injection', edges: [edge] }], lastRuns: {}, automationNotices: {} });

    const result = useLogisticsStore.getState().dispatchRoute('injection');
    expect(result).not.toBe(false);
    if (result === false) return;
    expect(result.edgeFlows[`${edge.from}->${edge.to}`].used).toBe(1);
    expect(useFabricatorStore.getState().fabricatorStates[fabricator.key].slots[0].pendingMaterials.graphene_lattice).toBe(1);
    expect(useStockpileStore.getState().materials.graphene_lattice).toBe(1);
    expect(useStockpileStore.getState().materials.boron_ceramic).toBe(1);
  });

  it('does not collect the same downstream raw demand from every extractor in a node', () => {
    const now = Date.now();
    const makeExtractor = (key: string, planetName: string): Extractor => ({
      key, galaxySeed: 12, systemId: 1, systemName: 'Mines', planetName,
      resourceType: 'alloys', rate: 1, placedAt: now - 200 * HOUR, lastCollectedAt: now - 200 * HOUR,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    });
    const first = makeExtractor('mine-a', 'A');
    const second = makeExtractor('mine-b', 'B');
    const fabricator: Fabricator = {
      key: 'raw-fab', tier: 1, galaxySeed: 12, systemId: 2, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [first.key]: first, [second.key]: second }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({
      fabricators: { [fabricator.key]: fabricator },
      fabricatorStates: { [fabricator.key]: { slots: [{
        ...slot('graphene_lattice'),
        pendingResources: {
          alloys: 3 * unitCost('graphene_lattice', 'alloys') - 100,
          nutrients: 3 * unitCost('graphene_lattice', 'nutrients'),
        },
      }] } },
      lastRun: {},
    });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({
      exoticMatter: 10_000, helium3Reserves: 10_000, alloys: 5_000,
      detectionRating: 0, logisticsA: 1, logisticsB: 0, storageA: 0,
    });
    useLogisticsStore.setState({ routes: [{
      id: 'shared-demand', name: 'Shared Demand',
      edges: [{ from: extractorNodeId(12, 1), to: fabricatorNodeId(12, 2) }],
    }], lastRuns: {}, automationNotices: {} });

    const result = useLogisticsStore.getState().dispatchRoute('shared-demand');
    expect(result).not.toBe(false);
    if (result === false) return;
    expect(result.collected.reduce((sum, entry) => sum + entry.amount, 0)).toBe(100);
    expect(result.deposited.raw.alloys ?? 0).toBe(0);
  });

  it('spends route risk as detection points, not as a probability roll', () => {
    useUIStore.setState({ detectionRating: 0, lastDetectionChangeAt: Date.now() });
    useUIStore.getState().raiseDetectionBy(2);
    expect(useUIStore.getState().detectionRating).toBe(2);
    useUIStore.getState().raiseDetectionBy(0);
    expect(useUIStore.getState().detectionRating).toBe(2);
    useUIStore.getState().raiseDetectionBy(9);
    expect(useUIStore.getState().detectionRating).toBe(5);
  });

  it('prices traffic density per supercluster, not distance travelled', () => {
    const node = (nodeId: string, superclusSeed: number, systemId: number): NodeGroup => ({
      nodeId, extractors: [], fabricatorKeys: [], galaxySeed: superclusSeed * 10,
      systemId, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed,
    });
    useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });

    const chain = (count: number, superclusSeed: number) => {
      const groups = new Map<string, NodeGroup>();
      for (let i = 0; i <= count; i++) groups.set(`s${superclusSeed}n${i}`, node(`s${superclusSeed}n${i}`, superclusSeed, i));
      const edges = Array.from({ length: count }, (_, i) => ({ from: `s${superclusSeed}n${i}`, to: `s${superclusSeed}n${i + 1}` }));
      return { groups, edges };
    };

    // Continuous heat keeps every local hop visible without the old bar cliff.
    expect(routeDetectionRisk(chain(2, 1).edges, chain(2, 1).groups)).toBeCloseTo(2 / 60);
    expect(routeDetectionRisk(chain(3, 1).edges, chain(3, 1).groups)).toBeCloseTo(6 / 60);
    expect(routeDetectionRisk(chain(6, 1).edges, chain(6, 1).groups)).toBeCloseTo(30 / 60);
    expect(routeDetectionRisk(chain(4, 1).edges, chain(4, 1).groups)).toBeCloseTo(
      2 * routeDetectionRisk(chain(3, 1).edges, chain(3, 1).groups),
    );

    const spread = chain(3, 1);
    for (const [id, group] of chain(3, 2).groups) spread.groups.set(id, group);
    spread.edges.push(...chain(3, 2).edges, { from: 's1n3', to: 's2n0' });
    expect(routeDetectionRisk(spread.edges, spread.groups)).toBeCloseTo(0.1 + 0.1 + DETECTION_CROSSING_POINTS);
  });

  it('floors a fully dampened route at a residual rather than at zero', () => {
    const node = (nodeId: string, systemId: number, extractors: Extractor[]): NodeGroup => ({
      nodeId, extractors, fabricatorKeys: [], galaxySeed: 91,
      systemId, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 9,
    });
    const source = (index: number): Extractor => ({
      key: `masked-${index}`, galaxySeed: 91, systemId: index, systemName: `S${index}`, planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: 1, lastCollectedAt: 1,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 9,
    });
    const hub = fabricatorNodeId(91, 100);
    const extractors = [1, 2, 3, 4].map(source);
    const groups = new Map<string, NodeGroup>([[hub, node(hub, 100, [])]]);
    for (const extractor of extractors) {
      const id = extractorNodeId(91, extractor.systemId);
      groups.set(id, node(id, extractor.systemId, [extractor]));
    }
    const edges = extractors.map((extractor) => ({ from: extractorNodeId(91, extractor.systemId), to: hub }));

    useExtractorStore.setState({
      extractors: Object.fromEntries(extractors.map((extractor) => [extractor.key, extractor])),
      ownedUpgrades: [], nodeEquipped: {},
    });
    const bare = routeDetectionRisk(edges, groups);
    expect(bare).toBeCloseTo(12 / 60);

    useExtractorStore.setState({
      nodeEquipped: Object.fromEntries(extractors.map((extractor) => [extractor.key, ['signal_dampener', null] as [string | null, string | null]])),
    });
    const masked = routeDetectionRisk(edges, groups);
    expect(masked).toBeGreaterThan(0);
    expect(masked).toBeCloseTo(2 * (2 - 1) / 60);
    expect(masked).toBeLessThan(bare / 4);
  });

  it('lets a signal dampener mask the hops incident to its station', () => {
    const extractor: Extractor = {
      key: 'quiet-source', galaxySeed: 71, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: 1, lastCollectedAt: 1,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 7,
    };
    const group = (nodeId: string, systemId: number, extractors: Extractor[]): NodeGroup => ({
      nodeId, extractors, fabricatorKeys: [], galaxySeed: 71,
      systemId, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 7,
    });
    const source = extractorNodeId(71, 1);
    const mid = fabricatorNodeId(71, 2);
    const sink = fabricatorNodeId(71, 3);
    const groups = new Map<string, NodeGroup>([
      [source, group(source, 1, [extractor])],
      [mid, group(mid, 2, [])],
      [sink, group(sink, 3, [])],
    ]);
    const edges = [{ from: source, to: mid }, { from: mid, to: sink }];

    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    expect(routeDetectionRisk(edges, groups)).toBeCloseTo(2 / 60);

    useExtractorStore.setState({ nodeEquipped: { [extractor.key]: ['signal_dampener', null] } });
    const masked = 1.5;
    expect(routeDetectionRisk(edges, groups)).toBeCloseTo(masked * (masked - 1) / 60);
    expect(routeDetectionRisk(edges, groups)).toBeGreaterThan(0);
  });

  it('round-trips edge policies, automation and held cargo through a restore', () => {
    const extractor: Extractor = {
      key: 'policy-source', galaxySeed: 31, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: 1, lastCollectedAt: 1,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const fabricator: Fabricator = {
      key: 'policy-fab', tier: 1, galaxySeed: 31, systemId: 2, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({ fabricators: { [fabricator.key]: fabricator }, fabricatorStates: {}, lastRun: {} });

    const from = extractorNodeId(31, 1);
    const to = fabricatorNodeId(31, 2);
    const saved = {
      id: 'policy', name: 'Policy',
      edges: [{
        from, to,
        allowedRaw: ['alloys' as const], allowedMaterials: ['graphene_lattice'],
        priority: 2, weight: 3, unitCap: 4, overflow: 'hold' as const,
        minimumReserve: { raw: { alloys: 25 }, materials: { graphene_lattice: 1 } },
      }],
      active: true,
      automation: {
        sourceFillPercent: 80, requireRecipeReady: true, detectionCeiling: 2,
        pauseOnJam: false, quiet: true, minimumShipReserve: { exotic: 100, helium3: 50 },
      },
      heldCargo: { [from]: { raw: { alloys: 12 }, materials: { graphene_lattice: 3 } } },
    } as unknown as LogisticsRoute;
    useUIStore.setState({ fuelReserveExotic: 0, fuelReserveHelium3: 0 });
    useLogisticsStore.getState().restoreRoutes([structuredClone(saved)]);
    const restored = useLogisticsStore.getState().routes[0];
    expect(restored.edges).toEqual([{
      from, to,
      allowedRaw: ['alloys'], allowedMaterials: ['graphene_lattice'],
      materialDraw: 4, overflow: 'hold',
    }]);
    expect(restored.automation).toEqual({
      dispatchMode: 'batch', sourceFillPercent: 80, fillAggregate: 'any', detectionCeiling: 2, pauseOnJam: false,
    });
    expect(useUIStore.getState().fuelReserveExotic).toBe(100);
    expect(useUIStore.getState().fuelReserveHelium3).toBe(50);
    expect(restored.heldCargo).toEqual(saved.heldCargo);
    expect(restored.active).toBe(true);
  });

  it('holds an unaffordable automated route active and resumes it after refuelling', () => {
    const now = Date.now();
    const extractor: Extractor = {
      key: 'hold-source', galaxySeed: 41, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: now - 900 * HOUR, lastCollectedAt: now - 900 * HOUR,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const fabricator: Fabricator = {
      key: 'hold-fab', tier: 1, galaxySeed: 41, systemId: 2, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({
      fabricators: { [fabricator.key]: fabricator },
      fabricatorStates: { [fabricator.key]: { slots: [slot('graphene_lattice')] } },
      lastRun: {},
    });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({
      exoticMatter: 0, helium3Reserves: 0, alloys: 0,
      detectionRating: 0, logisticsA: 1, logisticsB: 0, storageA: 0,
    });
    useLogisticsStore.setState({ routes: [{
      id: 'hold', name: 'Hold', active: true,
      edges: [{ from: extractorNodeId(41, 1), to: fabricatorNodeId(41, 2) }],
    }], lastRuns: {}, automationNotices: {} });

    expect(useLogisticsStore.getState().runAutomation()).toEqual([]);
    expect(useLogisticsStore.getState().routes[0].active).toBe(true);
    expect(useLogisticsStore.getState().previewRoute('hold')?.reason).toBe('Insufficient route fuel');

    useUIStore.setState({ exoticMatter: 10_000, helium3Reserves: 10_000 });
    expect(useLogisticsStore.getState().runAutomation()).toHaveLength(1);
  });

  it('names the hold when a route costs more fuel than the ship can ever carry', () => {
    const now = Date.now();
    const far = (systemId: number, galaxyX: number): Extractor => ({
      key: `far-${systemId}`, galaxySeed: 100 + systemId, systemId, systemName: `Far ${systemId}`,
      planetName: `Rock ${systemId}`, resourceType: 'alloys', rate: 1,
      placedAt: now - 900 * HOUR, lastCollectedAt: now - 900 * HOUR,
      systemX: 0, systemY: 0, galaxyX, galaxyY: 0, superclusSeed: 1,
    });
    const sources = Array.from({ length: 24 }, (_, index) => far(index + 1, index * 1800));
    useExtractorStore.setState({
      extractors: Object.fromEntries(sources.map((source) => [source.key, source])),
      ownedUpgrades: [], nodeEquipped: {},
    });
    useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {}, lastRun: {} });
    useStockpileStore.getState().restoreStockpile({}, {});
    useUIStore.setState({
      exoticMatter: 500, helium3Reserves: 500, alloys: 0,
      detectionRating: 0, logisticsA: 1, logisticsB: 0, storageA: 0, driveA: 0, driveB: 0,
      fuelReserveExotic: 0, fuelReserveHelium3: 0,
    });
    const edges = sources.slice(1).map((source) => ({
      from: extractorNodeId(sources[0].galaxySeed, sources[0].systemId),
      to: extractorNodeId(source.galaxySeed, source.systemId),
    }));
    useLogisticsStore.setState({ routes: [{ id: 'sprawl', name: 'Sprawl', active: true, edges }], lastRuns: {}, automationNotices: {} });

    const preview = useLogisticsStore.getState().previewRoute('sprawl');
    expect(preview!.cost.exotic).toBeGreaterThan(computeStorageCap(0));
    expect(preview!.reason).toBe('Route costs more fuel than the hold can carry');

    useUIStore.setState({ storageA: 4 });
    expect(useLogisticsStore.getState().previewRoute('sprawl')!.reason).not.toBe('Route costs more fuel than the hold can carry');
  });

  it('converts legacy ordered route keys into a DAG path', () => {
    const extractor: Extractor = {
      key: 'old-source', galaxySeed: 13, systemId: 1, systemName: 'Source', planetName: 'Mine',
      resourceType: 'alloys', rate: 1, placedAt: 1, lastCollectedAt: 1,
      systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    const fabricator: Fabricator = {
      key: 'old-fab', tier: 1, galaxySeed: 13, systemId: 2, systemName: 'Factory', planetName: 'Forge',
      builtAt: 1, systemX: 1, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1,
    };
    useExtractorStore.setState({ extractors: { [extractor.key]: extractor }, ownedUpgrades: [], nodeEquipped: {} });
    useFabricatorStore.setState({ fabricators: { [fabricator.key]: fabricator }, fabricatorStates: {}, lastRun: {} });

    useLogisticsStore.getState().restoreRoutes([{
      id: 'legacy', name: 'Legacy', edges: [], legacyNodeKeys: [extractor.key, fabricator.key],
    }]);
    expect(useLogisticsStore.getState().routes[0].edges).toEqual([{
      from: extractorNodeId(13, 1), to: fabricatorNodeId(13, 2), overflow: 'stockpile',
    }]);
    expect(useLogisticsStore.getState().routes[0].legacyNodeKeys).toBeUndefined();
  });
});
