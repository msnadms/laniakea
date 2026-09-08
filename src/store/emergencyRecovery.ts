import { DEFAULT_ADDRESS, LANIAKEA_SEED, MILKY_WAY_SEED } from '../game/hardcoded';
import type { Colony } from '../game/types';
import { useColonyStore } from './colonyStore';
import {
  canAffordFuel,
  EMERGENCY_ALLOTMENT_EXOTIC,
  EMERGENCY_ALLOTMENT_HELIUM,
  totalFuel,
} from './emergencyFuel';
import { useGameStore } from './gameStore';
import { galaxyTravelCost } from './travelCosts';
import { detectionRatingFromHeat, useUIStore } from './uiStore';

export const DISTRESS_CARGO_RETAINED = 0.75;
export const DISTRESS_ATTENTION = 1;
export const TANKER_ATTENTION = 0.5;
const MAX_NONLETHAL_EMERGENCY_HEAT = 4.9;

export interface EmergencyStatus {
  stranded: boolean;
  cheapestCost: { exotic: number; helium: number } | null;
  tanker: Colony | null;
}

function cheapestOutboundCost(): { exotic: number; helium: number } | null {
  const game = useGameStore.getState();
  const current = game.system;
  if (!current) return null;
  let cheapest: { exotic: number; helium: number; total: number } | null = null;
  for (const destination of game.galaxy.systems) {
    if (destination.id === current.id) continue;
    const cost = galaxyTravelCost(Math.hypot(destination.x - current.x, destination.y - current.y));
    const total = cost.exotic + cost.helium;
    if (!cheapest || total < cheapest.total) cheapest = { ...cost, total };
  }
  return cheapest && { exotic: cheapest.exotic, helium: cheapest.helium };
}

function tankerRequirements() {
  const ui = useUIStore.getState();
  return {
    exotic: Math.max(0, EMERGENCY_ALLOTMENT_EXOTIC - ui.exoticMatter),
    helium: Math.max(0, EMERGENCY_ALLOTMENT_HELIUM - ui.helium3Reserves),
  };
}

export function findEmergencyTanker(): Colony | null {
  const requirements = tankerRequirements();
  const game = useGameStore.getState();
  return Object.values(useColonyStore.getState().colonies)
    .filter((colony) => colony.foundedAt > 0 && colony.population > 0
      && (colony.supplies.exotic ?? 0) >= requirements.exotic
      && (colony.supplies['helium-3'] ?? 0) >= requirements.helium)
    .sort((a, b) => {
      const aLocal = Number(a.superclusSeed === game.supercluster.seed) + Number(a.galaxySeed === game.galaxy.seed);
      const bLocal = Number(b.superclusSeed === game.supercluster.seed) + Number(b.galaxySeed === game.galaxy.seed);
      return bLocal - aLocal || a.key.localeCompare(b.key);
    })[0] ?? null;
}

export function emergencyStatus(): EmergencyStatus {
  const ui = useUIStore.getState();
  const cheapestCost = cheapestOutboundCost();
  if (ui.infiniteExplore || !cheapestCost) return { stranded: false, cheapestCost, tanker: null };
  const available = totalFuel(
    { exotic: ui.exoticMatter, helium: ui.helium3Reserves },
    { exotic: ui.emergencyReserveExotic, helium: ui.emergencyReserveHelium },
  );
  const stranded = !canAffordFuel(available, cheapestCost);
  return { stranded, cheapestCost, tanker: stranded ? findEmergencyTanker() : null };
}

function addEmergencyAttention(amount: number) {
  const ui = useUIStore.getState();
  const detectionHeat = Math.max(
    ui.detectionHeat,
    Math.min(MAX_NONLETHAL_EMERGENCY_HEAT, ui.detectionHeat + amount),
  );
  useUIStore.setState({
    detectionHeat,
    detectionRating: detectionRatingFromHeat(detectionHeat),
    lastDetectionChangeAt: Date.now(),
  });
}

export function requestEmergencyTanker(): boolean {
  if (!emergencyStatus().stranded || useUIStore.getState().destroyed) return false;
  const tanker = findEmergencyTanker();
  if (!tanker) return false;
  const requirements = tankerRequirements();
  useColonyStore.setState((state) => {
    const colony = state.colonies[tanker.key];
    if (!colony) return {};
    return { colonies: { ...state.colonies, [colony.key]: { ...colony, supplies: {
      ...colony.supplies,
      exotic: (colony.supplies.exotic ?? 0) - requirements.exotic,
      'helium-3': (colony.supplies['helium-3'] ?? 0) - requirements.helium,
    } } } };
  });
  useUIStore.setState({
    exoticMatter: EMERGENCY_ALLOTMENT_EXOTIC,
    helium3Reserves: EMERGENCY_ALLOTMENT_HELIUM,
  });
  addEmergencyAttention(TANKER_ATTENTION);
  useUIStore.getState().triggerHudNotify(`TANKER ARRIVED FROM ${tanker.planetName.toUpperCase()} — EMERGENCY FUEL TRANSFERRED`);
  return true;
}

export function performDistressRecovery(): boolean {
  const ui = useUIStore.getState();
  if (!emergencyStatus().stranded || ui.destroyed) return false;

  useUIStore.setState({
    exoticMatter: EMERGENCY_ALLOTMENT_EXOTIC,
    helium3Reserves: EMERGENCY_ALLOTMENT_HELIUM,
    alloys: Math.floor(ui.alloys * DISTRESS_CARGO_RETAINED),
    nutrients: Math.floor(ui.nutrients * DISTRESS_CARGO_RETAINED),
    metallicHydrogen: Math.floor(ui.metallicHydrogen * DISTRESS_CARGO_RETAINED),
    neutronStarMatter: Math.floor(ui.neutronStarMatter * DISTRESS_CARGO_RETAINED),
    selectedPlanetKey: null,
    view: 'system',
    viewTransitioning: false,
    transitionBack: false,
    address: DEFAULT_ADDRESS.map((segment) => ({ ...segment })),
  });
  addEmergencyAttention(DISTRESS_ATTENTION);

  const game = useGameStore.getState();
  game.restoreSupercluster(LANIAKEA_SEED);
  game.restoreGalaxyAndSystem(MILKY_WAY_SEED, 0);
  game.markDotVisited(MILKY_WAY_SEED);
  game.markSystemVisited(0);
  useUIStore.getState().triggerHudNotify('DISTRESS RECOVERY COMPLETE — 25% OF RAW CARGO JETTISONED');
  return true;
}
