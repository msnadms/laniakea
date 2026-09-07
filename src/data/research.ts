import type { CivilizationResearchTier } from '../game/types';
import raw from './research.json';

export const CIVILIZATION_RESEARCH = raw.civilizationTiers as CivilizationResearchTier[];
export const CIVILIZATION_RESEARCH_BY_TIER = Object.fromEntries(
  CIVILIZATION_RESEARCH.map(entry => [entry.tier, entry]),
) as Record<1 | 2 | 3, CivilizationResearchTier>;

export function researchThreshold(tier: number): number {
  if (tier <= 0) return 0;
  return CIVILIZATION_RESEARCH_BY_TIER[Math.min(3, tier) as 1 | 2 | 3].threshold;
}

export function researchTier(points: number): number {
  let tier = 0;
  for (const entry of CIVILIZATION_RESEARCH) if (points >= entry.threshold) tier = entry.tier;
  return tier;
}
