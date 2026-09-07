import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../firebase/firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
vi.mock('../firebase/colonies', () => ({ saveColony: vi.fn(async () => {}), deleteColony: vi.fn(async () => {}), deleteAllColonies: vi.fn(async () => {}) }));
vi.mock('../firebase/extractors', () => ({ updateExtractorCollected: vi.fn(async () => {}), deleteAllExtractors: vi.fn(async () => {}) }));
vi.mock('../firebase/fabricators', () => ({ saveFabricatorState: vi.fn(async () => {}), deleteAllFabricators: vi.fn(async () => {}) }));
vi.mock('../firebase/extractorUpgrades', () => ({ saveExtractorUpgrades: vi.fn(async () => {}) }));
vi.mock('../firebase/stockpile', () => ({ saveStockpile: vi.fn(async () => {}) }));
vi.mock('../firebase/userDoc', async importOriginal => {
  const original = await importOriginal<typeof import('../firebase/userDoc')>();
  return { ...original, saveCampaignProgress: vi.fn(async () => {}) };
});
import { saveColony, deleteColony } from '../firebase/colonies';
import { saveCampaignProgress, defaultSettings } from '../firebase/userDoc';
import { saveStockpile } from '../firebase/stockpile';
import { persistFabricatorRun } from './persistRun';
import { useColonyStore, charterSite } from './colonyStore';
import { applyUserSettings, useUIStore } from './uiStore';
import { useStockpileStore } from './stockpileStore';
import { useFabricatorStore } from './fabricatorStore';
import { useExtractorStore } from './extractorStore';
import type { Fabricator } from '../game/types';

const f: Fabricator = { key: '1|1|Haven', tier: 2, galaxySeed: 1, systemId: 1, systemName: 'Home', planetName: 'Haven',
  builtAt: 1, systemX: 0, systemY: 0, galaxyX: 0, galaxyY: 0, superclusSeed: 1 };
beforeEach(() => {
  vi.clearAllMocks(); applyUserSettings(defaultSettings);
  useColonyStore.setState({ colonies: {} });
  useFabricatorStore.setState({ fabricators: {}, fabricatorStates: {} });
  useExtractorStore.setState({ extractors: {}, ownedUpgrades: [], nodeEquipped: {} });
  useStockpileStore.setState({ materials: {}, rares: {} });
});

describe('colony persistence fan-out', () => {
  it('saves delivered assembly counts and campaign accounting together with the colony write', async () => {
    const colony = { ...charterSite(f, 100), assemblies: { ectogenesis_bank: 1 } };
    useColonyStore.setState({ colonies: { [f.key]: colony } });
    useStockpileStore.setState({ rares: { ectogenesis_bank: 0 } });
    useUIStore.setState({ exposure: 4 });
    await persistFabricatorRun('player', { colonyKeys: [f.key] });
    expect(saveColony).toHaveBeenCalledWith('player', colony);
    expect(saveStockpile).toHaveBeenCalledWith('player', {}, { ectogenesis_bank: 0 });
    expect(saveCampaignProgress).toHaveBeenCalledWith('player', expect.objectContaining({ exposure: 4 }));
  });
  it('serializes old writes before deletion so evacuation cannot be undone by a slow save', async () => {
    let finishSave!: () => void;
    vi.mocked(saveColony).mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    useColonyStore.setState({ colonies: { [f.key]: charterSite(f, 100) } });
    const saving = persistFabricatorRun('slow-player', { colonyKeys: [f.key] });
    await vi.waitFor(() => expect(saveColony).toHaveBeenCalled());
    useColonyStore.getState().removeColony(f.key);
    const deleting = persistFabricatorRun('slow-player', { colonyKeys: [f.key] });
    expect(deleteColony).not.toHaveBeenCalled();
    finishSave(); await saving; await deleting;
    expect(deleteColony).toHaveBeenCalledWith('slow-player', f.key);
  });
  it('restores missing campaign settings and clears campaign progress on reset', () => {
    const { exposure: _exposure, lastProbeEscapeAt: _escape, ...old } = defaultSettings;
    useUIStore.setState({ exposure: 50 });
    applyUserSettings(old as typeof defaultSettings);
    expect(useUIStore.getState().exposure).toBe(0);
    useUIStore.setState({ exposure: 50, alienMatter: 100, kardashevTier: 3 });
    useUIStore.getState().resetUpgrades();
    expect(useUIStore.getState()).toMatchObject({ exposure: 0, alienMatter: 0, kardashevTier: 0 });
  });
  it('drops removed cargo when loading an older stockpile', () => {
    useStockpileStore.getState().restoreStockpile({ viable_line: 0.75, graphene_lattice: 2 });
    expect(useStockpileStore.getState().materials).toEqual({ graphene_lattice: 2 });
  });
});
