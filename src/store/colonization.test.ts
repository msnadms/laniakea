import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import type { Colony, Fabricator, Extractor } from '../game/types';
import { colonyNodeId, extractorNodeId, fabricatorNodeId, makeEmptyFabricatorSlot } from '../game/types';
import { charterSite, CHARTER_ASSEMBLIES, colonyPopCap, colonyDemand, colonyExport, colonyFoodCapacity, tickColony, deliverColony, useColonyStore, HOUR, DYSON_COST, DYSON_LABOR, MAX_UNATTENDED_ESCAPES, canBuildExtractor } from './colonyStore';
import { applyUserSettings, useUIStore, probeEscapes, FIRE_COOLDOWN_MS } from './uiStore';
import { defaultSettings } from '../firebase/userDoc';
import { useGameStore } from './gameStore';
import { useFabricatorStore, processFabricator, holdFeedPools } from './fabricatorStore';
import { useExtractorStore } from './extractorStore';
import { useStockpileStore } from './stockpileStore';
import { useLogisticsStore } from './logisticsStore';
import { evaluateKardashev, tickCivilization, STRIKE_WARNING_MS } from './civStore';
import { cancelDeathSequence } from './resetGame';
import { generatePlanets, generateSystemLayout } from '../game/planetGen';

const NOW = 10 * HOUR;
const f: Fabricator = { key: '1|1|Haven', tier: 2, galaxySeed: 1, systemId: 1, systemName: 'Home', planetName: 'Haven',
  builtAt: 1, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1 };
const makeLiving = (patch: Partial<Colony> = {}): Colony => ({ ...charterSite(f, NOW),
  foundedAt: NOW, population: 100, populationTier: 1, installed: { ...CHARTER_ASSEMBLIES },
  supplies: { nutrients: 100_000 }, ammo: 40, ...patch,
});

/** Feeds a colony hour by hour, since a single long call is clamped as unattended time. */
function feed(colony: Colony, throughHour: number, fromHour = 1) {
  let lines = 0;
  for (let h = fromHour; h <= throughHour; h++) {
    const run = tickColony({ ...colony, supplies: { ...colony.supplies, nutrients: 1e8 } }, NOW + h * HOUR);
    colony = run.colony; lines += run.lines;
  }
  return { colony, lines };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  applyUserSettings(defaultSettings);
  useUIStore.setState({ exoticMatter: 100_000, helium3Reserves: 100_000, storageA: 4, logisticsA: 2 });
  useColonyStore.setState({ colonies: {} });
  useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {}, lastRun: {} });
  useExtractorStore.setState({ extractors: {}, nodeEquipped: {}, ownedUpgrades: [] });
  useStockpileStore.setState({ materials: {}, rares: {} });
  useLogisticsStore.setState({ routes: [], lastRuns: {}, automationNotices: {} });
});
afterEach(() => { cancelDeathSequence(); vi.useRealTimers(); });

