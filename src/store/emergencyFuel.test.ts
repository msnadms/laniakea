import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import { defaultSettings } from '../firebase/userDoc';
import { MILKY_WAY_SEED } from '../game/hardcoded';
import type { Colony } from '../game/types';
import { useColonyStore } from './colonyStore';
import { performDistressRecovery, requestEmergencyTanker } from './emergencyRecovery';
import { useGameStore } from './gameStore';
import { trySpendTravelCost } from './travelCosts';
import { applyUserSettings, useUIStore } from './uiStore';

describe('emergency fuel', () => {
  beforeEach(() => {
    applyUserSettings(defaultSettings);
    useGameStore.getState().resetToInitial();
    useColonyStore.setState({ colonies: {} });
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('spends operational fuel before opening the sealed reserve', () => {
    useUIStore.setState({
      exoticMatter: 5,
      helium3Reserves: 10,
      emergencyReserveExotic: 30,
      emergencyReserveHelium: 25,
    });
    expect(trySpendTravelCost({ exotic: 10, helium: 20 })).toBe(true);
    expect(useUIStore.getState()).toMatchObject({
      exoticMatter: 0,
      helium3Reserves: 0,
      emergencyReserveExotic: 25,
      emergencyReserveHelium: 15,
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('BREAK EMERGENCY RESERVE'));
  });

  it('keeps the reserve sealed for non-navigation expenses', () => {
    useUIStore.setState({ exoticMatter: 0, helium3Reserves: 0 });
    expect(trySpendTravelCost(
      { exotic: 10, helium: 10 },
      { allowEmergencyReserve: false, warnOnLowOperationalFuel: false },
    )).toBe(false);
    expect(useUIStore.getState()).toMatchObject({
      emergencyReserveExotic: 30,
      emergencyReserveHelium: 25,
    });
  });

  it('lets the player reseal fuel from the operational tanks', () => {
    useUIStore.setState({
      exoticMatter: 20,
      helium3Reserves: 20,
      emergencyReserveExotic: 12,
      emergencyReserveHelium: 10,
    });
    useUIStore.getState().replenishEmergencyReserve();
    expect(useUIStore.getState()).toMatchObject({
      exoticMatter: 2,
      helium3Reserves: 5,
      emergencyReserveExotic: 30,
      emergencyReserveHelium: 25,
    });
  });

  it('cancels a jump when the player rejects the low-return warning', () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    useUIStore.setState({ exoticMatter: 35, helium3Reserves: 30 });
    expect(trySpendTravelCost({ exotic: 10, helium: 10 })).toBe(false);
    expect(useUIStore.getState()).toMatchObject({ exoticMatter: 35, helium3Reserves: 30 });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('LOW RETURN FUEL'));
  });

  it('uses real colony fuel for a tanker rescue', () => {
    useUIStore.setState({
      exoticMatter: 0,
      helium3Reserves: 0,
      emergencyReserveExotic: 0,
      emergencyReserveHelium: 0,
      detectionHeat: 0,
    });
    const colony = {
      key: 'colony', planetName: 'Haven', foundedAt: 1, population: 100,
      superclusSeed: useGameStore.getState().supercluster.seed,
      galaxySeed: MILKY_WAY_SEED, systemId: 0,
      supplies: { exotic: 100, 'helium-3': 100 },
    } as Colony;
    useColonyStore.setState({ colonies: { colony } });

    expect(requestEmergencyTanker()).toBe(true);
    expect(useUIStore.getState()).toMatchObject({ exoticMatter: 30, helium3Reserves: 25, detectionHeat: 0.5 });
    expect(useColonyStore.getState().colonies.colony.supplies).toMatchObject({ exotic: 70, 'helium-3': 75 });
  });

  it('always recovers a fuel-empty ship to Sol with a cargo penalty', () => {
    useGameStore.getState().restoreGalaxyAndSystem(MILKY_WAY_SEED, 1);
    useUIStore.setState({
      exoticMatter: 0,
      helium3Reserves: 0,
      emergencyReserveExotic: 0,
      emergencyReserveHelium: 0,
      alloys: 100,
      nutrients: 80,
      metallicHydrogen: 40,
      neutronStarMatter: 20,
      detectionHeat: 0,
    });

    expect(performDistressRecovery()).toBe(true);
    expect(useGameStore.getState().system?.id).toBe(0);
    expect(useUIStore.getState()).toMatchObject({
      exoticMatter: 30,
      helium3Reserves: 25,
      alloys: 75,
      nutrients: 60,
      metallicHydrogen: 30,
      neutronStarMatter: 15,
      detectionHeat: 1,
      view: 'system',
    });
  });
});
