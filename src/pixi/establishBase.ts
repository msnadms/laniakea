import { Container, Graphics } from 'pixi.js';
import { drawCrosshair } from './dotOverlays';
import { makeLabelBox } from './labels';

const LABEL = 'Establish Base';
const CONFIRM_LABEL = 'Tap again to settle here for good';
const LABEL_FONT_PX = 20;
const LABEL_GAP_PX = 10;
const CROSSHAIR_INNER = 12;
const CROSSHAIR_ARM = 38;
const NOTICE_SECS = 3;
const CONFIRM_SECS = 4;

export interface EstablishTarget {
  x: number;
  y: number;
  radius: number;
}

export interface EstablishOverlay {
  node: Container;
  hover: (ring: number | null) => void;
  establish: (ring: number) => void;
  target: () => number | null;
  update: (elapsed: number, target: EstablishTarget | null, cameraScale: number) => void;
  destroy: () => void;
}

export function createEstablishOverlay(canSettle: (ring: number) => boolean, found: (ring: number) => Promise<void>): EstablishOverlay {
  const node = new Container();
  node.visible = false;
  node.eventMode = 'none';
  const crosshair = new Graphics();
  let label = LABEL;
  let { box, h } = makeLabelBox(label, LABEL_FONT_PX, 0.85);
  node.addChild(crosshair, box);

  let hovered: number | null = null;
  let active: number | null = null;
  let now = 0;
  let busy = false;
  let noticeUntil = -Infinity;
  let armed: number | null = null;
  let armedUntil = -Infinity;
  let destroyed = false;

  const isArmed = () => armed !== null && now < armedUntil;

  const setText = (value: string) => {
    if (destroyed || label === value) return;
    label = value;
    box.destroy({ children: true });
    ({ box, h } = makeLabelBox(value, LABEL_FONT_PX, 0.85));
    node.addChild(box);
  };

  return {
    node,
    hover(ring) {
      hovered = ring;
      if (ring !== null) active = ring;
      if (ring !== null && ring !== armed) armed = null;
    },
    establish(ring) {
      if (busy) return;
      if (!isArmed() || armed !== ring) {
        armed = ring;
        armedUntil = now + CONFIRM_SECS;
        active = ring;
        noticeUntil = -Infinity;
        return;
      }
      armed = null;
      busy = true;
      active = ring;
      noticeUntil = -Infinity;
      setText('Establishing…');
      found(ring)
        .catch((err: unknown) => {
          setText(err instanceof Error ? err.message : 'The base could not be established');
          noticeUntil = now + NOTICE_SECS;
        })
        .finally(() => {
          busy = false;
        });
    },
    target() {
      if (active === null) return null;
      if (busy || now < noticeUntil || isArmed()) return active;
      return hovered === active && canSettle(active) ? active : null;
    },
    update(elapsed, target, cameraScale) {
      now = elapsed;
      if (!busy && now >= noticeUntil) setText(isArmed() ? CONFIRM_LABEL : LABEL);
      node.visible = target !== null;
      if (!target) return;
      const scale = Math.max(target.radius * 1.5 / CROSSHAIR_INNER, 0.6 / cameraScale);
      crosshair.clear();
      crosshair.position.set(target.x, target.y);
      crosshair.scale.set(scale);
      drawCrosshair(crosshair, 0, 0, elapsed);
      const labelScale = 1 / cameraScale;
      box.scale.set(labelScale);
      box.position.set(target.x, target.y - CROSSHAIR_ARM * scale - (LABEL_GAP_PX + h / 2) * labelScale);
    },
    destroy() {
      destroyed = true;
      node.destroy({ children: true });
    },
  };
}
