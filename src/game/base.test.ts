import { describe, expect, it } from 'vitest';
import {
  baseAlloyCapacity,
  foundBase,
  freeCrew,
  moveDefence,
  placeDefence,
  populationCapacity,
  queueShip,
  settleBase,
  upgradeBuilding,
  upgradeDefence,
  worldQuality,
  type Base,
  type Outcome,
} from './base';
import { BUILDING_KINDS, buildingCost, platformLimit } from './baseBuildings';
import { BASE_MAX_LEVEL, BASE_START_POPULATION } from './constants';
import { DEFENCE_KINDS, validateLayout, type Platform } from './defences';
import { generateSystemLayout, type PlanetLayout } from './planetGen';
import { SHIPS } from './ships';
import type { StarType } from './types';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function world(radius: number, moons: number): PlanetLayout {
  return {
    zone: 'habitable',
    radius,
    color: 0,
    angle: 0,
    orbitRadius: 500,
    hasRings: false,
    moons: Array.from({ length: moons }, () => ({ dist: 100, angle: 0, radius: 5, color: 0 })),
  };
}

function newBase(radius = 32, moons = 1, starType: StarType = 'G'): Base {
  return foundBase({
    superclusterSeed: 1,
    galaxySeed: 2,
    systemId: 3,
    ring: 1,
    planetName: 'Test',
    systemName: 'Sys',
    galaxyName: 'Gal',
    superclusterName: 'Sc',
    quality: worldQuality(world(radius, moons), starType),
  }, T0);
}

function done(outcome: Outcome): Base {
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.base;
}

function rich(base: Base): Base {
  return { ...base, alloys: 1e9, population: 1e4 };
}

function commanded(base: Base, level = 3): Base {
  return { ...base, buildings: { ...base.buildings, command: { level, readyAt: null } } };
}

