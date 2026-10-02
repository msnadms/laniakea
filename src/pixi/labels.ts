import { Container, Graphics, Text } from 'pixi.js';

const SUBTITLE_SCALE = 0.42;
const SUBTITLE_GAP = 0.12;

export function makeLabelBox(label: string, fontSize: number, alpha: number, subtitle?: string) {
  const textObj = new Text({
    text: label,
    style: { fontFamily: 'Saira Condensed', fontSize, fill: 0x8ec4d4, align: 'center' },
  });
  textObj.anchor.set(0.5, 0.5);
  const subObj = subtitle
    ? new Text({
      text: subtitle,
      style: { fontFamily: 'Saira Condensed', fontSize: fontSize * SUBTITLE_SCALE, fill: 0x5f93a6, align: 'center' },
    })
    : null;
  const gap = subObj ? fontSize * SUBTITLE_GAP : 0;
  const contentW = Math.max(textObj.width, subObj?.width ?? 0);
  const contentH = textObj.height + gap + (subObj?.height ?? 0);
  textObj.position.set(0, -contentH / 2 + textObj.height / 2);
  if (subObj) {
    subObj.anchor.set(0.5, 0.5);
    subObj.position.set(0, contentH / 2 - subObj.height / 2);
  }
  const padX = fontSize * 0.45;
  const padY = fontSize * 0.28;
  const r = fontSize * 0.25;
  const w = contentW + padX * 2;
  const h = contentH + padY * 2;
  const bgGfx = new Graphics();
  bgGfx.roundRect(-w / 2, -h / 2, w, h, r);
  bgGfx.fill({ color: 0x000810, alpha: 0.18 });
  bgGfx.roundRect(-w / 2, -h / 2, w, h, r);
  bgGfx.stroke({ color: 0x00b4ff, alpha, width: 1.5 });
  const box = new Container();
  box.addChild(bgGfx);
  box.addChild(textObj);
  if (subObj) box.addChild(subObj);
  return { box, h };
}

interface PointerLabelOptions {
  lineLength?: number;
  dotRadius?: number;
  alpha?: number;
  lineWidth?: number;
  direction?: 1 | -1;
  subtitle?: string;
}

export function createPointerLabel(
  label: string,
  fontSize: number,
  opts: PointerLabelOptions = {}
): Container {
  const {
    lineLength = 120,
    dotRadius = 7,
    alpha = 0.8,
    lineWidth = 5,
    direction = 1,
    subtitle,
  } = opts;

  const { box, h } = makeLabelBox(label, fontSize, alpha, subtitle);

  const diagLen = lineLength / 2;
  const kx = direction * (diagLen / 1.5); // shallower than 45°: horizontal = half of vertical

  const lineGfx = new Graphics();
  lineGfx.moveTo(0, 0);
  lineGfx.lineTo(kx, -(dotRadius + diagLen));
  lineGfx.lineTo(kx, -(dotRadius + lineLength));
  lineGfx.stroke({ color: 0x0088bb, alpha, width: lineWidth });
  lineGfx.circle(0, 0, dotRadius);
  lineGfx.fill({ color: 0x0088bb, alpha });

  box.position.set(kx, -(dotRadius + lineLength + h / 2));

  const group = new Container();
  group.addChild(lineGfx);
  group.addChild(box);
  return group;
}
