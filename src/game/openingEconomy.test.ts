import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import type { Extractor, LogisticsRoute } from './types';
import { EXTRACTION_UNITS_PER_RATING_PER_HOUR } from './economy';
import { simulateOpeningEconomy } from './openingEconomySimulation';
import { extractorUnitsPerHour, peekAccumulated, useExtractorStore } from '../store/extractorStore';
import { computeRouteCap, EXTRACTOR_HOLD_CAPS, useUIStore } from '../store/uiStore';
import { useLogisticsStore } from '../store/logisticsStore';

const HOUR = 3_600_000;

function extractor(patch: Partial<Extractor> = {}): Extractor {
  return {
    key: 'mine', galaxySeed: 1, systemId: 1, systemName: 'Sol', planetName: 'Mercury',
    resourceType: 'alloys', rate: 1, placedAt: 0, lastCollectedAt: 0,
    systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1, ...patch,
  };
}

describe('opening economy', () => {
  it('scales a deposit rating to ten hourly units and applies each multiplier once', () => {
    const mine = extractor();
    useUIStore.setState({ storageB: 0, logisticsB: 0 });
    useExtractorStore.setState({ extractors: { mine }, nodeEquipped: {}, ownedUpgrades: [] });
    expect(EXTRACTION_UNITS_PER_RATING_PER_HOUR).toBe(10);
    expect(peekAccumulated(mine, HOUR)).toBe(10);
    expect(extractorUnitsPerHour(mine, 0, {})).toBe(10);
    expect(extractorUnitsPerHour(mine, 2, { mine: ['resonance_drill', null] })).toBe(18.75);
    useUIStore.setState({ logisticsB: 2 });
    useExtractorStore.setState({ nodeEquipped: { mine: ['resonance_drill', null] } });
    expect(peekAccumulated(mine, HOUR)).toBe(18);
  });

  it('preserves fractional elapsed production after a partial collection', () => {
    const mine = extractor({ lastCollectedAt: 0 });
    useUIStore.setState({ storageB: 0, logisticsB: 0, destroyed: false });
    useExtractorStore.setState({ extractors: { mine }, nodeEquipped: {}, ownedUpgrades: [] });
    expect(useExtractorStore.getState().collectExtractor('mine', 4, HOUR)).toBe(4);
    expect(peekAccumulated(useExtractorStore.getState().extractors.mine, HOUR)).toBe(6);
  });

  it('caps every station hold tier', () => {
    const mine = extractor();
    useExtractorStore.setState({ extractors: { mine }, nodeEquipped: {}, ownedUpgrades: [] });
    EXTRACTOR_HOLD_CAPS.forEach((cap, storageB) => {
      useUIStore.setState({ storageB, logisticsB: 0 });
      expect(peekAccumulated(mine, 10_000 * HOUR)).toBe(cap);
    });
  });

  it('allows one baseline route and expands by one per Logistics-A tier', () => {
    const route = (id: string): LogisticsRoute => ({ id, name: id, edges: [] });
    useUIStore.setState({ logisticsA: 0 });
    useLogisticsStore.setState({ routes: [], lastRuns: {}, automationNotices: {} });
    useLogisticsStore.getState().addRoute(route('a'));
    useLogisticsStore.getState().addRoute(route('b'));
    expect(useLogisticsStore.getState().routes.map(item => item.id)).toEqual(['a']);
    expect([0, 1, 2, 3, 4].map(computeRouteCap)).toEqual([1, 2, 3, 4, 5]);
    useLogisticsStore.getState().restoreRoutes([route('legacy-a'), route('legacy-b')]);
    useLogisticsStore.getState().updateRoute('legacy-b', { name: 'Still editable' });
    expect(useLogisticsStore.getState().routes).toHaveLength(2);
    expect(useLogisticsStore.getState().routes[1].name).toBe('Still editable');
  });

  it('meets the opening milestone ceilings', () => {
    const report = simulateOpeningEconomy();
    expect(report.baselineRouteAvailable).toBe(true);
    expect(report.basicFabricatorHours).toBeLessThanOrEqual(0.5);
    expect(report.firstTier1BatchHours).toBeLessThanOrEqual(2);
    expect(report.advancedFabricatorHours).toBeLessThanOrEqual(24);
    expect(report.completeCharterHours).toBeLessThanOrEqual(72);
    expect(report.longestIsolatedCharterInputHours).toBeLessThanOrEqual(24);
    expect(report.solOnlyCharterHours).toBe(Infinity);
    expect(report.solOnlyMaterialTierHours[3]).toBe(Infinity);
    expect(Object.values(report.stationPaybackHours).every(hours => hours <= 5)).toBe(true);
  });
});