describe('world quality', () => {
  it('rewards larger worlds, more moons and kinder stars', () => {
    expect(worldQuality(world(40, 0), 'G').populationCap).toBeGreaterThan(worldQuality(world(24, 0), 'G').populationCap);
    expect(worldQuality(world(30, 2), 'G').populationCap).toBeGreaterThan(worldQuality(world(30, 0), 'G').populationCap);
    expect(worldQuality(world(30, 0), 'G').alloyRate).toBeGreaterThan(worldQuality(world(30, 0), 'K').alloyRate);
    expect(worldQuality(world(30, 0), 'K').alloyRate).toBeGreaterThan(worldQuality(world(30, 0), 'M').alloyRate);
    expect(worldQuality(world(30, 2), 'G').siphonRate).toBeGreaterThan(worldQuality(world(30, 0), 'G').siphonRate);
  });

  it('scores every generated habitable world within bounds', () => {
    let seen = 0;
    for (let seed = 1; seed < 4000 && seen < 50; seed++) {
      for (const planet of generateSystemLayout(seed, 'G').planets) {
        if (planet.zone !== 'habitable') continue;
        seen++;
        const quality = worldQuality(planet, 'G');
        expect(quality.populationCap).toBeGreaterThanOrEqual(40);
        expect(quality.populationCap).toBeLessThanOrEqual(200);
        expect(quality.siphonRate).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('settleBase', () => {
  it('fills alloys up to the vault and no further', () => {
    const settled = settleBase(newBase(), T0 + 1000 * HOUR);
    expect(settled.alloys).toBe(baseAlloyCapacity(settled));
  });

  it('grows population toward its cap without passing it', () => {
    const base = newBase();
    const soon = settleBase(base, T0 + HOUR);
    expect(soon.population).toBeGreaterThan(BASE_START_POPULATION);
    const later = settleBase(base, T0 + 10_000 * HOUR);
    expect(later.population).toBeLessThanOrEqual(populationCapacity(later));
    expect(later.population).toBeCloseTo(populationCapacity(later), 3);
  });

  it('gives the same result settled in steps as settled once', () => {
    let base = commanded(newBase());
    base = done(upgradeBuilding({ ...base, alloys: 500 }, 'refinery', 0, T0));
    base = { ...base, alloys: 0 };
    const once = settleBase(base, T0 + 5 * HOUR);
    let stepped = base;
    for (let h = 1; h <= 50; h++) stepped = settleBase(stepped, T0 + h * HOUR / 10);
    expect(stepped.alloys).toBeCloseTo(once.alloys, 6);
    expect(stepped.population).toBeCloseTo(once.population, 6);
    expect(stepped.buildings.refinery.level).toBe(once.buildings.refinery.level);
  });

  it('completes an upgrade exactly at readyAt and produces at the new rate after', () => {
    const base = done(upgradeBuilding(commanded(rich(newBase())), 'refinery', 0, T0));
    const readyAt = base.buildings.refinery.readyAt!;
    expect(settleBase(base, readyAt - 1).buildings.refinery.level).toBe(1);
    expect(settleBase(base, readyAt).buildings.refinery.level).toBe(2);
    expect(settleBase(base, readyAt).buildings.refinery.readyAt).toBeNull();
  });

  it('launches queued ships in order', () => {
    let base = rich(newBase());
    base = { ...base, buildings: { ...base.buildings, shipyard: { level: 2, readyAt: null }, hangar: { level: 3, readyAt: null } } };
    base = done(queueShip(base, 'corvette', 0, T0));
    base = done(queueShip(base, 'destroyer', 0, T0));
    expect(base.shipQueue[1].readyAt).toBe(T0 + (SHIPS.corvette.buildSeconds + SHIPS.destroyer.buildSeconds) * 1000);
    const mid = settleBase(base, base.shipQueue[0].readyAt);
    expect(mid.fleet).toEqual({ corvette: 1, destroyer: 0, cruiser: 0 });
    const end = settleBase(base, base.shipQueue[1].readyAt);
    expect(end.fleet).toEqual({ corvette: 1, destroyer: 1, cruiser: 0 });
    expect(end.shipQueue).toHaveLength(0);
  });
});

describe('building rules', () => {
  it('prices every level dearer than the last and stops at the top', () => {
    for (const kind of BUILDING_KINDS) {
      for (let level = 1; level < BASE_MAX_LEVEL; level++) {
        expect(buildingCost(kind, level)!.alloys).toBeGreaterThan(buildingCost(kind, level - 1)!.alloys);
      }
      expect(buildingCost(kind, BASE_MAX_LEVEL)).toBeNull();
    }
  });

  it('caps buildings at the Command Nexus level', () => {
    expect(upgradeBuilding(rich(newBase()), 'refinery', 0, T0).ok).toBe(false);
    const raised = settleBase(done(upgradeBuilding(commanded(rich(newBase()), 2), 'refinery', 0, T0)), T0 + 100 * HOUR);
    expect(raised.buildings.refinery.level).toBe(2);
    expect(upgradeBuilding(raised, 'refinery', 0, T0 + 100 * HOUR).ok).toBe(false);
  });

  it('refuses when every builder is busy, or alloys run short', () => {
    const busy = done(upgradeBuilding(rich(newBase()), 'command', 0, T0));
    expect(upgradeBuilding(busy, 'vault', 0, T0).ok).toBe(false);
    const poor = upgradeBuilding({ ...newBase(), alloys: 0 }, 'command', 0, T0);
    expect(poor.ok).toBe(false);
    if (!poor.ok) expect(poor.refusal.status).toBe(402);
  });

  it('needs crew for what it builds', () => {
    const base = { ...commanded(rich(newBase())), population: 7 };
    expect(freeCrew(base)).toBe(1);
    expect(upgradeBuilding(base, 'refinery', 0, T0).ok).toBe(false);
  });

  it('refuses a cruiser without the shipyard, hangar and advanced technology', () => {
    let base = rich(newBase());
    expect(queueShip(base, 'cruiser', 5, T0).ok).toBe(false);
    base = { ...base, buildings: { ...base.buildings, shipyard: { level: 4, readyAt: null }, hangar: { level: 2, readyAt: null } } };
    expect(queueShip(base, 'cruiser', 0, T0).ok).toBe(false);
    expect(queueShip(base, 'cruiser', 5, T0).ok).toBe(true);
    const full = { ...base, fleet: { corvette: 5, destroyer: 0, cruiser: 0 } };
    expect(queueShip(full, 'cruiser', 5, T0).ok).toBe(false);
  });
});

describe('defences', () => {
  it('places, upgrades and moves platforms', () => {
    let base = rich(newBase());
    base = done(placeDefence(base, { orbit: 0, slot: 2 }, 'pointDefence', 0, T0));
    expect(placeDefence(base, { orbit: 0, slot: 2 }, 'missile', 0, T0).ok).toBe(false);
    expect(moveDefence(base, { orbit: 0, slot: 2 }, { orbit: 1, slot: 0 }).ok).toBe(false);
    base = settleBase(base, T0 + HOUR);
    expect(base.defences[0].level).toBe(1);
    expect(upgradeDefence(base, { orbit: 0, slot: 2 }, 0, T0 + HOUR).ok).toBe(false);
    base = done(moveDefence(base, { orbit: 0, slot: 2 }, { orbit: 2, slot: 9 }));
    expect(base.defences[0]).toMatchObject({ orbit: 2, slot: 9 });
    expect(placeDefence(base, { orbit: 3, slot: 0 }, 'missile', 0, T0).ok).toBe(false);
  });

  it('holds no more platforms than the Command Nexus allows', () => {
    let base = rich(newBase());
    for (let slot = 0; slot < platformLimit(1); slot++) {
      base = settleBase(done(placeDefence(base, { orbit: 1, slot }, 'missile', 0, T0 + slot * HOUR)), T0 + (slot + 1) * HOUR);
    }
    expect(placeDefence(base, { orbit: 2, slot: 0 }, 'missile', 0, T0 + 10 * HOUR).ok).toBe(false);
    expect(validateLayout(base.defences, platformLimit(1))).toBeNull();
  });

  it('gates railguns and shields behind the Command Nexus', () => {
    const base = rich(newBase());
    expect(placeDefence(base, { orbit: 0, slot: 0 }, 'railgun', 0, T0).ok).toBe(false);
    expect(placeDefence(base, { orbit: 0, slot: 0 }, 'shield', 0, T0).ok).toBe(false);
  });

  it('rejects bad layouts', () => {
    const platform = (orbit: number, slot: number): Platform => ({ orbit, slot, kind: DEFENCE_KINDS[0], level: 1, readyAt: null });
    expect(validateLayout([platform(0, 0), platform(0, 0)], 5)).not.toBeNull();
    expect(validateLayout([platform(0, 6)], 5)).not.toBeNull();
    expect(validateLayout([platform(0, 0), platform(1, 0)], 1)).not.toBeNull();
    expect(validateLayout([platform(0, 5), platform(2, 9)], 2)).toBeNull();
  });
});
