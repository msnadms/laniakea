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
  blackHole: {
    name: 'Black Hole',
    tier: 'Phenomenon',
    lore: 'A companion that gives no light of its own. The star beside it is being drawn out a thread at a time, and the thread glows only in the moment before it is gone.',
    rumour: 'They are found where neutron stars have gathered.',
    notes: [
      'The companion bends the light of the stars behind it into a thin ring that never breaks.',
      'Nothing that falls inside the disk has been seen to come back out.',
    ],
  },
  dysonSphere: {
    name: 'Ruined Dyson Sphere',
    tier: 'Relic',
    lore: 'The shell was never finished, or it was finished and then taken apart. The star still burns behind the gaps, warming no one.',
    rumour: 'Some yellow and orange stars burn dimmer than their class allows.',
    notes: [
      'The panels still keep their orbits, though nothing passes between them any more.',
      'Loose plates drift outside the shell, turning slowly where they were left.',
    ],
  },
  matrioshkaBrain: {
    name: 'Matrioshka Brain',
    tier: 'Mythic',
    lore: 'Shell inside shell, each living on the heat the last one threw away. Something in there is still thinking, very slowly, and has not noticed that it is alone.',
    rumour: 'Where the shells are many, look to the heart of them.',
    notes: [
      'Each shell runs a little colder than the one it encloses, and the last is barely warmer than the dark.',
      'Patterns of light cross the outer shell now and then, too slow to be read.',
    ],
  },
  nicollDysonBeam: {
    name: 'Nicoll-Dyson Beam',
    tier: 'Relic',
    lore: 'A swarm built to gather a star\'s light and send it somewhere far away. It still fires, in stutters now, toward a place that stopped answering long ago.',
    rumour: 'The line across the disk points home.',
    notes: [
      'The collectors still turn together, as they were told to long ago.',
      'Every pulse leaves along the same bearing, and none has been answered.',
    ],
  },
  shkadovThruster: {
    name: 'Shkadov Thruster',
    tier: 'Relic',
    lore: 'A mirror the size of a world holds half the star\'s light against itself, and the star, pushed by its own shine, has been leaving for a million years. Whoever set it moving is not aboard.',
    rumour: 'Some stars sit high above the disk, trailing a wake back the way they came.',
    notes: [
      'The mirror holds its station without drifting, balanced between the light and the pull of the star.',
      'The star has already climbed far above the disk it was born in.',
    ],
  },
};
