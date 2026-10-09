export type ResourceKind = 'iron' | 'copper' | 'oil' | 'silica';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['iron', 'copper', 'oil', 'silica'];

export const RESOURCE_NAMES: Record<ResourceKind, string> = {
  iron: 'Iron ore',
  copper: 'Copper ore',
  oil: 'Oil',
  silica: 'Silica',
};

export type DepositGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const DEPOSIT_GRADES: readonly DepositGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

export const DEPOSIT_RATE_PER_HOUR: Record<DepositGrade, number> = {
  S: 120,
  A: 80,
  B: 55,
  C: 38,
  D: 26,
  E: 18,
  F: 12,
};

export const DEPOSIT_GRADE_FLOORS: Record<Exclude<DepositGrade, 'F'>, number> = {
  S: 0.9,
  A: 0.82,
  B: 0.75,
  C: 0.66,
  D: 0.57,
  E: 0.48,
};

export function gradeForScore(score: number): DepositGrade {
  for (const grade of DEPOSIT_GRADES) {
    if (grade === 'F' || score >= DEPOSIT_GRADE_FLOORS[grade]) return grade;
  }
  return 'F';
}

export function gradeRichness(grade: DepositGrade): number {
  return 1 - DEPOSIT_GRADES.indexOf(grade) / (DEPOSIT_GRADES.length - 1);
}
