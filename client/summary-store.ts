// Tiny external store: the screen publishes the last summary, the sidebar row reads it.
// Keeps the row free of its own export call; it shows nothing until the screen has data.
export interface Summary {
  readonly short: string;
  readonly label: string;
}

let current: Summary | null = null;
const listeners = new Set<() => void>();

export const getSummary = (): Summary | null => current;

export function publishSummary(next: Summary | null): void {
  current = next;
  listeners.forEach((l) => l());
}

export function subscribeSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
