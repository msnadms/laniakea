import type { ExtractorUpgrade } from '../game/types';
import raw from './upgrades.json';

export const EXTRACTOR_UPGRADES: ExtractorUpgrade[] = raw.extractorUpgrades as ExtractorUpgrade[];
