import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';
import { computeDriveMultiplier, useUIStore } from './uiStore';
import {
  canAffordFuel,
  EMERGENCY_RESERVE_EXOTIC,
  EMERGENCY_RESERVE_HELIUM,
  spendOperationalThenReserve,
  totalFuel,
} from './emergencyFuel';

const GALAXY_MAX_EXOTIC = 30;
const SC_MAX_EXOTIC = 100;
const HELIUM_PER_JUMP = 25;
// Controls steepness: higher = sharper initial spike, faster taper to max
const LOG_BASE = 10;

const PURGE_BASE_EXOTIC = 300;
const PURGE_BASE_HELIUM = 200;

function mult() {
  const { driveA, driveB } = useUIStore.getState();
  return computeDriveMultiplier(driveA, driveB);
}

function logCost(t: number, max: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return max * Math.log(1 + clamped * (LOG_BASE - 1)) / Math.log(LOG_BASE);
}

export function galaxyTravelCost(dist: number) {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(logCost(dist / GALAXY_RADIUS, GALAXY_MAX_EXOTIC) * me)),
    helium: Math.max(1, Math.round(HELIUM_PER_JUMP * mh))
  };
}

export function superclusterTravelCost(dist: number) {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(logCost(dist / SC_WORLD_HALF, SC_MAX_EXOTIC) * me)),
    helium: Math.max(1, Math.round(HELIUM_PER_JUMP * mh))
  };
}

export function flatTravelCost(baseExotic: number) {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(baseExotic * me)),
    helium: Math.max(1, Math.round(HELIUM_PER_JUMP * mh))
  };
}

/** A district is delivered from orbit, so it is priced as a supercluster-scale haul. */
export function districtBuildCost(): { exotic: number; helium: number } {
  return flatTravelCost(SC_MAX_EXOTIC);
}

export function purgeCost(): { exotic: number; helium: number } {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(PURGE_BASE_EXOTIC * me)),
    helium: Math.max(1, Math.round(PURGE_BASE_HELIUM * mh)),
  };
}

export interface SpendTravelOptions {
  /** Construction and other non-navigation expenses must never open the sealed tank. */
  allowEmergencyReserve?: boolean;
  /** Navigation warns before leaving the operational tanks below a safe intra-galaxy margin. */
  warnOnLowOperationalFuel?: boolean;
}

function confirmFuelRisk(message: string): boolean {
  return typeof window === 'undefined' || window.confirm(message);
}

export function trySpendTravelCost(cost: { exotic: number; helium: number }, options: SpendTravelOptions = {}): boolean {
  const ui = useUIStore.getState();
  if (ui.infiniteExplore) return true;
  const operational = { exotic: ui.exoticMatter, helium: ui.helium3Reserves };
  const reserve = { exotic: ui.emergencyReserveExotic, helium: ui.emergencyReserveHelium };
  const allowReserve = options.allowEmergencyReserve ?? true;
  const warnOnLow = options.warnOnLowOperationalFuel ?? true;

  if (!canAffordFuel(operational, cost)) {
    if (!allowReserve || !canAffordFuel(totalFuel(operational, reserve), cost)) {
      ui.triggerHudFlash();
      return false;
    }
    if (!confirmFuelRisk(
      `BREAK EMERGENCY RESERVE?\n\nThis jump needs ${cost.exotic} Exotic Matter and ${cost.helium} Helium-3. `
      + 'Ordinary logistics cannot refill the sealed tank. Continue?',
    )) return false;

    const spent = spendOperationalThenReserve(operational, reserve, cost);
    useUIStore.setState({
      exoticMatter: spent.operational.exotic,
      helium3Reserves: spent.operational.helium,
      emergencyReserveExotic: spent.reserve.exotic,
      emergencyReserveHelium: spent.reserve.helium,
    });
    return true;
  }

  const remaining = {
    exotic: operational.exotic - cost.exotic,
    helium: operational.helium - cost.helium,
  };
  if (warnOnLow && (remaining.exotic < EMERGENCY_RESERVE_EXOTIC || remaining.helium < EMERGENCY_RESERVE_HELIUM)
    && !confirmFuelRisk(
      `LOW RETURN FUEL\n\nArrival leaves ${remaining.exotic} Exotic Matter and ${remaining.helium} Helium-3 in the operational tanks. `
      + `The sealed ${reserve.exotic}/${reserve.helium} emergency reserve remains available. Continue?`,
    )) {
    return false;
  }

  ui.consumeResources(cost.exotic, cost.helium);
  return true;
}
