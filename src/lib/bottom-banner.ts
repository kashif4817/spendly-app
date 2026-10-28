/**
 * How much room the floating banners above the tab bar are taking.
 *
 * The banners (an update offer, an undo) sit just above the tab bar, which is
 * where every app that uses this pattern puts them and where they are closest
 * to the thumb. The floating Add button would be underneath, so it reads this
 * and lifts out of the way — the same thing Material does with a snackbar and
 * a FAB. Pushing the banners up above the button instead leaves them stranded
 * in the middle of the screen.
 *
 * A module-level store rather than context: the banners live at the root and
 * the button lives inside a screen, so there is no shared provider between
 * them without wrapping the whole app in one.
 */
const listeners = new Set<() => void>();
let height = 0;

/** Called by the banner stack whenever it is measured. 0 when nothing shows. */
export function setBannerHeight(next: number): void {
  // Layout fires on every re-render; without this the button's effect would
  // restart its animation each time and never settle.
  if (next === height) return;
  height = next;
  for (const listener of listeners) listener();
}

export function getBannerHeight(): number {
  return height;
}

export function subscribeBannerHeight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
