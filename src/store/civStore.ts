import type { Colony } from '../game/types';
import { useColonyStore, HOUR } from './colonyStore';
import { useUIStore, detectionFloor } from './uiStore';
import { generateSupercluster } from '../game/superclusters';

export const STRIKE_WARNING_MS = 10 * 60_000;
export const STRIKE_EXPOSURE_INTERVAL = 100;

/** Output gates: one stable local economy, one star, then three stars in one galaxy. */
export function evaluateKardashev(colonies: Colony[], currentTier = 0): number {
  const living = colonies.filter(c => c.foundedAt > 0 && c.population > 0);
  let tier = currentTier;
  if (living.some(c => c.population >= 500 && c.selfSufficientMs >= HOUR)) tier = Math.max(tier, 1);
  if (living.some(c => c.swarmComplete)) tier = Math.max(tier, 2);
  const galaxies = new Map<number, Set<number>>();
  for (const c of living.filter(c => c.swarmComplete && c.probeCoverage >= 1)) {
    const stars = galaxies.get(c.galaxySeed) ?? new Set<number>();
    stars.add(c.systemId); galaxies.set(c.galaxySeed, stars);
  }
  if ([...galaxies.values()].some(stars => stars.size >= 3)) tier = 3;
  return tier;
}

export function tickCivilization(now: number) {
  const ui = useUIStore.getState();
  if (ui.destroyed) return;
  const colonies = Object.values(useColonyStore.getState().colonies);
  const tier = evaluateKardashev(colonies, ui.kardashevTier);
  if (tier !== ui.kardashevTier) {
    useUIStore.setState({ kardashevTier: tier });
    ui.tickDetectionDecay();
    ui.triggerHudNotify(`KARDASHEV TYPE ${['0', 'I', 'II', 'III'][tier]} — ATTENTION FLOOR ${detectionFloor(tier)}`);
  }
  if (ui.strike && now >= ui.strike.arrivesAt) {
    let lost = 0;
    for (const c of colonies.filter(c => c.superclusSeed === ui.strike!.superclusSeed)) {
      lost += Math.floor(c.population);
      useColonyStore.getState().removeColony(c.key);
    }
    useUIStore.setState({ strike: null });
    ui.triggerHudNotify(`${ui.strike.targetName}: ${lost} people lost. Strike complete.`);
    return;
  }
  if (!ui.strike && ui.exposure >= ui.nextStrikeExposure) {
    const target = colonies.filter(c => c.foundedAt && c.population > 0).sort((a,b) => b.localHeat - a.localHeat || a.key.localeCompare(b.key))[0];
    if (!target) return;
    const targetName = generateSupercluster(target.superclusSeed).name;
    useUIStore.setState({
      strike: { superclusSeed: target.superclusSeed, targetName, arrivesAt: now + STRIKE_WARNING_MS },
      nextStrikeExposure: ui.exposure + STRIKE_EXPOSURE_INTERVAL,
    });
    ui.triggerHudNotify(`CANNON TRANSIT: ${targetName}. TEN MINUTES TO EVACUATE.`);
  }
}
