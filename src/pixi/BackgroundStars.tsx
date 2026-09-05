import { useApplication } from '@pixi/react';
import { Container, Graphics, Ticker } from 'pixi.js';
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { BackgroundStar } from '../game/types';

interface Props {
  stars: BackgroundStar[];
  camera?: MutableRefObject<{ x: number; y: number; scale: number }>;
}

export function BackgroundStars({ stars, camera }: Props) {
  const { app, isInitialised } = useApplication();

  useEffect(() => {
    if (!isInitialised) return;
    const stage = app.stage;
    const renderer = app.renderer;

    const dimGfx = new Graphics();
    const brightGfx = new Graphics();
    for (const star of stars) {
      if (star.brightness <= 0.7) dimGfx.circle(star.x, star.y, 0.6);
      else brightGfx.circle(star.x, star.y, 1.0);
    }
    dimGfx.fill({ color: 0xffffff });
    brightGfx.fill({ color: 0xffffff });

    const bgContainer = new Container();
    bgContainer.position.set(app.screen.width / 2, app.screen.height / 2);
    bgContainer.addChild(dimGfx);
    bgContainer.addChild(brightGfx);
    stage.addChildAt(bgContainer, 0);

    const positionBackground = () => {
      const centerX = app.screen.width / 2;
      const centerY = app.screen.height / 2;
      const parallaxX = camera ? (camera.current.x - centerX) * 0.025 : 0;
      const parallaxY = camera ? (camera.current.y - centerY) * 0.025 : 0;
      bgContainer.position.set(centerX + parallaxX, centerY + parallaxY);
    };
    const onResize = () => positionBackground();
    renderer.on('resize', onResize);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
      positionBackground();
      dimGfx.alpha = 0.25 + Math.abs(Math.sin(elapsedSecs * 1.5)) * 0.55;
      brightGfx.alpha = 0.5 + Math.abs(Math.sin(elapsedSecs * 2.0 + 1.0)) * 0.5;
    };
    Ticker.shared.add(tick);

    return () => {
      Ticker.shared.remove(tick);
      renderer.off('resize', onResize);
      stage.removeChild(bgContainer);
      bgContainer.destroy({ children: true });
    };
  }, [app, camera, isInitialised, stars]);

  return null;
}
