import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import type { Fabricator, FabricatorProductionSlot } from '../game/types';
import { fabricatorNodeId, makeEmptyFabricatorSlot } from '../game/types';
import { processFabricator, useFabricatorStore } from './fabricatorStore';
import { allocateEdgeCargo, routeIslandNodes, routeIsValid, topoOrder, useLogisticsStore } from './logisticsStore';
import { generatePlanets, generateSystemLayout } from '../game/planetGen';
import { useExtractorStore } from './extractorStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore } from './uiStore';

function slot(targetUpgradeId: string, priority = 0): FabricatorProductionSlot {
  return { ...makeEmptyFabricatorSlot(), targetUpgradeId, priority };
}

function output(result: ReturnType<typeof processFabricator>, id: string): number {
  return result.readyItems.filter((item) => item.upgradeId === id).reduce((sum, item) => sum + item.count, 0);
}

describe('instant fixed-point production', () => {
  it('processes every feasible batch and is inert without new input', () => {
    const first = processFabricator([slot('graphene_lattice')], 1, { alloys: 800, nutrients: 500 }, {});
    expect(first.slotResults[0].batches).toBe(2);
    expect(output(first, 'graphene_lattice')).toBe(4);

    const second = processFabricator(first.slots, 1, {}, {});
    expect(second.changed).toBe(false);
    expect(second.readyItems).toEqual([]);
  });

  it('retains an insufficient partial batch', () => {
    const result = processFabricator([slot('graphene_lattice')], 1, { alloys: 399, nutrients: 250 }, {});
    expect(result.slotResults[0].batches).toBe(0);
    expect(result.slots[0].pendingResources.alloys).toBe(399);
    expect(result.slotResults[0].missingResources.alloys).toBe(1);
  });

  it('maps alternate recipes to their canonical output', () => {
    const result = processFabricator([slot('graphene_lattice_carbide')], 1, { alloys: 700, 'helium-3': 300 }, {});
    expect(output(result, 'graphene_lattice')).toBe(3);
    expect(output(result, 'graphene_lattice_carbide')).toBe(0);
  });

  it('completes a multi-tier chain in one ordered traversal', () => {
    const tierOne = processFabricator([slot('graphene_lattice')], 1, { alloys: 400, nutrients: 250 }, {});
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
    ], 1, {
      metallicHydrogen: 900, 'helium-3': 1050, alloys: 3600, nutrients: 450,
    }, {});
    expect(result.slotResults[3].batches).toBe(1);
    expect(output(result, 'tritium_getter')).toBe(1);
    expect(result.slots.every((entry) => (entry.byproducts.tritium_residue ?? 0) === 0)).toBe(true);
  });

  it('jams when a full byproduct buffer has no valid route', () => {
    const result = processFabricator(
      [slot('deuterium_slush')], 1,
      { metallicHydrogen: 1200, 'helium-3': 800 }, {},
      { canRouteByproduct: () => false },
    );
    expect(result.slotResults[0].batches).toBe(3);
    expect(result.slotResults[0].status).toBe('jammed');
    expect(result.slots[0].byproducts.tritium_residue).toBe(3);
  });

  it('routes an unconsumed byproduct when an eligible destination exists', () => {
    const result = processFabricator(
      [slot('deuterium_slush')], 1,
      { metallicHydrogen: 300, 'helium-3': 200 }, {},
      { canRouteByproduct: () => true },
    );
    expect(output(result, 'tritium_residue')).toBe(1);
    expect(result.slots[0].byproducts.tritium_residue ?? 0).toBe(0);
  });

  it('uses stable priorities when slots compete for one input', () => {
    const grapheneFirst = processFabricator([
      slot('graphene_lattice', 0), slot('silica_aerogel', 1),
    ], 1, { alloys: 900, nutrients: 1000 }, {});
    const silicaFirst = processFabricator([
      slot('graphene_lattice', 1), slot('silica_aerogel', 0),
    ], 1, { alloys: 900, nutrients: 1000 }, {});
    expect(output(grapheneFirst, 'graphene_lattice')).toBe(4);
    expect(output(grapheneFirst, 'silica_aerogel')).toBe(0);
    expect(output(silicaFirst, 'silica_aerogel')).toBe(6);
    expect(output(silicaFirst, 'graphene_lattice')).toBe(0);
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
      { from: 'a', to: 'b', allowedMaterials: ['graphene_lattice'], unitCap: 2 },
      { from: 'a', to: 'c', allowedMaterials: [], unitCap: 10 },
    ], 5, { kind: 'material', id: 'graphene_lattice' }, { b: 5, c: 5 }, 10);
    expect(allocation.allocations['a->b']).toBe(2);
    expect(allocation.allocations['a->c']).toBeUndefined();
    expect(allocation.leftover).toBe(3);
  });

  it('uses weights deterministically between equal-priority edges', () => {
    const edges = [
      { from: 'a', to: 'b', weight: 1, allowedRaw: ['alloys' as const] },
      { from: 'a', to: 'c', weight: 2, allowedRaw: ['alloys' as const] },
    ];
    const allocation = allocateEdgeCargo(edges, 6, { kind: 'raw', id: 'alloys' }, { b: 10, c: 10 }, 10);
    const shuffled = allocateEdgeCargo([...edges].reverse(), 6, { kind: 'raw', id: 'alloys' }, { b: 10, c: 10 }, 10);
    expect(allocation.allocations).toEqual({ 'a->b': 2, 'a->c': 4 });
    expect(shuffled).toEqual(allocation);
    expect(allocation.leftover).toBe(0);
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
    useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {}, lastRun: {} });
    useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });
    useLogisticsStore.setState({ routes: [], lastRuns: {}, automationNotices: {} });
    useStockpileStore.getState().restoreStockpile({}, {});
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

    const result = useLogisticsStore.getState().dispatchRoute(route.id);
    expect(result).not.toBe(false);
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
        [first.key]: { slots: [{ ...slot('graphene_lattice'), pendingResources: { alloys: 400, nutrients: 250 } }] },
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
});
