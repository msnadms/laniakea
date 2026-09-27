import { useEffect, useState } from 'react';
import { discover, discoveryKey } from '../net/discoveries';

export function useFirstDiscoverer(superclusterSeed: number, galaxySeed: number | null): string | null {
  const key = discoveryKey(superclusterSeed, galaxySeed);
  const [found, setFound] = useState<{ key: string; firstBy: string } | null>(null);

  useEffect(() => {
    let live = true;
    discover(superclusterSeed, galaxySeed).then((discovery) => {
      if (live && discovery) setFound({ key, firstBy: discovery.firstBy });
    });
    return () => {
      live = false;
    };
  }, [key, superclusterSeed, galaxySeed]);

  return found?.key === key ? found.firstBy : null;
}
