import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { AUTOMATION_POLL_MS, useLogisticsStore } from '../store/logisticsStore';
import { useFabricatorStore } from '../store/fabricatorStore';
import { persistFabricatorRun } from '../store/persistRun';
import { saveLogisticsRoute } from '../firebase/logisticsRoutes';
import { useColonyStore } from '../store/colonyStore';
import { tickCivilization } from '../store/civStore';
import { useUIStore } from '../store/uiStore';

function campaignSignature() {
  const s = useUIStore.getState();
  return [s.geneLines, s.exposure, s.lastProbeEscapeAt, s.alienMatter, s.kardashevTier,
    s.strike, s.nextStrikeExposure, s.evacuatedPopulation].join('|');
}

export function useLogisticsAutomation() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let routeSaveTimer: ReturnType<typeof setTimeout>;
    // All mutation paths (charter, dispatch, install, evacuation, strikes) fan out here.
    // Serialize colony writes so a slow save cannot resurrect an evacuated settlement.
    let colonyWrites = Promise.resolve();
    const unsubscribeColonies = useColonyStore.subscribe((state, previous) => {
      const { user, settingsLoaded } = useAuthStore.getState();
      if (!user || !settingsLoaded || state.colonies === previous.colonies) return;
      const keys = [...new Set([...Object.keys(state.colonies), ...Object.keys(previous.colonies)])]
        .filter(key => state.colonies[key] !== previous.colonies[key]);
      colonyWrites = colonyWrites.then(() => persistFabricatorRun(user.uid, { colonyKeys: keys })).then(() => undefined)
        .catch(error => { console.error('Colony persistence failed', error); useUIStore.getState().triggerHudNotify('COLONY SAVE FAILED — CHECK CONNECTION'); });
    });

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
      try {
      const { user, settingsLoaded } = useAuthStore.getState();
      if (!cancelled && user && settingsLoaded) {
        const campaignBefore = campaignSignature();
        useUIStore.getState().tickRailgunSuppression();
        const colonyTick = useColonyStore.getState().tickColonies(Date.now());
        tickCivilization(Date.now());
        if (useUIStore.getState().destroyed) {
          return;
        }
        const holdFed = useFabricatorStore.getState().runHoldFeeds();
        const results = useLogisticsStore.getState().runAutomation();
        // Colony documents are written by the store subscription above, which sees every
        // mutation; passing their keys here as well would double every colony write.
        const extractorKeys = new Set([...colonyTick.extractorKeys, ...results.flatMap((result) => result.collected.map((entry) => entry.key))]);
        const fabricatorKeys = new Set([
          ...holdFed,
          ...colonyTick.fabricatorKeys,
          ...results.flatMap((result) => Object.keys(result.slotResults)),
        ]);
        const campaign = campaignSignature() !== campaignBefore;
        if (results.length > 0 || extractorKeys.size > 0 || fabricatorKeys.size > 0 || campaign) {
          await Promise.all([
            persistFabricatorRun(user.uid, { extractorKeys, fabricatorKeys, campaign }),
            ...(results.length > 0
              ? useLogisticsStore.getState().routes.map((route) => saveLogisticsRoute(user.uid, route))
              : []),
          ]);
        }
      }
      } catch (error) {
        console.error('Automation persistence failed', error);
        useUIStore.getState().triggerHudNotify('AUTOMATION SAVE FAILED — CHECK CONNECTION');
      } finally {
        if (!cancelled) timer = setTimeout(run, AUTOMATION_POLL_MS);
      }
    };

    timer = setTimeout(run, 3_000);
    return () => {
      cancelled = true;
      unsubscribeRoutes();
      unsubscribeColonies();
      clearTimeout(timer);
      clearTimeout(routeSaveTimer);
    };
  }, []);
}
