import type { AnomalyKind } from './anomalies';

export type AnomalyTier = 'Phenomenon' | 'Relic' | 'Mythic';

export interface AnomalyLore {
  name: string;
  tier: AnomalyTier;
  lore: string;
  rumour: string;
  notes: string[];
}

export const ANOMALY_LORE_RUINED: Record<AnomalyKind, AnomalyLore> = {
  blackHole: {
    name: 'Black Hole',
    tier: 'Phenomenon',
    lore: 'A stellar-mass black hole paired with a companion star, close enough to strip matter from it. The stripped gas heats up as it spirals in and radiates before it crosses the horizon.',
    rumour: 'They turn up near clusters of neutron stars.',
    notes: [
      'Gravitational lensing bends light from stars behind it into a ring around the horizon.',
      'Nothing that crosses the horizon has ever been observed to leave.',
    ],
  },
  dysonSphere: {
    name: 'Ruined Dyson Sphere',
    tier: 'Relic',
    lore: 'A partial shell of collector panels around a star, either abandoned mid-construction or stripped down after completion. The star is unobstructed enough to still show through the gaps.',
    rumour: 'A few yellow and orange stars measure dimmer than their spectral class predicts.',
    notes: [
      'The remaining panels hold their orbits, though the collector network behind them is dead.',
      'Loose panels drift outside the main shell, tumbling on whatever orbit they were left in.',
    ],
  },
  matrioshkaBrain: {
    name: 'Matrioshka Brain',
    tier: 'Mythic',
    lore: 'A stack of concentric Dyson shells, each one running on waste heat from the shell inside it. The computation the structure was built for is no longer running, or is running for no one.',
    rumour: 'A system with unusually many shells is worth a closer look at its innermost star.',
    notes: [
      'Each shell runs colder than the one it encloses, and the outermost is barely above the surrounding temperature.',
      'The outer shell still shows occasional light patterns, too slow to resolve into anything.',
    ],
  },
  nicollDysonBeam: {
    name: 'Nicoll-Dyson Beam',
    tier: 'Relic',
    lore: 'A collector swarm built to focus a star\'s output into a directed beam. The beam is still firing, intermittently, along a bearing that has not received a reply in a long time.',
    rumour: 'A directed line of light crossing the disk points back toward its source.',
    notes: [
      'The collectors hold formation and keep tracking the star.',
      'Every pulse fires on the same bearing, and none of them has been answered.',
    ],
  },
  shkadovThruster: {
    name: 'Shkadov Thruster',
    tier: 'Relic',
    lore: 'A stellar engine: a mirror large enough to reflect a meaningful fraction of a star\'s output back onto itself, using the imbalance to push the star off its original trajectory. It has been under way for a long time, with no one still operating it.',
    rumour: 'Stars sitting well above the galactic plane, trailing a wake, are worth checking.',
    notes: [
      'The mirror holds station at a fixed distance, balanced between radiation pressure and gravity.',
      'The star has moved well off the plane it originally orbited in.',
    ],
  },
};

export const ANOMALY_LORE_LIVING: Partial<Record<AnomalyKind, AnomalyLore>> = {
  dysonSphere: {
    name: 'Dyson Sphere',
    tier: 'Relic',
    lore: 'A complete shell of collector panels around a star. The panels track the star and none of its output escapes unused. Something behind the shell is still consuming that energy.',
    rumour: 'A few yellow and orange stars have gone dark with no supernova or other explanation.',
    notes: [
      'The panels track the star with a precision that indicates active maintenance.',
      'Waste heat radiates from the far side of the shell at a steady rate.',
    ],
  },
  matrioshkaBrain: {
    name: 'Matrioshka Brain',
    tier: 'Mythic',
    lore: 'A stack of concentric Dyson shells, each one running on waste heat from the shell inside it, all of them active. Whatever computation is running inside it, it is running at full capacity.',
    rumour: 'A system with unusually many shells is worth a closer look at its innermost star.',
    notes: [
      'The outer shell runs hot, and the heat it sheds is quickly reabsorbed.',
      'Light patterns cross it in fast bursts, consistent with active processing.',
    ],
  },
  nicollDysonBeam: {
    name: 'Nicoll-Dyson Beam',
    tier: 'Relic',
    lore: 'A collector swarm built to focus a star\'s output into a directed beam. The beam is still firing steadily along a bearing that has not changed, and something is receiving it.',
    rumour: 'A directed line of light crossing the disk points back toward its source.',
    notes: [
      'The collectors hold tight formation, drawing in nearly all of the star\'s output.',
      'Every pulse fires on the same bearing, and something answers.',
    ],
  },
  shkadovThruster: {
    name: 'Shkadov Thruster',
    tier: 'Relic',
    lore: 'A stellar engine: a mirror large enough to reflect a meaningful fraction of a star\'s output back onto itself, using the imbalance to push the star off its original trajectory, still operating on purpose toward a chosen destination.',
    rumour: 'Stars sitting well above the galactic plane, trailing a wake, are worth checking.',
    notes: [
      'The mirror holds station with a precision that indicates active upkeep.',
      'The star is still under active thrust, moving steadily off the plane.',
    ],
  },
};

export function getAnomalyLore(source: { kind: AnomalyKind; living: boolean }): AnomalyLore {
  if (source.living) {
    const living = ANOMALY_LORE_LIVING[source.kind];
    if (living) return living;
  }
  return ANOMALY_LORE_RUINED[source.kind];
}
