import { useEffect } from 'react';
import { useQuestStore } from '../store/questStore';
import { useAuthStore } from '../store/authStore';
import { markQuestComplete } from '../firebase/quests';
import type { QuestId } from '../game/quests';

export function useQuestPersist() {
  useEffect(() => {
    let prev = useQuestStore.getState().completed;

    const unsubscribe = useQuestStore.subscribe((state) => {
      const { user, settingsLoaded } = useAuthStore.getState();
      const current = state.completed;
      if (user && settingsLoaded) {
        for (const id of Object.keys(current) as QuestId[]) {
          if (!prev[id]) markQuestComplete(user.uid, id);
        }
      }
      prev = current;
    });

    return unsubscribe;
  }, []);
}