describe('colony population arithmetic', () => {
  it('grows logistically, consumes food and never exceeds its installed capacity', () => {
    const c = makeLiving();
    const next = tickColony(c, NOW + HOUR).colony;
    expect(next.population).toBeCloseTo(1000 / (1 + 9 * Math.exp(-0.35)));
    expect(next.supplies.nutrients).toBeLessThan(c.supplies.nutrients!);
    expect(c.population).toBe(100);
    expect(tickColony(makeLiving({ supplies: { nutrients: 1e9 } }), NOW + 100 * HOUR).colony.population).toBeLessThanOrEqual(colonyPopCap(c));
  });
  it('gives the same fed population and food over subdivided intervals', () => {
    const c = makeLiving();
    const whole = tickColony(c, NOW + HOUR).colony;
    const half = tickColony(tickColony(c, NOW + HOUR / 2).colony, NOW + HOUR).colony;
    expect(whole.population).toBeCloseTo(half.population, 8);
    expect(whole.supplies.nutrients).toBeCloseTo(half.supplies.nutrients!, 7);
    expect(whole.labor).toBeCloseTo(half.labor, 8);
  });
  it('stops growth, grants half an hour grace, then loses real people permanently', () => {
    const c = makeLiving({ population: 200, supplies: {} });
    expect(tickColony(c, NOW + HOUR / 2).colony.population).toBeCloseTo(200);
    const next = tickColony(c, NOW + HOUR).colony;
    expect(next.population).toBeCloseTo(150);
    expect(next.lostPeople).toBeCloseTo(50);
    expect(next.labor).toBeCloseTo(0);
    // An unattended gap is capped, so a single long absence cannot empty a colony outright.
    const clamped = tickColony(c, NOW + 10 * HOUR).colony;
    expect(clamped.population).toBeCloseTo(50);
    let dead = clamped;
    for (let h = 11; h <= 14; h++) dead = tickColony(dead, NOW + h * HOUR).colony;
    expect(dead.population).toBe(0);
    expect(tickColony({ ...dead, supplies: { nutrients: 1000 } }, NOW + 20 * HOUR).colony.population).toBe(0);
    expect(tickColony(next, NOW + HOUR + 0.5).colony.population).toBeLessThanOrEqual(next.population);
  });
  it('starves under a trickle that never covers the population', () => {
    let c = makeLiving({ population: 200, supplies: {} });
    for (let step = 1; step <= 240; step++) {
      c.supplies = { ...c.supplies, nutrients: (c.supplies.nutrients ?? 0) + 1 };
      c = tickColony(c, NOW + step * 15_000).colony;
    }
    expect(c.population).toBeLessThan(200);
    expect(c.lostPeople).toBeGreaterThan(0);
  });
  it('resolves a long unattended interval without simulating every weapon step', () => {
    const started = performance.now();
    const quiet = tickColony(makeLiving({ localHeat: 0, ammo: 40, supplies: { nutrients: 1e9 } }), NOW + 365 * 24 * HOUR);
    expect(quiet.escapes).toBe(0);
    expect(performance.now() - started).toBeLessThan(50);
  });
  it('exports everything it holds no standing order for, sparing an unfilled magazine', () => {
    const c = makeLiving({ assemblies: { zero_point_capacitor: 1 } });
    expect(colonyExport(c)).toEqual({ zero_point_capacitor: 1 });
    expect(colonyExport({ ...c, requested: { zero_point_capacitor: 1 } })).toEqual({});
    expect(colonyExport({ ...c, assemblies: { zero_point_capacitor: 3 }, requested: { zero_point_capacitor: 1 } })).toEqual({ zero_point_capacitor: 2 });
    expect(colonyExport({ ...c, assemblies: { sentinel_ammo: 8 }, ammo: 35 })).toEqual({ sentinel_ammo: 3 });
  });
  it('returns one line per population tier after six fed hours at maturity', () => {
    const c = makeLiving({ population: 600 });
    expect(feed(c, 5).lines).toBe(0);
    const six = feed(c, 6);
    expect(six.lines).toBe(1);
    // Capped by population tier: further fed hours alone return nothing.
    expect(feed(six.colony, 18, 7).lines).toBe(0);
    const tiered = feed({ ...six.colony, populationTier: 2 }, 19, 7);
    expect(tiered.lines).toBe(1);
    expect(tiered.colony.exportedLines).toBe(2);
  });
  it('does not credit fed hours spent below the maturity population', () => {
    expect(feed(makeLiving({ population: 100 }), 6).lines).toBe(0);
  });
  it('bounds an unattended catch-up so a closed tab cannot flood exposure', () => {
    const abandoned = tickColony(makeLiving({ localHeat: 3, ammo: 0 }), NOW + 24 * HOUR);
    expect(abandoned.escapes).toBe(MAX_UNATTENDED_ESCAPES);
    expect(abandoned.colony.lastTickAt).toBe(NOW + 24 * HOUR);
  });
  it('lets probes through above saturation even with a loaded magazine', () => {
    const swarmed = tickColony(makeLiving({ localHeat: 5, ammo: 40 }), NOW + 30_000);
    expect(swarmed.kills).toBe(1);
    expect(swarmed.escapes).toBe(1);
    const engaged = tickColony(makeLiving({ localHeat: 3, ammo: 40 }), NOW + 30_000);
    expect(engaged.escapes).toBe(0);
  });
  it('salvages nothing from a probe killed short of observation range', () => {
    expect(tickColony(makeLiving({ localHeat: 1.5, ammo: 40 }), NOW + 30_000).kills).toBe(0);
  });
  it('raises local attention smoothly with every industry a colony runs', () => {
    const heat = (industries: number) => tickColony(makeLiving({ localHeat: 0, ammo: 0 }), NOW + HOUR / 4, 0, industries).colony.localHeat;
    expect(heat(0)).toBe(0);
    expect(heat(1)).toBeCloseTo(0.5);
    expect(heat(2)).toBeCloseTo(1.5);
    expect(heat(3)).toBeCloseTo(2.5);
    expect(heat(4)).toBeCloseTo(3.5);
  });
  it('uses delivered ammunition to kill probes and salvages only actual kills', () => {
    const defended = tickColony(makeLiving({ localHeat: 3, ammo: 5 }), NOW + 30_000);
    expect(defended.kills).toBe(1); expect(defended.colony.ammo).toBe(0);
    expect(defended.escapes).toBe(0);
    const exposed = tickColony(makeLiving({ localHeat: 3, ammo: 0 }), NOW + 30_000);
    expect(exposed.escapes).toBe(1); expect(exposed.kills).toBe(0);
  });
});

