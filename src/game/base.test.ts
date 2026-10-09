import { describe, expect, it } from 'vitest';
import { baseOf, foundBase, moveDefence, placeDefence, placeExtractor, removeDefence, removeExtractor, type Base, type Outcome } from './base';
import type { SurfaceDeposit } from './baseSurface';
import { BASE_EXTRACTOR_LIMIT, BASE_PLATFORM_LIMIT, DEFENCE_ORBIT_SLOTS, EXTRACTOR_STORAGE } from './constants';
import { DEFENCE_KINDS, validateLayout, type Platform } from './defences';
import { extractorStock, settleExtractor, stockByResource } from './extractors';
import { DEPOSIT_RATE_PER_HOUR } from './resources';

const T0 = 1_700_000_000_000;

function newBase(): Base {
  return foundBase({
    superclusterSeed: 1,
    galaxySeed: 2,
    systemId: 3,
    ring: 1,
    planetName: 'Test',
    systemName: 'Sys',
    galaxyName: 'Gal',
    superclusterName: 'Sc',
  }, T0);
}

function done(outcome: Outcome): Base {
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.base;
}

function slots(): { orbit: number; slot: number }[] {
  return DEFENCE_ORBIT_SLOTS.flatMap((count, orbit) => Array.from({ length: count }, (_, slot) => ({ orbit, slot })));
}

describe('defences', () => {
  it('places, moves and removes platforms', () => {
    let base = done(placeDefence(newBase(), { orbit: 0, slot: 2 }, 'pointDefence'));
    expect(placeDefence(base, { orbit: 0, slot: 2 }, 'missile').ok).toBe(false);
    base = done(moveDefence(base, { orbit: 0, slot: 2 }, { orbit: 2, slot: 9 }));
    expect(base.defences).toEqual([{ orbit: 2, slot: 9, kind: 'pointDefence' }]);
    expect(moveDefence(base, { orbit: 0, slot: 2 }, { orbit: 1, slot: 0 }).ok).toBe(false);
    expect(placeDefence(base, { orbit: 3, slot: 0 }, 'missile').ok).toBe(false);
    base = done(removeDefence(base, { orbit: 2, slot: 9 }));
    expect(base.defences).toEqual([]);
    expect(removeDefence(base, { orbit: 2, slot: 9 }).ok).toBe(false);
  });

  it('holds no more than the platform limit', () => {
    let base = newBase();
    const free = slots();
    for (let i = 0; i < BASE_PLATFORM_LIMIT; i++) base = done(placeDefence(base, free[i], DEFENCE_KINDS[i % DEFENCE_KINDS.length]));
    expect(placeDefence(base, free[BASE_PLATFORM_LIMIT], 'missile').ok).toBe(false);
    expect(validateLayout(base.defences)).toBeNull();
  });

  it('rejects bad layouts', () => {
    const platform = ({ orbit, slot }: { orbit: number; slot: number }): Platform => ({ orbit, slot, kind: DEFENCE_KINDS[0] });
    expect(validateLayout([platform({ orbit: 0, slot: 0 }), platform({ orbit: 0, slot: 0 })])).not.toBeNull();
    expect(validateLayout([platform({ orbit: 0, slot: DEFENCE_ORBIT_SLOTS[0] })])).not.toBeNull();
    expect(validateLayout(slots().slice(0, BASE_PLATFORM_LIMIT + 1).map(platform))).not.toBeNull();
    expect(validateLayout([platform({ orbit: 0, slot: 5 }), platform({ orbit: 2, slot: 9 })])).toBeNull();
  });

  it('reads back only what a base holds', () => {
    const stored = { ...done(placeDefence(newBase(), { orbit: 1, slot: 1 }, 'railgun')), alloys: 5, defences: [{ orbit: 1, slot: 1, kind: 'railgun', level: 2 }] };
    expect(baseOf(stored)).toEqual({ ...newBase(), defences: [{ orbit: 1, slot: 1, kind: 'railgun' }] });
  });
});

const HOUR = 3_600_000;
const DEPOSIT: SurfaceDeposit = { resource: 'copper', grade: 'B', cells: [{ col: 4, row: 5 }] };

describe('extractors', () => {
  it('stands only on a free deposit cell', () => {
    expect(placeExtractor(newBase(), { col: 4, row: 5 }, null, T0).ok).toBe(false);
    expect(placeExtractor(newBase(), { col: -1, row: 5 }, DEPOSIT, T0).ok).toBe(false);
    const base = done(placeExtractor(newBase(), { col: 4, row: 5 }, DEPOSIT, T0));
    expect(base.extractors).toEqual([{ col: 4, row: 5, resource: 'copper', grade: 'B', stored: 0, settledAt: T0 }]);
    expect(placeExtractor(base, { col: 4, row: 5 }, DEPOSIT, T0).ok).toBe(false);
    expect(done(removeExtractor(base, { col: 4, row: 5 })).extractors).toEqual([]);
    expect(removeExtractor(newBase(), { col: 4, row: 5 }).ok).toBe(false);
  });

  it('holds no more than the extractor limit', () => {
    let base = newBase();
    for (let col = 0; col < BASE_EXTRACTOR_LIMIT; col++) base = done(placeExtractor(base, { col, row: 0 }, DEPOSIT, T0));
    expect(placeExtractor(base, { col: BASE_EXTRACTOR_LIMIT, row: 0 }, DEPOSIT, T0).ok).toBe(false);
  });

  it('extracts at its grade rate until its storage is full', () => {
    const [extractor] = done(placeExtractor(newBase(), { col: 4, row: 5 }, DEPOSIT, T0)).extractors;
    const rate = DEPOSIT_RATE_PER_HOUR.B;
    expect(extractorStock(extractor, T0 - HOUR)).toBe(0);
    expect(extractorStock(extractor, T0 + HOUR)).toBe(rate);
    expect(extractorStock(extractor, T0 + HOUR / 2)).toBe(Math.floor(rate / 2));
    expect(extractorStock(extractor, T0 + 1000 * HOUR)).toBe(EXTRACTOR_STORAGE);
    expect(stockByResource([extractor, extractor], T0 + HOUR)).toEqual({ iron: 0, copper: 2 * rate, oil: 0, silica: 0 });
  });

  it('settles without losing a partial unit', () => {
    const [extractor] = done(placeExtractor(newBase(), { col: 4, row: 5 }, DEPOSIT, T0)).extractors;
    let settled = extractor;
    for (let minute = 1; minute <= 180; minute += 7) settled = settleExtractor(settled, T0 + minute * 60_000);
    expect(extractorStock(settled, T0 + 3 * HOUR)).toBe(extractorStock(extractor, T0 + 3 * HOUR));
  });

  it('reads back only well-formed extractors', () => {
    const base = done(placeExtractor(newBase(), { col: 4, row: 5 }, DEPOSIT, T0));
    const stored = { ...base, extractors: [...base.extractors, { col: 1, row: 1, resource: 'gold', grade: 'A', stored: 0, settledAt: T0 }] };
    expect(baseOf(stored)).toEqual(base);
  });
});
