import type { SkillNode } from '../game/types';
import raw from './skillTree.json';

export const SKILL_NODES: SkillNode[] = raw.nodes as SkillNode[];

export function getSkillNode(id: string): SkillNode | undefined {
  return SKILL_NODES.find((n) => n.id === id);
}
