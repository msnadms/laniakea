export const QUEST_IDS = [
  'first_galaxy',
  'first_system',
  'first_exotic',
  'first_habitable',
  'first_extractor',
  'first_fabricator',
  'upgrade_storage',
  'upgrade_drive',
  'new_supercluster',
  'delivery_network',
  'living_colony',
] as const;

export type QuestId = typeof QUEST_IDS[number];

export interface QuestDef {
  id: QuestId;
  title: string;
  description: string;
}

export const QUESTS: QuestDef[] = [
  { id: 'living_colony', title: 'Found a Colony', description: 'Deliver a charter and bring the Peregrine to found a human colony.' },
  { id: 'first_galaxy',      title: 'Galaxy Hopper',       description: 'Navigate to your first galaxy.' },
  { id: 'first_system',      title: 'Stellar Pioneer',     description: 'Enter a star system.' },
  { id: 'first_exotic',      title: 'Exotic Matter',       description: 'Collect exotic matter from a celestial body.' },
  { id: 'first_habitable',   title: 'Life Signs Detected', description: 'Discover a planet in the habitable zone.' },
  { id: 'first_extractor',   title: 'Mining Operations',   description: 'Deploy a mining extractor on a planet or moon.' },
  { id: 'first_fabricator',      title: 'First Fabricator',    description: 'Establish a fabricator on a habitable world.' },
  { id: 'upgrade_storage',   title: 'Expanded Cargo',      description: 'Upgrade your cargo storage capacity.' },
  { id: 'upgrade_drive',     title: 'Drive Enhancement',   description: 'Upgrade the Alcubierre drive systems.' },
  { id: 'new_supercluster',  title: 'Supercluster Jump',   description: 'Travel to a new supercluster region.' },
  { id: 'delivery_network',  title: 'Logistics Expanded',  description: 'Expand the automated extraction delivery network.' },
];
