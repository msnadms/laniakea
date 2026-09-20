import { useEffect, useRef, useState } from 'react';
import { useApplication } from '@pixi/react';
import { Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { FlyCamera } from '../game/types';
import {
  DRAG_THRESHOLD_PX,
  UNIVERSE_BOOST,
  UNIVERSE_FLIGHT_EASE,
  UNIVERSE_KEY_YAW_SPEED,
  UNIVERSE_LOOK_EASE,
  UNIVERSE_LOOK_SENSITIVITY,
  UNIVERSE_RADIUS,
  UNIVERSE_SPEED_DEFAULT,
  UNIVERSE_SPEED_MAX,
  UNIVERSE_SPEED_MIN,
  UNIVERSE_SPEED_STEP,
} from '../game/constants';
import { clampPitch, flyForward, flyRight } from './flyProjection';
import { isEditable } from './keyboard';
import { useScanStore } from '../store/scanStore';

const FRAME_MS = 1000 / 60;
const LOOK_SNAP = 1e-4;
const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);

export function useFlyCamera(initialPose: () => FlyCamera, isFrozen: () => boolean) {
  const { app, isInitialised } = useApplication();
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  }, [app]);
  const [camera] = useState(() => ({ current: initialPose() }));
  const [look] = useState(() => ({ current: { yaw: camera.current.yaw, pitch: camera.current.pitch } }));
  const speed = useRef(UNIVERSE_SPEED_DEFAULT);
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const didLook = useRef(false);
  const isFrozenRef = useRef(isFrozen);
  useEffect(() => {
    isFrozenRef.current = isFrozen;
  }, [isFrozen]);

  useEffect(() => {
    if (!isInitialised) return;
    const pixi = appRef.current;
    const stage = pixi.stage;
    const canvas = pixi.canvas;
    stage.eventMode = 'static';
    stage.hitArea = pixi.screen;

    const keys = new Set<string>();
    const velocity = { x: 0, y: 0, z: 0 };
    const forward = { x: 0, y: 0, z: 0 };
    const right = { x: 0, y: 0, z: 0 };
    const dragStart = { x: 0, y: 0, yaw: 0, pitch: 0 };
    let isLooking = false;

    const onDown = (event: FederatedPointerEvent) => {
      didLook.current = false;
      if (isFrozenRef.current() || useScanStore.getState().active) return;
      isLooking = true;
      dragStart.x = event.globalX;
      dragStart.y = event.globalY;
      dragStart.yaw = look.current.yaw;
      dragStart.pitch = look.current.pitch;
    };

    const onMove = (event: FederatedPointerEvent) => {
      pointer.current.x = event.globalX;
      pointer.current.y = event.globalY;
      pointer.current.inside = true;
      if (!isLooking) return;
      const deltaX = event.globalX - dragStart.x;
      const deltaY = event.globalY - dragStart.y;
      if (!didLook.current && (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX))
        didLook.current = true;
      if (!didLook.current) return;
      look.current.yaw = dragStart.yaw - deltaX * UNIVERSE_LOOK_SENSITIVITY;
      look.current.pitch = clampPitch(dragStart.pitch + deltaY * UNIVERSE_LOOK_SENSITIVITY);
    };

    const onUp = () => { isLooking = false; };
    const onLeave = () => { pointer.current.inside = false; };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const step = event.deltaY < 0 ? UNIVERSE_SPEED_STEP : 1 / UNIVERSE_SPEED_STEP;
      speed.current = Math.min(UNIVERSE_SPEED_MAX, Math.max(UNIVERSE_SPEED_MIN, speed.current * step));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!FLIGHT_KEYS.has(event.code) || isEditable(event.target)) return;
      keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => { keys.delete(event.code); };
    const onBlur = () => keys.clear();

    const tick = (ticker: Ticker) => {
      const cam = camera.current;
      if (isFrozenRef.current()) {
        velocity.x = 0;
        velocity.y = 0;
        velocity.z = 0;
        look.current.yaw = cam.yaw;
        look.current.pitch = cam.pitch;
        isLooking = false;
        return;
      }

      const turn = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      if (turn !== 0) {
        const step = turn * UNIVERSE_KEY_YAW_SPEED * ticker.deltaMS / 1000;
        look.current.yaw += step;
        dragStart.yaw += step;
      }

      const yawGap = look.current.yaw - cam.yaw;
      const pitchGap = look.current.pitch - cam.pitch;
      if (Math.abs(yawGap) < LOOK_SNAP && Math.abs(pitchGap) < LOOK_SNAP) {
        cam.yaw = look.current.yaw;
        cam.pitch = look.current.pitch;
      } else {
        const lookEase = 1 - Math.pow(1 - UNIVERSE_LOOK_EASE, ticker.deltaMS / FRAME_MS);
        cam.yaw += yawGap * lookEase;
        cam.pitch += pitchGap * lookEase;
      }

      const thrust = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const inputLength = Math.hypot(thrust, strafe);
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? UNIVERSE_BOOST : 1;
      const cruise = inputLength === 0 ? 0 : speed.current * boost / inputLength;
      flyForward(cam, forward);
      flyRight(cam, right);

      const flightEase = 1 - Math.pow(1 - UNIVERSE_FLIGHT_EASE, ticker.deltaMS / FRAME_MS);
      velocity.x += ((forward.x * thrust + right.x * strafe) * cruise - velocity.x) * flightEase;
      velocity.y += ((forward.y * thrust + right.y * strafe) * cruise - velocity.y) * flightEase;
      velocity.z += ((forward.z * thrust + right.z * strafe) * cruise - velocity.z) * flightEase;

      const seconds = ticker.deltaMS / 1000;
      cam.x += velocity.x * seconds;
      cam.y += velocity.y * seconds;
      cam.z += velocity.z * seconds;

      const radius = Math.hypot(cam.x, cam.y, cam.z);
      if (radius > UNIVERSE_RADIUS) {
        const nx = cam.x / radius;
        const ny = cam.y / radius;
        const nz = cam.z / radius;
        cam.x = nx * UNIVERSE_RADIUS;
        cam.y = ny * UNIVERSE_RADIUS;
        cam.z = nz * UNIVERSE_RADIUS;
        const outward = velocity.x * nx + velocity.y * ny + velocity.z * nz;
        if (outward > 0) {
          velocity.x -= nx * outward;
          velocity.y -= ny * outward;
          velocity.z -= nz * outward;
        }
      }
    };

    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      stage.off('pointerdown', onDown);
      stage.off('pointermove', onMove);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      keys.clear();
      didLook.current = false;
    };
  }, [app, isInitialised, camera, look]);

  return { flyCamera: camera, speed, pointer, didLook };
}
