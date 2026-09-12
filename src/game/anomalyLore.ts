import type { AnomalyKind } from './anomalies';

export type AnomalyTier = 'Phenomenon' | 'Relic' | 'Mythic';

export interface AnomalyLore {
  name: string;
  tier: AnomalyTier;
  lore: string;
  rumour: string;
  notes: string[];
}

export const ANOMALY_LORE: Record<AnomalyKind, AnomalyLore> = {
  alcubierreCannon: {
    name: 'Alcubierre Cannon',
    tier: 'Mythic',
    lore: 'A line of warp coils at the edge of a living civilisation, aimed outward along a bearing its builders chose long ago. Each shot is a warp bubble that sweeps up every particle in its path against its leading edge and blueshifts them into a wave that atomizes whatever is waiting at the far end.',
    rumour: 'A star at the edge of one of the flattened home systems keeps flashing along a single bearing, away from everything around it.',
    notes: [
      'The coils charge from the breech to the muzzle, and the bubble is past the outer planets before the last of them has gone dark.',
      'The bearing points out of the region toward nothing any survey has found, and the cannon has not stopped firing along it.',
    ],
  },
  aldersonDisk: {
    name: 'Alderson Disk',
    tier: 'Mythic',
    lore: 'The civilisation that began here took its homeworld apart, and every other world in the inner system with it, and laid the pieces out as one flat disk around the star. It runs from the edge of the star\'s glare out past the line where water freezes, and it holds more ground than every planet in the galaxy put together.',
    rumour: 'A few home stars have no inner planets left, only something wide and flat where they used to be.',
    notes: [
      'The star sits in a hole at the centre and never climbs far above anyone\'s horizon, so the outer reaches live in a dusk that does not end.',
      'The lights grow denser toward the rim, where the dusk is deepest, and none of them have gone out.',
    ],
  },
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
  homeworld: {
    name: 'Ruined Homeworld',
    tier: 'Relic',
    lore: 'The world where the civilisation that built this region began, covered from pole to pole in a single continuous city. Its oceans were drained or roofed over long ago, and almost none of its lights are still on.',
    rumour: 'Every set of ruins seems to gather around one yellow or orange star near its middle.',
    notes: [
      'The surface is structure all the way down, with no coastline or open ground left anywhere on it.',
      'A few districts on the night side still light up on a schedule, though nothing travels between them.',
    ],
  },
};

export const ANOMALY_LORE_LIVING: Partial<Record<AnomalyKind, AnomalyLore>> = {
  dysonSphere: {
    name: 'Dyson Complex',
    tier: 'Relic',
    lore: 'A complete shell of collector panels around a star, fed by foundries that are eating every rocky world in the system from the surface down. None of the star\'s light escapes unused, and none of the rock will be left once they are done.',
    rumour: 'A few yellow and orange stars have gone dark with no supernova or other explanation.',
    notes: [
      'Every rocky world is cut into terraces from pole to pole, and their furnaces light the night sides from one horizon to the other.',
      'Refined rock still leaves the foundry worlds for the shell, though the shell has no gaps left to fill.',
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
  homeworld: {
    name: 'Homeworld',
    tier: 'Relic',
    lore: 'The world where the civilisation that built this region began, covered from pole to pole in a single continuous city. Its oceans were drained or roofed over long ago, and the ones who did it never left.',
    rumour: 'Every set of ruins seems to gather around one yellow or orange star near its middle.',
    notes: [
      'The night side is lit from one terminator to the other, bright enough to read against the planet\'s own shadow.',
      'At some wavelengths the planet is louder than its star.',
    ],
  },
};

export function getAnomalyLore(source: { kind: AnomalyKind; living: boolean }): AnomalyLore {
  if (source.living) {
    const living = ANOMALY_LORE_LIVING[source.kind];
    if (living) return living;
  }
  return ANOMALY_LORE[source.kind];
}