describe('charter accounting', () => {
  function prepare() {
    useFabricatorStore.getState().placeFabricator(f);
    useColonyStore.getState().planCharter(f.key, NOW);
    const c = useColonyStore.getState().colonies[f.key];
    const delivered = deliverColony(c, {}, CHARTER_ASSEMBLIES, NOW).colony;
    useColonyStore.setState({ colonies: { [f.key]: delivered } });
    useGameStore.setState(s => ({ galaxy: { ...s.galaxy, seed: 1 }, system: { ...s.galaxy.systems[0], id: 1,
      planets: [{ name: 'Haven', type: 'habitable', resources: [], moons: [] }] } }));
  }
  it('charters with assemblies carried by the Peregrine when no route delivery has arrived', () => {
    useFabricatorStore.getState().placeFabricator(f);
    useColonyStore.getState().planCharter(f.key);
    useStockpileStore.setState({ rares: { ...CHARTER_ASSEMBLIES } });
    useGameStore.setState(s => ({ galaxy: { ...s.galaxy, seed: 1 }, system: { ...s.galaxy.systems[0], id: 1,
      planets: [{ name: 'Haven', type: 'habitable', resources: [], moons: [] }] } }));
    expect(useColonyStore.getState().charterColony(f.key)).toBe(true);
    expect(useUIStore.getState().geneLines).toBe(22);
    expect(useStockpileStore.getState().rares).toEqual(Object.fromEntries(Object.keys(CHARTER_ASSEMBLIES).map(id => [id, 0])));
  });
  it('combines route-delivered and Peregrine assemblies, spending the route buffer first', () => {
    prepare();
    const staged = useColonyStore.getState().colonies[f.key];
    useColonyStore.setState({ colonies: { [f.key]: { ...staged, assemblies: { zero_point_capacitor: 1 } } } });
    useStockpileStore.setState({ rares: { ...CHARTER_ASSEMBLIES, zero_point_capacitor: 1 } });
    expect(useColonyStore.getState().charterColony(f.key)).toBe(true);
    expect(useStockpileStore.getState().rares.zero_point_capacitor).toBe(1);
  });
  it('refuses remotely, then spends lines and consumes delivered assemblies once', () => {
    prepare();
    useGameStore.setState(s => ({ system: { ...s.system!, id: 2 } }));
    expect(useColonyStore.getState().charterColony(f.key)).toBe(false);
    expect(useUIStore.getState().geneLines).toBe(24);
    useGameStore.setState(s => ({ system: { ...s.system!, id: 1 } }));
    expect(useColonyStore.getState().charterColony(f.key)).toBe(true);
    const c = useColonyStore.getState().colonies[f.key];
    expect(c.population).toBe(100); expect(c.assemblies.ectogenesis_bank).toBe(0);
    expect(c.installed.closed_ecology_column).toBe(1);
    expect(useUIStore.getState().geneLines).toBe(22);
    expect(useColonyStore.getState().charterColony(f.key)).toBe(false);
  });
  it('refuses without enough viable lines and leaves the delivered buffer intact', () => {
    prepare(); useUIStore.setState({ geneLines: 1 });
    expect(useColonyStore.getState().charterColony(f.key)).toBe(false);
    expect(useColonyStore.getState().colonies[f.key].assemblies).toEqual(CHARTER_ASSEMBLIES);
  });
  it('consumes an ectogenesis bank at the next population tier', () => {
    useColonyStore.setState({ colonies: { [f.key]: makeLiving({ population: 900, assemblies: { ectogenesis_bank: 1 }, installed: { closed_ecology_column: 2 } }) } });
    expect(useColonyStore.getState().installAssembly(f.key, 'ectogenesis_bank')).toBe(true);
    expect(colonyPopCap(useColonyStore.getState().colonies[f.key])).toBe(2000);
    expect(useColonyStore.getState().installAssembly(f.key, 'ectogenesis_bank')).toBe(false);
  });
});

