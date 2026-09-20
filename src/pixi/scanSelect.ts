import { Graphics, Text } from 'pixi.js';
import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { ScanSphere } from '../game/scan';
import { SCAN_MIN_DRAG_PX } from '../game/constants';
import { useScanStore } from '../store/scanStore';

export interface ScanAnchor {
  x: number;
  y: number;
  z: number;
  name: string;
  screenX: number;
  screenY: number;
}

export interface ScanAim {
  sphere: ScanSphere;
  cost: number;
  screenX: number;
  screenY: number;
  screenRadius: number;
}

const SELECT_COLOR = 0x00e8ff;
const DENIED_COLOR = 0xff5a3c;
const EMPTY_COLOR = 0x2a6a8a;
const TICK_PX = 7;
const HOVER_THROTTLE_MS = 40;
const ANCHOR_PX = 4;

export interface ScanSelectHandlers {
  targetNoun: string;
  anchorAt: (screenX: number, screenY: number) => ScanAnchor | null;
  aimAt: (anchor: ScanAnchor, screenX: number, screenY: number) => ScanAim | null;
  onAim: (aim: ScanAim | null) => void;
  onSelect: (aim: ScanAim) => void;
}

export function createScanSelect(app: Application, handlers: ScanSelectHandlers) {
  const gfx = new Graphics();
  gfx.eventMode = 'none';
  const label = new Text({ text: '', style: { fontFamily: 'IBM Plex Sans', fontSize: 13, fill: SELECT_COLOR } });
  label.anchor.set(0.5, 1);
  label.eventMode = 'none';
  label.visible = false;
  app.stage.addChild(gfx);
  app.stage.addChild(label);

  const pointer = { x: 0, y: 0 };
  let anchor: ScanAnchor | null = null;
  let dragging = false;
  let aim: ScanAim | null = null;
  let missed = false;
  let hoveredAt = 0;

  const clear = () => {
    dragging = false;
    missed = false;
    anchor = null;
    aim = null;
    gfx.clear();
    label.visible = false;
    handlers.onAim(null);
  };

  const drawMarker = (x: number, y: number, color: number) => {
    gfx.moveTo(x - TICK_PX, y).lineTo(x - ANCHOR_PX, y);
    gfx.moveTo(x + ANCHOR_PX, y).lineTo(x + TICK_PX, y);
    gfx.moveTo(x, y - TICK_PX).lineTo(x, y - ANCHOR_PX);
    gfx.moveTo(x, y + ANCHOR_PX).lineTo(x, y + TICK_PX);
    gfx.circle(x, y, ANCHOR_PX);
    gfx.stroke({ color, width: 1, alpha: 0.85 });
  };

  const redraw = () => {
    gfx.clear();
    aim = null;
    if (!anchor) {
      if (missed) {
        drawMarker(pointer.x, pointer.y, EMPTY_COLOR);
        label.text = `Sweep from a ${handlers.targetNoun}`;
        label.style.fill = EMPTY_COLOR;
        label.position.set(pointer.x, pointer.y - TICK_PX - 10);
        label.visible = true;
      } else {
        label.visible = false;
      }
      handlers.onAim(null);
      return;
    }

    const resolved = dragging ? handlers.aimAt(anchor, pointer.x, pointer.y) : null;
    aim = resolved && resolved.screenRadius >= SCAN_MIN_DRAG_PX ? resolved : null;
    handlers.onAim(aim);

    const affordable = aim !== null && useScanStore.getState().condensate >= aim.cost;
    const color = aim === null ? SELECT_COLOR : affordable ? SELECT_COLOR : DENIED_COLOR;
    const centreX = resolved?.screenX ?? anchor.screenX;
    const centreY = resolved?.screenY ?? anchor.screenY;
    drawMarker(centreX, centreY, color);

    label.text = aim === null
      ? `${anchor.name} — drag out to set the sweep`
      : affordable
        ? `${aim.cost} negative-energy condensate`
        : `${aim.cost} negative-energy condensate — insufficient`;
    label.style.fill = color;
    label.position.set(centreX, centreY - (aim?.screenRadius ?? TICK_PX) - 10);
    label.visible = true;
  };

  const onDown = (event: FederatedPointerEvent) => {
    if (event.button > 0 || useScanStore.getState().progress) return;
    pointer.x = event.globalX;
    pointer.y = event.globalY;
    anchor = handlers.anchorAt(pointer.x, pointer.y);
    dragging = anchor !== null;
    missed = anchor === null;
    redraw();
  };

  const onMove = (event: FederatedPointerEvent) => {
    pointer.x = event.globalX;
    pointer.y = event.globalY;
    if (dragging || missed) {
      redraw();
      return;
    }
    const now = performance.now();
    if (now - hoveredAt < HOVER_THROTTLE_MS) return;
    hoveredAt = now;
    anchor = handlers.anchorAt(pointer.x, pointer.y);
    redraw();
  };

  const onUp = () => {
    if (!dragging) {
      if (missed) clear();
      return;
    }
    const resolved = aim;
    clear();
    if (!resolved) return;
    if (!useScanStore.getState().spendCondensate(resolved.cost)) {
      useScanStore.getState().setOutcome('Not enough negative-energy condensate', null);
      return;
    }
    handlers.onSelect(resolved);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    clear();
    useScanStore.getState().setActive(false);
  };

  app.stage.on('pointerdown', onDown);
  app.stage.on('pointermove', onMove);
  app.stage.on('pointerup', onUp);
  app.stage.on('pointerupoutside', onUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    destroy() {
      app.stage.off('pointerdown', onDown);
      app.stage.off('pointermove', onMove);
      app.stage.off('pointerup', onUp);
      app.stage.off('pointerupoutside', onUp);
      window.removeEventListener('keydown', onKeyDown);
      app.stage.removeChild(gfx);
      app.stage.removeChild(label);
      gfx.destroy();
      label.destroy();
    },
  };
}
