import { GALAXY_RADIUS, SC_WORLD_HALF } from '../game/constants';
import { computeDriveMultiplier, useUIStore } from './uiStore';

const GALAXY_MAX_EXOTIC = 30;
const SC_MAX_EXOTIC = 100;
// Controls steepness: higher = sharper initial spike, faster taper to max
const LOG_BASE = 10;

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
    helium: 100 * mh
  };
}

export function superclusterTravelCost(dist: number) {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(logCost(dist / SC_WORLD_HALF, SC_MAX_EXOTIC) * me)),
    helium: 100 * mh
  };
}

export function flatTravelCost(baseExotic: number) {
  const [me, mh] = mult();
  return {
    exotic: Math.max(1, Math.round(baseExotic * me)),
    helium: 100 * mh
  };
}

export function trySpendTravelCost(cost: { exotic: number; helium: number }): boolean {
  const ui = useUIStore.getState();
  if (ui.infiniteExplore) return true;
  if (ui.exoticMatter < cost.exotic || ui.helium3Reserves < cost.helium) {
    ui.triggerHudFlash();
    return false;
  }
  ui.consumeResources(cost.exotic, cost.helium);
  return true;
}
