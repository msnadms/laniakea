import { useApplication } from '@pixi/react';
import { Container, Graphics, Ticker } from 'pixi.js';
import { useEffect } from 'react';
import type { BackgroundStar } from '../game/types';

interface Props {
  stars: BackgroundStar[];
}

export function BackgroundStars({ stars }: Props) {
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

    const onResize = () => bgContainer.position.set(app.screen.width / 2, app.screen.height / 2);
    renderer.on('resize', onResize);

    let elapsedSecs = 0;
    const tick = (ticker: Ticker) => {
      elapsedSecs += ticker.deltaMS / 1000;
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
  }, [app, isInitialised, stars]);

  return null;
}
