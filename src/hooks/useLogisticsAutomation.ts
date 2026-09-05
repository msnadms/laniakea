import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useLogisticsStore } from '../store/logisticsStore';
import { useExtractorStore } from '../store/extractorStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { useStockpileStore } from '../store/stockpileStore';
import { updateExtractorCollected } from '../firebase/extractors';
import { saveFabricatorState } from '../firebase/fabricators';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveStockpile } from '../firebase/stockpile';
import { saveLogisticsRoute } from '../firebase/logisticsRoutes';

const AUTOMATION_POLL_MS = 15_000;

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
        const results = useLogisticsStore.getState().runAutomation();
        if (results.length > 0) {
          const extractors = useExtractorStore.getState();
          const fabricators = useFabricatorStore.getState();
          const stockpile = useStockpileStore.getState();
          const touchedExtractors = new Set(results.flatMap((result) => result.collected.map((entry) => entry.key)));
          const touchedFabricators = new Set(results.flatMap((result) => Object.keys(result.slotResults)));
          await Promise.all([
            ...[...touchedExtractors].map((key) => updateExtractorCollected(user.uid, key, extractors.extractors[key]?.lastCollectedAt ?? Date.now())),
            ...[...touchedFabricators].map((key) => saveFabricatorState(user.uid, key, fabricators.fabricatorStates[key])),
            saveExtractorUpgrades(user.uid, { ownedUpgrades: extractors.ownedUpgrades, nodeEquipped: extractors.nodeEquipped }),
            saveStockpile(user.uid, stockpile.materials, stockpile.rares),
            ...useLogisticsStore.getState().routes.map((route) => saveLogisticsRoute(user.uid, route)),
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
