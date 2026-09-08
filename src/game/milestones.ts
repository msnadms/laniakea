export const MILESTONE_IDS = [
  'first_habitable',
  'first_fabricator',
  'living_colony',
  'first_new_galaxy',
  'first_new_supercluster',
] as const;

export type MilestoneId = typeof MILESTONE_IDS[number];

export interface MilestoneDef {
  id: MilestoneId;
  title: string;
  description: string;
  flavor: string;
}

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'first_habitable',
    title: 'Habitable World',
    description: 'Discover a planet in the habitable zone.',
    flavor: 'Long-range scans confirm liquid water and a breathable atmosphere. This planet can support the colonists in the vault.',
  },
  {
    id: 'first_fabricator',
    title: 'First Fabricator',
    description: 'Establish a fabricator on a habitable world.',
    flavor: 'The fabricator is online. Raw material now becomes usable parts without a supply run home.',
  },
  {
    id: 'living_colony',
    title: 'Founded a Colony',
    description: 'Deliver a charter and bring the Peregrine to found a human colony.',
    flavor: 'The charter is filed and the settlers are down. A colony now stands on the surface, independent of the ship.',
  },
  {
    id: 'first_new_galaxy',
    title: 'New Galaxy',
    description: 'Travel to a galaxy beyond the Milky Way.',
    flavor: 'The jump drive lands outside the Milky Way for the first time. No star chart back home covers this galaxy.',
  },
  {
    id: 'first_new_supercluster',
    title: 'New Supercluster',
    description: 'Travel to a supercluster beyond Laniakea.',
    flavor: 'The ship crosses into a supercluster beyond Laniakea. Every galaxy out here is unmapped.',
  },
];

export function getMilestone(id: MilestoneId): MilestoneDef {
  const def = MILESTONES.find((m) => m.id === id);
  if (!def) throw new Error(`Unknown milestone id: ${id}`);
  return def;
}