describe('probe exposure and alien matter', () => {
  it('allows one escape per observation cooldown, including when the weapon is cooling', () => {
    expect(probeEscapes(2, false, NOW - FIRE_COOLDOWN_MS, NOW)).toBe(true);
    expect(probeEscapes(2, false, NOW - FIRE_COOLDOWN_MS + 1, NOW)).toBe(false);
    expect(probeEscapes(2, true, 0, NOW)).toBe(false);
    useUIStore.setState({ detectionHeat: 3, detectionRating: 3, lastDetectionChangeAt: NOW, railgunAmmo: 0, lastFireAt: NOW - 30_000 });
    useUIStore.getState().tickRailgunSuppression();
    useUIStore.getState().tickRailgunSuppression();
    expect(useUIStore.getState().exposure).toBe(1);
    vi.setSystemTime(NOW + 30_000);
    useUIStore.getState().tickRailgunSuppression();
    expect(useUIStore.getState().exposure).toBe(2);
    expect(useUIStore.getState().alienMatter).toBe(0);
  });
  it('does not leak exposure while the magazine is loaded and the gun is between shots', () => {
    useUIStore.setState({ detectionHeat: 2.5, detectionRating: 2, lastDetectionChangeAt: NOW, railgunAmmo: 40, lastFireAt: NOW, exposure: 0 });
    for (const offset of [15_000, 30_000, 45_000, 60_000]) {
      vi.setSystemTime(NOW + offset);
      useUIStore.getState().tickRailgunSuppression();
    }
    expect(useUIStore.getState().exposure).toBe(0);
    expect(useUIStore.getState().alienMatter).toBeGreaterThan(0);
  });
  it('salvages wreckage for a kill and keeps exposure permanent through a purge', () => {
    useUIStore.setState({ detectionHeat: 3, detectionRating: 3, lastDetectionChangeAt: NOW, railgunAmmo: 5, lastFireAt: NOW - 30_000, exposure: 8 });
    useUIStore.getState().tickRailgunSuppression();
    expect(useUIStore.getState().alienMatter).toBe(1);
    expect(useUIStore.getState().exposure).toBe(8);
    useUIStore.getState().purgeDetection();
    expect(useUIStore.getState().exposure).toBe(8);
  });
  it('provides kill-only raw material to the alien recipe tier', () => {
    const slot = { ...makeEmptyFabricatorSlot(), targetUpgradeId: 'statite_mirror' };
    const materials = { metamaterial_film: 2, casimir_plate: 1 };
    expect(processFabricator([slot], 2, { alloys: 1200 }, materials).readyItems).toEqual([]);
    expect(processFabricator([slot], 2, { alloys: 1200, alienMatter: 1 }, materials).readyItems[0].upgradeId).toBe('statite_mirror');
    useUIStore.setState({ alienMatter: 2 });
    expect(holdFeedPools(useUIStore.getState(), {}).raw.alienMatter).toBe(2);
    for (let seed = 1; seed < 25; seed++) expect(generatePlanets(generateSystemLayout(seed, 'N')).flatMap(p => p.resources ?? []).some(r => r.type === 'alienMatter')).toBe(false);
  });
});

