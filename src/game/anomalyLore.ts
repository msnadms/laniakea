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
    name: 'Ruined Alcubierre Cannon',
    tier: 'Mythic',
    lore: 'A line of warp coils at the edge of a civilisation that is gone, still aimed along the bearing its builders chose. They fired it once, and the shot spent nearly all of the negative-energy condensate they held. The collectors around its star still push charge into the barrel, but the charge dies at the first coil that has failed.',
    rumour: 'A star at the edge of one of the flattened home systems sits inside a long line of rings, aimed away from everything around it.',
    notes: [
      'Several coils have split open, and the rails that joined them now hang loose between the ones still standing.',
      'Its field reservoirs are empty. Whatever the shot was aimed at, nothing has come back along the bearing.',
      'Traffic between this civilisation\'s systems stopped soon after the shot, once there was too little negative-energy condensate left to cross the distances.',
    ],
  },
  aldersonDisk: {
    name: 'Ruined Alderson Disk',
    tier: 'Mythic',
    lore: 'The civilisation that began here built one flat disk around its star from every world in the inner system and far more material lifted off the star itself. The disk has outlasted them. Nothing corrects the star\'s slow drift toward the inner edge anymore, and whole stretches of the rim have broken away.',
    rumour: 'A few home stars have no inner planets left, only something wide and flat where they used to be.',
    notes: [
      'The seas have boiled off near the star and frozen toward the rim, and the land between has faded to the colour of the rock beneath it.',
      'A handful of lights still come on in the dusk along the rim, far fewer than the cities that were built there.',
      'Samples from the broken rim match no known material. A disk built from anything ordinary would have torn itself apart under its own stresses.',
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
  caplanThruster: {
    name: 'Caplan Thruster',
    tier: 'Relic',
    lore: 'A stellar engine that used the star it moves as propellant. Collectors heated one patch of the star to drive off a stream of gas, and an engine held behind the star fused that gas into a jet at about a hundredth of the speed of light. The engine has been cold for a long time, and the star still carries the speed it was given.',
    rumour: 'Stars sitting well above the galactic plane, trailing a long straight line of spent exhaust, are worth checking.',
    notes: [
      'The collectors drifted out of focus once no one steered them, and the patch of star they heated has cooled to match the rest.',
      'The star moved farther in its first million years under thrust than a mirror-driven thruster could have pushed it in tens of millions.',
    ],
  },
  dysonSphere: {
    name: 'Ruined Dyson Sphere',
    tier: 'Relic',
    lore: 'A shell of collectors packed so closely around a star that little of its light got past them. It was never a rigid shell, because no material can bear that load around a star, and each collector held its own station against the star\'s light and gravity. Without anyone steering them, whole sections have drifted apart.',
    rumour: 'A few yellow and orange stars measure dimmer than their spectral class predicts, and brighter in the infrared.',
    notes: [
      'The surviving collectors still balance on the star\'s light, though the network that steered them is dead.',
      'Loose collectors drift outside the main shell, tumbling on whatever orbit they were left in.',
    ],
  },
  matrioshkaBrain: {
    name: 'Matrioshka Brain',
    tier: 'Mythic',
    lore: 'A stack of concentric Dyson shells, each one running on waste heat from the shell inside it. The computation the structure was built for is no longer running, or is running for no one.',
    rumour: 'A system with unusually many shells is worth a closer look at its innermost star.',
    notes: [
      'Each shell runs colder than the one it encloses, and the outermost is barely above the surrounding temperature.',
      'The Dyson spheres nearby use a cruder version of the same collector design. The builders enclosed other stars before they attempted this one.',
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
  homeworld: {
    name: 'Ruined Homeworld',
    tier: 'Relic',
    lore: 'The world where this civilisation began, covered from pole to pole in a single continuous city. Its oceans were drained or roofed over long ago. Whatever else they had built went quiet within the same narrow interval, though no warning could have crossed the distances between them in time.',
    rumour: 'Every set of ruins seems to gather around one yellow or orange star near its middle.',
    notes: [
      'The surface is structure all the way down, with no coastline or open ground left anywhere on it.',
      'A few districts on the night side still light up on a schedule, though nothing travels between them.',
      'The ruins end in a compact web around a few depleted reservoirs of negative-energy condensate. Their builders could use it, but no surviving facility could manufacture it.',
    ],
  },
};

export const ANOMALY_LORE_LIVING: Partial<Record<AnomalyKind, AnomalyLore>> = {
  alcubierreCannon: {
    name: 'Alcubierre Cannon',
    tier: 'Mythic',
    lore: 'A line of warp coils at the edge of a living civilisation, charged and aimed outward along a bearing its builders chose long ago, and it has never fired. A shot would send a sacrificial mass inside an uncrewed warp bubble, and radiation caught against its forward horizon would destroy whatever lay at the other end before any warning could arrive.',
    rumour: 'A star at the edge of one of the flattened home systems sits inside a long line of lit rings, aimed away from everything around it.',
    notes: [
      'The coils hold their charge around a contained bubble at the breech. A test pulse runs down the barrel at intervals and stops at the muzzle.',
      'Firing it would spend nearly all of the civilisation\'s negative-energy condensate and leave travel between its systems crippled for a very long time.',
      'The bearing points beyond the settled region toward nothing any survey has found. Nothing about the cannon is hidden, as though its builders want it seen.',
      'Every modelled trajectory resolves in the same galactic rest frame; none describes a path returning to its own past.',
    ],
  },
  aldersonDisk: {
    name: 'Alderson Disk',
    tier: 'Mythic',
    lore: 'The civilisation that began here built one flat disk around its star from every world in the inner system and far more material lifted off the star itself. It runs from the edge of the star\'s glare out past the line where water freezes, and it holds more ground than every planet in the galaxy put together.',
    rumour: 'A few home stars have no inner planets left, only something wide and flat where they used to be.',
    notes: [
      'The star sits in a hole at the centre and never climbs far above anyone\'s horizon, so the outer reaches live in a dusk that does not end.',
      'The lights grow denser toward the rim, where the dusk is deepest, and none of them have gone out.',
      'Thrusters along the inner edge fire without pause to hold the star at the centre. Left alone, it would drift into the disk.',
      'The disk is built from a material no survey has found anywhere else. Nothing ordinary could carry the stresses inside it.',
    ],
  },
  caplanThruster: {
    name: 'Caplan Thruster',
    tier: 'Relic',
    lore: 'A stellar engine that uses the star it moves as propellant. Collectors heat one patch of the star to drive off a stream of gas, and an engine held behind the star fuses that gas into a jet at about a hundredth of the speed of light. A second jet fired back into the star keeps the engine from falling in and pushes the star ahead of it.',
    rumour: 'Stars sitting well above the galactic plane, trailing a long straight jet, are worth checking.',
    notes: [
      'The star moves farther in a million years under this engine than a mirror-driven thruster could push it in tens of millions.',
      'The engine takes mass off the star for good. A lighter star burns more slowly, so this one will outlive the lifetime it was born with.',
      'The heading has not changed since the engine was lit, and the jet has not paused.',
    ],
  },
  dysonSphere: {
    name: 'Dyson Complex',
    tier: 'Relic',
    lore: 'A closed swarm of collectors around a star, packed so densely that none of its light escapes unused. No rigid shell could survive around a star, so each collector holds its own station, and foundries on every rocky world in the system build their replacements from the surface down.',
    rumour: 'A few yellow and orange stars have gone dark in visible light while still glowing in the infrared.',
    notes: [
      'Every rocky world is cut into terraces from pole to pole, and their furnaces light the night sides from one horizon to the other.',
      'Every collector is a separate craft. The shell looks closed only because there are so many of them.',
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
      'The Dyson spheres nearby use a cruder version of the same collector design. The builders enclosed other stars before they attempted this one.',
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
  homeworld: {
    name: 'Homeworld',
    tier: 'Relic',
    lore: 'The world where this civilisation began, covered from pole to pole in a single continuous city. Its oceans were drained or roofed over long ago, and the ones who did it never left.',
    rumour: 'Every set of ruins seems to gather around one yellow or orange star near its middle.',
    notes: [
      'The night side is lit from one terminator to the other, bright enough to read against the planet\'s own shadow.',
      'At some wavelengths the planet is louder than its star.',
      'Interstellar traffic follows a few costly corridors and returns to rare reservoir systems to replace the negative-energy condensate consumed in transit. Beyond that compact web, there are probes but no dependent settlements.',
    ],
  },
};

const HOME_SWARM_NOTE = 'A swarm of collectors rings the home star. Its rings are spaced to take much of the light while leaving enough to keep the homeworld lit.';

const HOME_SWARM_NOTE_RUINED = 'A swarm of collectors still rings the home star, with gaps in every ring where failed collectors were never replaced.';

export function getAnomalyLore(source: { kind: AnomalyKind; living: boolean; swarm?: boolean }): AnomalyLore {
  const lore = (source.living ? ANOMALY_LORE_LIVING[source.kind] : undefined) ?? ANOMALY_LORE[source.kind];
  if (!source.swarm) return lore;
  return { ...lore, notes: [...lore.notes, source.living ? HOME_SWARM_NOTE : HOME_SWARM_NOTE_RUINED] };
}
