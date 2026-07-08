const BOOT_FLAG_KEY = 'galaxy-game-booted';

export function consumeFirstVisit(): boolean {
  const firstTime = !localStorage.getItem(BOOT_FLAG_KEY);
  if (firstTime) localStorage.setItem(BOOT_FLAG_KEY, '1');
  return firstTime;
}

export function clearFirstVisit(): void {
  localStorage.removeItem(BOOT_FLAG_KEY);
}