describe('colony routes', () => {
  function routeSetup(branch = false) {
    const e: Extractor = { ...f, key: 'food', resourceType: 'nutrients', rate: 1, placedAt: NOW - 100_000, lastCollectedAt: NOW - 100_000 };
    useExtractorStore.setState({ extractors: { food: e } });
    useFabricatorStore.setState({ fabricators: { [f.key]: f }, fabricatorStates: { [f.key]: { slots: [{ ...makeEmptyFabricatorSlot(), targetUpgradeId: 'graphene_lattice' }] } } });
    useColonyStore.setState({ colonies: { [f.key]: charterSite(f, NOW) } });
    const from = extractorNodeId(1, 1);
    useLogisticsStore.getState().addRoute({ id: 'supply', name: 'Supply', edges: [
      { from, to: colonyNodeId(1, 1), materialDraw: 2 },
      ...(branch ? [{ from, to: fabricatorNodeId(1, 1) }] : []),
    ] });
  }
  it('delivers rares over several dispatches and preview changes no state', () => {
    routeSetup(); useStockpileStore.setState({ rares: { ...CHARTER_ASSEMBLIES } });
    const before = useColonyStore.getState().colonies;
    expect(useLogisticsStore.getState().previewRoute('supply')?.canRun).toBe(true);
    expect(useColonyStore.getState().colonies).toBe(before);
    expect(useStockpileStore.getState().rares).toEqual(CHARTER_ASSEMBLIES);
    for (let i = 0; i < 3; i++) {
      const result = useLogisticsStore.getState().dispatchRoute('supply');
      expect(result).not.toBe(false);
      if (result) { expect(result.materialsMoved).toBe(i < 2 ? 2 : 1); expect(result.colonyKeys).toEqual([f.key]); }
    }
    expect(useColonyStore.getState().colonies[f.key].assemblies).toEqual(CHARTER_ASSEMBLIES);
    expect(Object.values(useStockpileStore.getState().rares).every(n => n === 0)).toBe(true);
  });
  it('shares nutrient cargo with a competing fabricator without duplication', () => {
    routeSetup(true);
    const result = useLogisticsStore.getState().dispatchRoute('supply');
    expect(result).not.toBe(false);
    const colonyFood = useColonyStore.getState().colonies[f.key].supplies.nutrients!;
    const fabFood = useFabricatorStore.getState().fabricatorStates[f.key].slots[0].pendingResources.nutrients!;
    expect(colonyFood).toBe(50); expect(fabFood).toBe(50);
    expect(colonyFood + fabFood).toBe(100);
  });
  it('honors filters on rare assemblies and ammunition', () => {
    routeSetup(); useStockpileStore.setState({ rares: { ...CHARTER_ASSEMBLIES }, materials: { sentinel_ammo: 20 } });
    useLogisticsStore.getState().updateRoute('supply', { edges: [{ from: extractorNodeId(1,1), to: colonyNodeId(1,1), allowedMaterials: ['sentinel_ammo'], materialDraw: 3 }] });
    useLogisticsStore.getState().dispatchRoute('supply');
    expect(useColonyStore.getState().colonies[f.key].ammo).toBe(3);
    expect(useColonyStore.getState().colonies[f.key].assemblies).toEqual({});
    expect(useStockpileStore.getState().materials.sentinel_ammo).toBe(17);
  });
  it('charges a supplied colony instead of the ship for its route', () => {
    routeSetup();
    useColonyStore.setState({ colonies: { [f.key]: makeLiving({ supplies: { nutrients: 0, exotic: 2000, 'helium-3': 2000 } }) } });
    useUIStore.setState({ exoticMatter: 0, helium3Reserves: 0 });
    expect(useLogisticsStore.getState().previewRoute('supply')?.canRun).toBe(true);
    expect(useLogisticsStore.getState().dispatchRoute('supply')).not.toBe(false);
    expect(useUIStore.getState().exoticMatter).toBe(0);
    expect(useColonyStore.getState().colonies[f.key].supplies.exotic).toBeLessThan(2000);
  });
});

