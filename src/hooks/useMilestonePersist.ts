import { useEffect } from 'react';
import { useMilestoneStore } from '../store/milestoneStore';
import { useAuthStore } from '../store/authStore';
import { markMilestoneComplete } from '../firebase/milestones';
import type { MilestoneId } from '../game/milestones';

export function useMilestonePersist() {
  useEffect(() => {
    let prev = useMilestoneStore.getState().completed;

    const unsubscribe = useMilestoneStore.subscribe((state) => {
      const { user, settingsLoaded } = useAuthStore.getState();
      const current = state.completed;
      if (user && settingsLoaded) {
        for (const id of Object.keys(current) as MilestoneId[]) {
          if (!prev[id]) markMilestoneComplete(user.uid, id);
        }
      }
      prev = current;
    });

    return unsubscribe;
  }, []);
}
