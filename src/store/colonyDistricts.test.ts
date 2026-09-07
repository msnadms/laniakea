import { describe, expect, it, vi } from 'vitest';
vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import type { Colony, Fabricator } from '../game/types';
import { DEFAULT_JOB_PRIORITY, DISTRICT_BY_ID } from '../data/districts';
import { districtUpkeepShortfall } from '../ui/colonyPresentation';
import { AMENITIES_PER_PERSON, AMENITIES_PER_WORKING_DISTRICT, AMENITY_GROWTH_FLOOR, charterSite, colonyDemand, colonyExport, colonyNetProduction, colonyRawExport, filledJobs, HOUR, migrateColony, tickColony, useColonyStore } from './colonyStore';
import { evaluateKardashev } from './civStore';
import { useStockpileStore } from './stockpileStore';
import { useUIStore } from './uiStore';
import { districtBuildCost } from './travelCosts';
import { useResearchStore } from './researchStore';
import { researchThreshold } from '../data/research';

const fabricator: Fabricator = {
  key: '7|3|Arcadia', tier: 2, galaxySeed: 7, systemId: 3, systemName: 'Ilex', planetName: 'Arcadia',
  builtAt: 1, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 2,
};

function colony(patch: Partial<Colony> = {}): Colony {
  const base = charterSite(fabricator, HOUR);
  return {
    ...base,
    districtModel: true,
    foundedAt: HOUR,
    population: 1,
    districts: { ...base.districts, civilian_district: 1 },
    supplies: { nutrients: 100_000, 'helium-3': 100 },
    ...patch,
  };
}

