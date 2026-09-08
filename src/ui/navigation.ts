import { buildAddressComponent } from '../game/types';
import { getSuperclusterCoords, pushAttractorAddress } from '../game/superclusters';
import { galaxyTravelCost, superclusterTravelCost, flatTravelCost, trySpendTravelCost } from '../store/travelCosts';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { MSG_DRIVE_REQUIRED_GALAXY, MSG_DRIVE_REQUIRED_SUPERCLUSTER } from './strings';

function pushAttractor(ui: ReturnType<typeof useUIStore.getState>, sc: ReturnType<typeof useGameStore.getState>['supercluster'], dotX: number, dotY: number) {
  pushAttractorAddress(sc.attractors, dotX, dotY, ui.pushAddress, ui.removeAddressType);
}

export function canTravelToSupercluster(scSeed: number): boolean {
  const { supercluster } = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  if (supercluster.seed !== scSeed && driveA < 2) {
    triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
    return false;
  }
  return true;
}

export function canTravelToGalaxy(scSeed: number, galaxySeed: number): boolean {
  const game = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  if (!isCurrent) {
    if (game.supercluster.seed !== scSeed) {
      if (driveA < 2) { triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER); return false; }
    } else if (driveA < 1) {
      triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
      return false;
    }
  }
  return true;
}

export function canTravelToSystem(scSeed: number, galaxySeed: number, systemId: string): boolean {
  const game = useGameStore.getState();
  const { driveA, triggerHudNotify } = useUIStore.getState();
  const sameGalaxy = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  const targetSys = sameGalaxy ? game.galaxy.systems.find((s) => String(s.id) === systemId) : undefined;
  const isCurrent = sameGalaxy && (String(game.system?.id) === systemId || targetSys?.current === true);
  if (!isCurrent) {
    if (game.supercluster.seed !== scSeed) {
      if (driveA < 2) { triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER); return false; }
    } else if (game.galaxy.seed !== galaxySeed) {
      if (driveA < 1) { triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY); return false; }
    }
  }
  return true;
}

export function travelToSupercluster(scSeed: number, scName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  if (ui.checkDetectionLethal()) return;
  if (game.supercluster.seed !== scSeed) {
    if (ui.driveA < 2) {
      ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
      return;
    }
    if (!trySpendTravelCost(flatTravelCost(50))) return;
  }
  ui.clearAddress();
  game.regenerateSupercluster(scSeed);
  const [x, y, z] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, x, y, z, 'supercluster'));
  ui.removeAddressType('attractor');
  ui.setView('supercluster');
}

export function travelToGalaxy(scSeed: number, scName: string, galaxySeed: number, galaxyName: string) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  if (ui.checkDetectionLethal()) return;
  const isCurrent = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  if (!isCurrent) {
    let cost: { exotic: number; helium: number };
    if (game.supercluster.seed !== scSeed) {
      if (ui.driveA < 2) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
        return;
      }
      cost = flatTravelCost(50);
    } else {
      if (ui.driveA < 1) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
        return;
      }
      const currentDot = game.supercluster.dots.find((d) => d.seed === game.galaxy.seed);
      const targetDot = game.supercluster.dots.find((d) => d.seed === galaxySeed);
      const dist = Math.hypot((targetDot?.x ?? 0) - (currentDot?.x ?? 0), (targetDot?.y ?? 0) - (currentDot?.y ?? 0));
      cost = superclusterTravelCost(dist);
    }
    if (!trySpendTravelCost(cost)) return;
  }
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  const sc = useGameStore.getState().supercluster;
  game.markDotVisited(galaxySeed);
  const dot = sc.dots.find((d) => d.seed === galaxySeed);
  const [scx, scy, scz] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, scx, scy, scz, 'supercluster'));
  pushAttractor(ui, sc, dot?.x ?? 0, dot?.y ?? 0);
  ui.pushAddress(buildAddressComponent(galaxyName, dot?.x ?? 0, dot?.y ?? 0, dot?.z ?? 0, 'galaxy'));
  ui.setView('galaxy');
}

export function travelToSystem(
  scSeed: number, scName: string,
  galaxySeed: number, galaxyName: string,
  systemId: string, systemName: string,
) {
  const game = useGameStore.getState();
  const ui = useUIStore.getState();
  if (ui.checkDetectionLethal()) return;
  const sameGalaxy = game.supercluster.seed === scSeed && game.galaxy.seed === galaxySeed;
  const homeSys = sameGalaxy ? game.galaxy.systems.find((s) => String(s.id) === systemId) : undefined;
  const isCurrent = sameGalaxy && (String(game.system?.id) === systemId || homeSys?.current === true);
  if (!isCurrent) {
    let cost: { exotic: number; helium: number };
    if (game.supercluster.seed !== scSeed) {
      if (ui.driveA < 2) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_SUPERCLUSTER);
        return;
      }
      cost = flatTravelCost(50);
    } else if (game.galaxy.seed !== galaxySeed) {
      if (ui.driveA < 1) {
        ui.triggerHudNotify(MSG_DRIVE_REQUIRED_GALAXY);
        return;
      }
      cost = flatTravelCost(15);
    } else {
      const currentSystem = game.system;
      const fromX = currentSystem?.x ?? 0;
      const fromY = currentSystem?.y ?? 0;
      const targetSys = game.galaxy.systems.find((s) => String(s.id) === systemId);
      const dist = Math.hypot((targetSys?.x ?? 0) - fromX, (targetSys?.y ?? 0) - fromY);
      cost = galaxyTravelCost(dist);
    }
    if (!trySpendTravelCost(cost)) return;
  }
  ui.clearAddress();
  if (game.supercluster.seed !== scSeed) game.regenerateSupercluster(scSeed);
  game.regenerateGalaxy(galaxySeed);
  const state = useGameStore.getState();
  const system = state.galaxy.systems.find((s) => String(s.id) === systemId);
  if (!system) return;
  game.markDotVisited(galaxySeed);
  game.markSystemVisited(system.id);
  const updatedSystem = useGameStore.getState().galaxy.systems.find((s) => String(s.id) === systemId)!;
  game.setSystem(updatedSystem);
  const dot = state.supercluster.dots.find((d) => d.seed === galaxySeed);
  const [scx, scy, scz] = getSuperclusterCoords(scSeed);
  ui.pushAddress(buildAddressComponent(scName, scx, scy, scz, 'supercluster'));
  pushAttractor(ui, state.supercluster, dot?.x ?? 0, dot?.y ?? 0);
  ui.pushAddress(buildAddressComponent(galaxyName, dot?.x ?? 0, dot?.y ?? 0, dot?.z ?? 0, 'galaxy'));
  ui.pushAddress(buildAddressComponent(systemName, system.x, system.y, system.z, 'system'));
  ui.setView('system');
}
