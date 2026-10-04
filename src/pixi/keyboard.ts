import { useBaseStore } from '../store/baseStore';

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export function isKeyboardCaptured(): boolean {
  return useBaseStore.getState().open;
}

export function ignoresKey(event: KeyboardEvent): boolean {
  return isEditable(event.target) || isKeyboardCaptured();
}
