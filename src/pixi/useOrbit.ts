import { useEffect, useMemo, useRef } from 'react';
import { useApplication } from '@pixi/react';
import { Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { DRAG_THRESHOLD_PX, SC_ORBIT_EASE, SC_ORBIT_KEY_YAW_SPEED, SC_ORBIT_SENSITIVITY } from '../game/constants';
import { useUIStore } from '../store/uiStore';
import { useScanStore } from '../store/scanStore';
import { isEditable } from './keyboard';
import { clampOrbitTilt, createSuperclusterCamera, type Camera3D } from './projection';
import { isZoomAnimating } from './zoomAnim';

const FRAME_MS = 1000 / 60;

// The ease is asymptotic, so without a snap the camera keeps moving by fractions of
// a milliradian forever and nothing downstream can ever call itself unchanged.
const ORBIT_SNAP = 1e-4;

const TURN_KEYS = new Set(['KeyQ', 'KeyE']);

export interface OrbitConfig {
  createCamera: () => Camera3D;
  clampTilt: (tilt: number) => number;
  sensitivity: number;
  ease: number;
  keyYawSpeed?: number;
}

export const SUPERCLUSTER_ORBIT: OrbitConfig = {
  createCamera: createSuperclusterCamera,
  clampTilt: clampOrbitTilt,
  sensitivity: SC_ORBIT_SENSITIVITY,
  ease: SC_ORBIT_EASE,
  keyYawSpeed: SC_ORBIT_KEY_YAW_SPEED,
};

export function isOrbitGesture(event: { button: number; shiftKey: boolean }): boolean {
  return event.button === 2 || event.shiftKey;
}

export function useOrbit(config: OrbitConfig = SUPERCLUSTER_ORBIT) {
  const { app, isInitialised } = useApplication();
  const camera = useMemo(() => ({ current: config.createCamera() }), [config]);
  const target = useMemo(() => ({ current: config.createCamera() }), [config]);
  const isOrbiting = useRef(false);
  const didOrbit = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, yaw: 0, tilt: 0 });

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;
    const canvas = app.canvas;

    const onDown = (event: FederatedPointerEvent) => {
      didOrbit.current = false;
      if (!isOrbitGesture(event) || useScanStore.getState().active) return;
      isOrbiting.current = true;
      dragStart.current = {
        x: event.globalX,
        y: event.globalY,
        yaw: target.current.yaw,
        tilt: target.current.tilt,
      };
    };

    const onMove = (event: FederatedPointerEvent) => {
      if (!isOrbiting.current) return;
      const start = dragStart.current;
      const deltaX = event.globalX - start.x;
      const deltaY = event.globalY - start.y;
      if (!didOrbit.current && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX))
        didOrbit.current = true;
      target.current.yaw = start.yaw + deltaX * config.sensitivity;
      target.current.tilt = config.clampTilt(start.tilt - deltaY * config.sensitivity);
    };

    const onUp = () => { isOrbiting.current = false; };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const keys = new Set<string>();
    const keyYawSpeed = config.keyYawSpeed ?? 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!TURN_KEYS.has(event.code) || isEditable(event.target)) return;
      keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => { keys.delete(event.code); };
    const onBlur = () => keys.clear();

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    if (keyYawSpeed !== 0) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
    }

    const tick = (ticker: Ticker) => {
      const turn = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      if (turn !== 0 && !isZoomAnimating() && !useUIStore.getState().viewTransitioning) {
        const step = turn * keyYawSpeed * ticker.deltaMS / 1000;
        target.current.yaw += step;
        dragStart.current.yaw += step;
      }

      const yawGap = target.current.yaw - camera.current.yaw;
      const tiltGap = target.current.tilt - camera.current.tilt;
      if (Math.abs(yawGap) < ORBIT_SNAP && Math.abs(tiltGap) < ORBIT_SNAP) {
        camera.current.yaw = target.current.yaw;
        camera.current.tilt = target.current.tilt;
        return;
      }
      const ease = 1 - Math.pow(1 - config.ease, ticker.deltaMS / FRAME_MS);
      camera.current.yaw += yawGap * ease;
      camera.current.tilt += tiltGap * ease;
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      keys.clear();
      isOrbiting.current = false;
      didOrbit.current = false;
    };
  }, [app, isInitialised, camera, target, config]);

  return { orbitCamera: camera, orbitTarget: target, didOrbit };
}