describe('colony districts and jobs', () => {
  it('splits residents by job weight rather than filling one job before the next', () => {
    const c = colony({ population: 900, districts: { ...colony().districts, farm_district: 1, research_district: 1 } });
    expect(filledJobs(c)).toMatchObject({ farmer: 300, researcher: 300, steward: 300 });
    expect(filledJobs({ ...c, jobWeights: { farmer: 6, researcher: 3, steward: 3 } })).toMatchObject({ farmer: 400, researcher: 225, steward: 275 });
    expect(filledJobs({ ...c, jobWeights: { researcher: 0 } })).toMatchObject({ farmer: 400, researcher: 0, steward: 300 });
    expect(filledJobs({ ...c, population: 1200 })).toMatchObject({ farmer: 400, researcher: 300, steward: 300 });
  });

  it('spills labor a capped job cannot take down the priority order, skipping unweighted jobs', () => {
    const c = colony({
      population: 800, districts: { ...colony().districts, farm_district: 1, research_district: 1 },
      jobWeights: { farmer: 8, researcher: 1, steward: 1 }, jobPriority: ['researcher', 'steward', 'farmer'],
    });
    expect(filledJobs(c)).toMatchObject({ farmer: 400, researcher: 300, steward: 100 });
    expect(filledJobs({ ...c, jobWeights: { farmer: 8, researcher: 0, steward: 1 } })).toMatchObject({ farmer: 400, researcher: 0, steward: 300 });
  });

  it('integrates output and clamps unattended catch-up', () => {
    const c = colony({ population: 100, districts: { ...colony().districts, research_district: 1 }, jobWeights: { researcher: 10, farmer: 0, steward: 0 } });
    expect(tickColony(c, 2 * HOUR).research).toBeCloseTo(1.25);
    expect(tickColony(c, 20 * HOUR).research).toBeCloseTo(2.5);
    expect(tickColony(c, 2 * HOUR).colony.produced.data_core).toBeUndefined();
  });

  it('summarizes net hourly production and deficits at current staffing', () => {
    const c = colony({
      population: 1000,
      districts: { civilian_district: 1, farm_district: 1, research_district: 1, defense_district: 0 },
    });
    const rates = colonyNetProduction(c);
    expect(rates.raw.nutrients).toBeCloseTo(1930);
    expect(rates.raw['helium-3']).toBe(-8);
    expect(rates.research).toBeCloseTo(3.75);
    expect(rates.materials).toEqual({});
  });

  it('degrades output in proportion to unmet upkeep without directly removing population', () => {
    const c = colony({ population: 100, districts: { ...colony().districts, research_district: 1 }, supplies: { nutrients: 100_000, 'helium-3': 4 }, jobWeights: { researcher: 10, farmer: 0, steward: 0 } });
    const next = tickColony(c, 2 * HOUR);
    expect(next.research).toBeCloseTo(0.625);
    expect(next.colony.population).toBeGreaterThanOrEqual(c.population);
  });

  it('builds a district straight from the ship, charging its rares and a jump of fuel', () => {
    const c = colony();
    useColonyStore.setState({ colonies: { [c.key]: c } });
    useStockpileStore.setState({ materials: {}, rares: { zero_point_capacitor: 1, closed_ecology_column: 1 } });
    useUIStore.setState({ exoticMatter: 10, helium3Reserves: 10_000 });
    expect(useColonyStore.getState().buildDistrict(c.key, 'research_district')).toBe(false);

    const cost = districtBuildCost();
    useUIStore.setState({ exoticMatter: cost.exotic, helium3Reserves: cost.helium });
    expect(useColonyStore.getState().buildDistrict(c.key, 'research_district')).toBe(true);
    expect(useColonyStore.getState().colonies[c.key].districts.research_district).toBe(1);
    expect(useStockpileStore.getState().rares).toMatchObject({ zero_point_capacitor: 0, closed_ecology_column: 0 });
    expect(useUIStore.getState().exoticMatter).toBe(0);
    expect(colonyDemand(c).materials.zero_point_capacitor).toBeUndefined();

    expect(useColonyStore.getState().buildDistrict(c.key, 'research_district')).toBe(false);
  });

  it('exports produced cargo while retaining standing orders', () => {
    const c = colony({ produced: { graphene_lattice: 4 }, requested: { graphene_lattice: 1 } });
    expect(colonyExport(c)).toEqual({ graphene_lattice: 3 });
    expect(colonyRawExport({ ...c, population: 10, supplies: { nutrients: 37_000, alloys: 100 } })).toMatchObject({ nutrients: 1000, alloys: 100 });
    // A colony that exported below its own delivery demand would buy the same food straight back.
    expect(colonyRawExport({ ...c, population: 10, supplies: { nutrients: 36_000 } }).nutrients).toBeUndefined();
  });

  it('accumulates research as a civilization-wide abstract resource', () => {
    useResearchStore.getState().restoreResearch({ points: 0 });
    const c = colony({ population: 100, districts: { ...colony().districts, research_district: 1 }, jobWeights: { researcher: 10, farmer: 0, steward: 0 } });
    useColonyStore.setState({ colonies: { [c.key]: c } });
    useColonyStore.getState().tickColonies(2 * HOUR);
    expect(useResearchStore.getState().points).toBeCloseTo(1.25);
    expect(useColonyStore.getState().colonies[c.key].produced.data_core).toBeUndefined();
  });

  it('razes a district, salvaging one of the rares it was built from', () => {
    const c = colony({ population: 1200, districts: { civilian_district: 2, farm_district: 1, research_district: 0, defense_district: 0 } });
    useColonyStore.setState({ colonies: { [c.key]: c } });
    useStockpileStore.setState({ materials: {}, rares: {} });

    expect(useColonyStore.getState().demolishDistrict(c.key, 'research_district')).toBe(false);
    expect(useColonyStore.getState().demolishDistrict(c.key, 'farm_district', 0)).toBe(true);
    expect(useStockpileStore.getState().rares).toEqual({ closed_ecology_column: 1 });
    expect(useColonyStore.getState().demolishDistrict(c.key, 'civilian_district', 0.99)).toBe(true);

    const razed = useColonyStore.getState().colonies[c.key];
    expect(razed.districts).toMatchObject({ farm_district: 0, civilian_district: 1 });
    expect(useStockpileStore.getState().rares).toEqual({ closed_ecology_column: 1, ectogenesis_bank: 1 });
    expect(razed.population).toBe(1000);
    expect(razed.lostPeople).toBe(200);
  });

  it('feeds a full civilian district from one farm, and stalls a district with no upkeep in store', () => {
    const fed = colony({ population: 1000, districts: { civilian_district: 1, farm_district: 1, research_district: 0, defense_district: 0 }, supplies: { nutrients: 10_000 } });
    const next = tickColony(fed, 2 * HOUR).colony;
    expect(next.supplies.nutrients).toBeGreaterThan(fed.supplies.nutrients ?? 0);
    expect(districtUpkeepShortfall(fed, DISTRICT_BY_ID.farm_district)).toEqual([]);

    const dry = { ...fed, districts: { ...fed.districts, research_district: 1 }, supplies: { nutrients: 10_000 } };
    expect(districtUpkeepShortfall(dry, DISTRICT_BY_ID.research_district)).toEqual(['Helium-3']);
    expect(tickColony(dry, 2 * HOUR).research).toBe(0);
  });

  it('stalls growth when civilian districts cannot cover the population', () => {
    const civilian = DISTRICT_BY_ID.civilian_district;
    const staffed = colony({ population: 600, districts: { ...colony().districts, farm_district: 1 } });
    const content = tickColony(staffed, 2 * HOUR).colony;
    expect(content.amenityRatio).toBeCloseTo(((civilian.baseAmenities ?? 0) + 300 * (civilian.output.amenities ?? 0))
      / (600 * AMENITIES_PER_PERSON + AMENITIES_PER_WORKING_DISTRICT * 0.75));
    expect(content.population).toBeGreaterThan(staffed.population);

    const crowded = colony({
      population: 1000, districts: { civilian_district: 1, farm_district: 2, research_district: 2, defense_district: 0 },
      jobWeights: { farmer: 5, researcher: 5, steward: 1 },
    });
    const strained = tickColony(crowded, 2 * HOUR).colony;
    expect(strained.amenityRatio).toBeLessThan(AMENITY_GROWTH_FLOOR);
    expect(strained.population).toBe(crowded.population);
  });

  it('grows a freshly chartered colony on the amenities its own districts provide', () => {
    const chartered = colony({ population: 100, districts: { civilian_district: 1, farm_district: 1, research_district: 1, defense_district: 0 } });
    const next = tickColony(chartered, 2 * HOUR).colony;
    expect(next.amenityRatio).toBeGreaterThan(AMENITY_GROWTH_FLOOR);
    expect(next.population).toBeGreaterThan(chartered.population);
  });

  it('quiets and arms a colony from its crewed defense districts alone', () => {
    const industrial = colony({ population: 1000, districts: { civilian_district: 1, farm_district: 1, research_district: 0, defense_district: 0 }, localHeat: 3 });
    const exposed = tickColony(industrial, HOUR + HOUR / 4, 0, 1);
    expect(exposed.escapes).toBeGreaterThan(0);
    expect(exposed.colony.localHeat).toBeGreaterThan(industrial.localHeat);

    const defended = { ...industrial, districts: { ...industrial.districts, defense_district: 1 } };
    const held = tickColony(defended, HOUR + HOUR / 4, 0, 1);
    expect(held.escapes).toBe(0);
    expect(held.kills).toBeGreaterThan(0);
    expect(held.colony.localHeat).toBeLessThan(industrial.localHeat);

    const unstaffed = { ...defended, jobWeights: { sentinel: 0 } };
    expect(tickColony(unstaffed, HOUR + HOUR / 4, 0, 1).escapes).toBeGreaterThan(0);
    const unfueled = { ...defended, supplies: { nutrients: 100_000 } };
    expect(tickColony(unfueled, HOUR + HOUR / 4, 0, 1).escapes).toBeGreaterThan(0);
  });

  it('refuses to raze the last civilian district under an inhabited colony', () => {
    const c = colony({ population: 500, districts: { civilian_district: 1, farm_district: 1, research_district: 0, defense_district: 0 } });
    useColonyStore.setState({ colonies: { [c.key]: c } });
    useStockpileStore.setState({ materials: {}, rares: {} });

    expect(useColonyStore.getState().demolishDistrict(c.key, 'civilian_district')).toBe(false);
    expect(useColonyStore.getState().colonies[c.key].population).toBe(500);
    expect(useStockpileStore.getState().rares).toEqual({});
  });

  it('migrates installed assemblies and labor from an old save', () => {
    const old = { ...colony(), districtModel: false, districts: undefined, jobPriority: undefined, produced: undefined, installed: { closed_ecology_column: 2, frame_dragging_gyro: 1 }, labor: 40 } as unknown as Colony;
    const next = migrateColony(old);
    expect(next.districts).toMatchObject({ civilian_district: 2, research_district: 0, defense_district: 1 });
    expect(next.projectDelivered.labor).toBe(40);
    expect(next.jobPriority).toEqual(DEFAULT_JOB_PRIORITY);
  });

  it('requires both a researched capstone and its visible project', () => {
    const integrated = colony({ planetaryProgressMs: HOUR });
    expect(evaluateKardashev([integrated], researchThreshold(1) - 1, 0)).toBe(0);
    expect(evaluateKardashev([integrated], researchThreshold(1), 0)).toBe(1);
    expect(evaluateKardashev([{ ...integrated, swarmComplete: true }], researchThreshold(2) - 1, 1)).toBe(1);
    expect(evaluateKardashev([{ ...integrated, swarmComplete: true }], researchThreshold(2), 1)).toBe(2);
  });
});
