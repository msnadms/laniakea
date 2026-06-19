import { useApplication } from '@pixi/react';
import { Container, Graphics, Text, Ticker } from 'pixi.js';
import { useEffect } from 'react';

const TARGET_BAR_PX = 300;

interface Props {
  camera: React.RefObject<{ scale: number }>;
  unitsPerWorldPx: number;
  unit: string;
  niceValues: number[];
}

export function ScaleBar({ camera, unitsPerWorldPx, unit, niceValues }: Props) {
  const { app, isInitialised } = useApplication();

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;

    const barGfx = new Graphics();
    const barLabel = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: 0x00bee6, align: 'center' },
    });
    barLabel.anchor.set(0.5, 1.0);
    barLabel.alpha = 0.75;

    const scaleGroup = new Container();
    scaleGroup.addChild(barGfx);
    scaleGroup.addChild(barLabel);
    stage.addChild(scaleGroup);

    let lastScale = -1;
    const update = () => {
      if (!app.renderer) return;
      const currentScale = camera.current.scale;
      if (currentScale === lastScale) return;
      lastScale = currentScale;

      const pxPerUnit = currentScale / unitsPerWorldPx;
      const targetUnits = TARGET_BAR_PX / pxPerUnit;
      let niceVal = niceValues[0];
      for (const v of niceValues) {
        if (Math.abs(v - targetUnits) < Math.abs(niceVal - targetUnits)) niceVal = v;
      }
      const barWidth = niceVal * pxPerUnit;

      scaleGroup.position.set(app.screen.width / 2, app.screen.height - 40);

      barGfx.clear();
      barGfx.moveTo(-barWidth / 2, 0).lineTo(barWidth / 2, 0);
      barGfx.stroke({ color: 0x00bee6, width: 2, alpha: 0.55 });
      barGfx.moveTo(-barWidth / 2, -8).lineTo(-barWidth / 2, 0);
      barGfx.stroke({ color: 0x00bee6, width: 1.5, alpha: 0.55 });
      barGfx.moveTo(barWidth / 2, -8).lineTo(barWidth / 2, 0);
      barGfx.stroke({ color: 0x00bee6, width: 1.5, alpha: 0.55 });

      barLabel.text = `${niceVal} ${unit}`;
      barLabel.position.set(0, -14);
    };

    Ticker.shared.add(update);
    const onResize = () => update();
    app.renderer.on('resize', onResize);

    return () => {
      Ticker.shared.remove(update);
      app.renderer?.off('resize', onResize);
      stage.removeChild(scaleGroup);
      scaleGroup.destroy({ children: true });
    };
  }, [isInitialised, app, unitsPerWorldPx, unit, niceValues]);

  return null;
}