describe('civilization and strikes', () => {
  it('limits extractor construction only by the ship logistics capacity', () => {
    const fleet = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`e${i}`, { ...f, key: `e${i}`, systemId: 20, rate: 1, resourceType: 'nutrients' as const, placedAt: NOW, lastCollectedAt: NOW }]));
    useUIStore.setState({ logisticsA: 0 }); useExtractorStore.setState({ extractors: fleet });
    expect(canBuildExtractor(1, 1)).toBe(false);
    delete fleet.e4;
    useExtractorStore.setState({ extractors: fleet });
    expect(canBuildExtractor(1, 1)).toBe(true);
    expect(canBuildExtractor(1, 99)).toBe(true);
  });
  it('rejects an evacuation at or after the strike deadline', () => {
    useColonyStore.setState({ colonies: { [f.key]: makeLiving() } });
    useUIStore.setState({ strike: { superclusSeed: 1, targetName: 'Home', arrivesAt: NOW } });
    expect(useColonyStore.getState().evacuate(f.key)).toBe(false);
    expect(useUIStore.getState().geneLines).toBe(24);
  });
  it('runs local industry while the Peregrine is in another system and retains output locally', () => {
    const c = makeLiving({ population: 600, supplies: { nutrients: 100_000, alloys: 800 } });
    const food: Extractor = { ...f, key: 'food', rate: 8, resourceType: 'nutrients', placedAt: NOW, lastCollectedAt: NOW };
    useColonyStore.setState({ colonies: { [f.key]: c } });
    useExtractorStore.setState({ extractors: { food } });
    useFabricatorStore.setState({ fabricators: { [f.key]: f }, fabricatorStates: { [f.key]: { slots: [{ ...makeEmptyFabricatorSlot(), targetUpgradeId: 'graphene_lattice' }] } } });
    useGameStore.setState({ system: null });
    for (let t = NOW + 15_000; t <= NOW + HOUR; t += 15_000) useColonyStore.getState().tickColonies(t);
    const next = useColonyStore.getState().colonies[f.key];
    expect(next.assemblies.graphene_lattice).toBe(4);
    expect(next.population).toBeGreaterThan(600);
    expect(next.selfSufficientMs).toBe(HOUR);
    expect(evaluateKardashev([next])).toBe(1);
    expect(useStockpileStore.getState().materials.graphene_lattice).toBeUndefined();
  });
  it('exports colony factory output through the same bandwidth-limited routes', () => {
    const other: Fabricator = { ...f, key: '1|2|Away', systemId: 2 };
    useColonyStore.setState({ colonies: { [f.key]: makeLiving({ assemblies: { graphene_lattice: 3 }, supplies: { exotic: 2000, 'helium-3': 2000 } }) } });
    useFabricatorStore.setState({ fabricators: { [other.key]: other }, fabricatorStates: { [other.key]: { slots: [{ ...makeEmptyFabricatorSlot(), targetUpgradeId: 'hea_billet' }] } } });
    useLogisticsStore.getState().addRoute({ id: 'export', name: 'Export', edges: [{ from: colonyNodeId(1,1), to: fabricatorNodeId(1,2), materialDraw: 2, overflow: 'hold' }] });
    const before = useColonyStore.getState().colonies;
    useLogisticsStore.getState().previewRoute('export');
    expect(useColonyStore.getState().colonies).toBe(before);
    const result = useLogisticsStore.getState().dispatchRoute('export');
    expect(result).not.toBe(false);
    if (result) expect(result.materialsMoved).toBe(2);
    expect(useFabricatorStore.getState().fabricatorStates[other.key].slots[0].pendingMaterials.graphene_lattice).toBe(2);
    expect(useLogisticsStore.getState().routes[0].heldCargo?.[colonyNodeId(1,1)].materials.graphene_lattice).toBe(1);
  });
  it('requires sustained local output for Type I and distinct stars in one galaxy for III', () => {
    expect(evaluateKardashev([makeLiving({ population: 500, selfSufficientMs: HOUR - 1 })])).toBe(0);
    expect(evaluateKardashev([makeLiving({ population: 500, selfSufficientMs: HOUR })])).toBe(1);
    expect(evaluateKardashev([makeLiving({ swarmComplete: true })])).toBe(2);
    const stars = [1,2,3].map(systemId => makeLiving({ systemId, swarmComplete: true, probeCoverage: 1 }));
    expect(evaluateKardashev(stars)).toBe(3);
    expect(evaluateKardashev(stars.map(c => ({ ...c, systemId: 1 })))).toBe(2);
    expect(evaluateKardashev(stars.map(c => ({ ...c, galaxySeed: c.systemId })))).toBe(2);
    expect(evaluateKardashev([], 3)).toBe(3);
  });
  it('keeps detection floors through decay and emergency purge', () => {
    useUIStore.setState({ kardashevTier: 3 });
    useUIStore.getState().tickDetectionDecay();
    expect(useUIStore.getState().detectionHeat).toBe(2);
    useUIStore.getState().purgeDetection();
    expect(useUIStore.getState().detectionHeat).toBe(2);
  });
  it('keeps a megastructure incomplete until both delivered parts and labor arrive', () => {
    const c = makeLiving({ project: 'dyson', labor: DYSON_LABOR, projectDelivered: { ...DYSON_COST, statite_mirror: 59 } });
    useColonyStore.setState({ colonies: { [f.key]: c } });
    useColonyStore.getState().tickColonies(NOW + 1);
    expect(useColonyStore.getState().colonies[f.key].swarmComplete).toBe(false);
    const current = useColonyStore.getState().colonies[f.key];
    useColonyStore.setState({ colonies: { [f.key]: deliverColony(current, {}, { statite_mirror: 1 }, NOW + 1).colony } });
    useColonyStore.getState().tickColonies(NOW + 2);
    expect(useColonyStore.getState().colonies[f.key].swarmComplete).toBe(true);
    expect(useColonyStore.getState().colonies[f.key].labor).toBeLessThan(1);
  });
  it('telegraphs a named strike, evacuates people and a line, and destroys only its target', () => {
    const other = makeLiving({ key: 'other', superclusSeed: 2 });
    useColonyStore.setState({ colonies: { [f.key]: makeLiving(), other } });
    useUIStore.setState({ exposure: 20 });
    tickCivilization(NOW);
    expect(useUIStore.getState().strike?.arrivesAt).toBe(NOW + STRIKE_WARNING_MS);
    expect(useUIStore.getState().strike?.targetName.length).toBeGreaterThan(0);
    expect(useColonyStore.getState().evacuate(f.key)).toBe(true);
    expect(useUIStore.getState().evacuatedPopulation).toBe(100);
    expect(useUIStore.getState().geneLines).toBe(25);
    expect(useColonyStore.getState().evacuate(f.key)).toBe(false);
    tickCivilization(NOW + STRIKE_WARNING_MS);
    expect(useColonyStore.getState().colonies.other).toEqual(other);
    expect(useUIStore.getState().strike).toBe(null);
  });
  it('removes un-evacuated colonies on impact', () => {
    useColonyStore.setState({ colonies: { [f.key]: makeLiving({ population: 321 }) } });
    useUIStore.setState({ exposure: 20 }); tickCivilization(NOW); tickCivilization(NOW + STRIKE_WARNING_MS);
    expect(useColonyStore.getState().colonies).toEqual({});
    expect(useUIStore.getState().hudNotifyMsg).toContain('321 people lost');
  });
  it('advertises a delivery window rather than a whole reservoir', () => {
    const c = makeLiving({ population: 1000, supplies: { nutrients: 0, exotic: 0, 'helium-3': 0 } });
    const demand = colonyDemand(c);
    expect(demand.raw.nutrients).toBe(1000 * 18 / 4);
    expect(demand.raw.nutrients!).toBeLessThan(colonyFoodCapacity(c));
    expect(demand.raw.exotic).toBe(500);
    // Successive dispatches still fill the whole store.
    const stocked = { ...c, supplies: { nutrients: colonyFoodCapacity(c) - 100 } };
    expect(colonyDemand(stocked).raw.nutrients).toBe(100);
  });
  it('asks for no assembly it has no standing order for, and stops food when its store is full', () => {
    const c = makeLiving({ population: 1000, ammo: 10 });
    expect(Object.entries(colonyDemand(c).materials).filter(([, n]) => n > 0)).toEqual([['sentinel_ammo', 30]]);
    expect(colonyDemand({ ...c, requested: { zero_point_capacitor: 2 } }).materials.zero_point_capacitor).toBe(2);
    const full = { ...c, supplies: { nutrients: colonyFoodCapacity(c) } };
    expect(colonyDemand(full).raw.nutrients).toBe(0);
    expect(deliverColony(full, { nutrients: 5000 }, {}, NOW).consumedRaw.nutrients).toBeUndefined();
  });
  it('exposes charter demand for a sink before its population exists', () => {
    const demand = colonyDemand(charterSite(f, NOW));
    expect(demand.materials.ectogenesis_bank).toBe(1);
    expect(demand.raw.nutrients).toBeGreaterThan(0);
  });
});
