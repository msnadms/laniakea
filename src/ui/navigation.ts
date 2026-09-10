import { buildAddressComponent } from '../game/types';
import { getSuperclusterCoords, pushAttractorAddress } from '../game/superclusters';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';

function pushSupercluster(scSeed: number, scName: string) {
  const [x, y, z] = getSuperclusterCoords(scSeed);
  useUIStore.getState().pushAddress(buildAddressComponent(scName, x, y, z, 'supercluster'));
}

function pushGalaxy(galaxySeed: number, galaxyName: string) {
  const ui = useUIStore.getState();
  const sc = useGameStore.getState().supercluster;
  const dot = sc.dots.find((d) => d.seed === galaxySeed);
  pushAttractorAddress(sc.attractors, dot?.x ?? 0, dot?.y ?? 0, ui.pushAddress, ui.removeAddressType);
  ui.pushAddress(buildAddressComponent(galaxyName, dot?.x ?? 0, dot?.y ?? 0, dot?.z ?? 0, 'galaxy'));
}

export function travelToSupercluster(scSeed: number, scName: string) {
  const ui = useUIStore.getState();
  ui.clearAddress();
  useGameStore.getState().regenerateSupercluster(scSeed);
  pushSupercluster(scSeed, scName);
  ui.removeAddressType('attractor');
  ui.setView('supercluster');
}

export function travelToGalaxy(scSeed: number, scName: string, galaxySeed: number, galaxyName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  game.markDotVisited(galaxySeed);
  pushSupercluster(scSeed, scName);
  pushGalaxy(galaxySeed, galaxyName);
  ui.setView('galaxy');
}

export function travelToSystem(
  scSeed: number, scName: string,
  galaxySeed: number, galaxyName: string,
  systemId: string, systemName: string,
) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  const system = useGameStore.getState().galaxy.systems.find((s) => String(s.id) === systemId);
  if (!system) return;
  game.markDotVisited(galaxySeed);
  game.markSystemVisited(system.id);
  game.setSystem(useGameStore.getState().galaxy.systems.find((s) => s.id === system.id)!);
  pushSupercluster(scSeed, scName);
  pushGalaxy(galaxySeed, galaxyName);
  ui.pushAddress(buildAddressComponent(systemName, system.x, system.y, system.z, 'system'));
  ui.setView('system');
}
