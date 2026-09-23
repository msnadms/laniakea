import { create } from 'zustand';
import type { ScanFinding } from '../firebase/scans';
import type { ScanScope } from '../game/scan';
import { CONDENSATE_START } from '../game/constants';

export interface ScanProgress {
  scope: ScanScope;
  done: number;
  total: number;
}

export interface ScanOutcome {
  text: string;
  strength: number | null;
  at: number;
}

interface ScanState {
  condensate: number;
  active: boolean;
  progress: ScanProgress | null;
  outcome: ScanOutcome | null;
  findings: Record<string, ScanFinding>;
  setActive: (active: boolean) => void;
  toggleActive: () => void;
  setCondensate: (condensate: number) => void;
  gainCondensate: (amount: number) => void;
  spendCondensate: (amount: number) => boolean;
  setProgress: (progress: ScanProgress | null) => void;
  setOutcome: (text: string, strength: number | null) => void;
  clearOutcome: () => void;
  addFinding: (finding: ScanFinding) => void;
  removeFinding: (id: string) => void;
  setAllFindings: (findings: ScanFinding[]) => void;
  clearFindings: () => void;
}

export const useScanStore = create<ScanState>((set, get) => ({
  condensate: CONDENSATE_START,
  active: false,
  progress: null,
  outcome: null,
  findings: {},
  setActive: (active) => set({ active, progress: active ? get().progress : null }),
  toggleActive: () => set((state) => ({ active: !state.active, progress: null })),
  setCondensate: (condensate) => set({ condensate }),
  gainCondensate: (amount) => set((state) => ({ condensate: state.condensate + amount })),
  spendCondensate: (amount) => {
    if (get().condensate < amount) return false;
    set((state) => ({ condensate: state.condensate - amount }));
    return true;
  },
  setProgress: (progress) => set({ progress }),
  setOutcome: (text, strength) => set({ outcome: { text, strength, at: Date.now() } }),
  clearOutcome: () => set({ outcome: null }),
  addFinding: (finding) => set((state) => ({ findings: { ...state.findings, [finding.id]: finding } })),
  removeFinding: (id) => set((state) => {
    const findings = { ...state.findings };
    delete findings[id];
    return { findings };
  }),
  setAllFindings: (findings) => set({ findings: Object.fromEntries(findings.map((f) => [f.id, f])) }),
  clearFindings: () => set({ findings: {} }),
}));

export function superclusterFindings(findings: Record<string, ScanFinding>, superclusterSeed: number): ScanFinding[] {
  return Object.values(findings).filter((f) => f.scope === 'supercluster' && f.superclusterSeed === superclusterSeed);
}

export function galaxyWasScanned(
  findings: Record<string, ScanFinding>,
  superclusterSeed: number,
  x: number,
  y: number,
  z: number,
): boolean {
  return superclusterFindings(findings, superclusterSeed).some((finding) => {
    const dx = x - finding.x;
    const dy = y - finding.y;
    const dz = z - finding.z;
    return dx * dx + dy * dy + dz * dz <= finding.radius * finding.radius;
  });
}

export function universeFindings(findings: Record<string, ScanFinding>): ScanFinding[] {
  return Object.values(findings).filter((f) => f.scope === 'universe');
}
