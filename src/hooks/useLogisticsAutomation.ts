import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { AUTOMATION_POLL_MS, useLogisticsStore } from '../store/logisticsStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { persistFabricatorRun } from '../store/persistRun';
import { saveLogisticsRoute } from '../firebase/logisticsRoutes';

export function useLogisticsAutomation() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let routeSaveTimer: ReturnType<typeof setTimeout>;

    const unsubscribeRoutes = useLogisticsStore.subscribe((state, previous) => {
      if (state.routes === previous.routes) return;
      clearTimeout(routeSaveTimer);
      routeSaveTimer = setTimeout(() => {
        const { user, settingsLoaded } = useAuthStore.getState();
        if (!user || !settingsLoaded) return;
        for (const route of useLogisticsStore.getState().routes) saveLogisticsRoute(user.uid, route);
      }, 500);
    });

    const run = async () => {
      const { user, settingsLoaded } = useAuthStore.getState();
      if (!cancelled && user && settingsLoaded) {
        const holdFed = useFabricatorStore.getState().runHoldFeeds();
        const results = useLogisticsStore.getState().runAutomation();
        if (results.length > 0 || holdFed.length > 0) {
          await Promise.all([
            persistFabricatorRun(user.uid, {
              extractorKeys: new Set(results.flatMap((result) => result.collected.map((entry) => entry.key))),
              fabricatorKeys: new Set([
                ...holdFed,
                ...results.flatMap((result) => Object.keys(result.slotResults)),
              ]),
            }),
            ...(results.length > 0
              ? useLogisticsStore.getState().routes.map((route) => saveLogisticsRoute(user.uid, route))
              : []),
          ]);
        }
      }
      if (!cancelled) timer = setTimeout(run, AUTOMATION_POLL_MS);
    };

    timer = setTimeout(run, 3_000);
    return () => {
      cancelled = true;
      unsubscribeRoutes();
      clearTimeout(timer);
      clearTimeout(routeSaveTimer);
    };
  }, []);
}
