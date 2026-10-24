'use client';
/**
 * The squad roster as typed on the setup screen. Kept separately from the campaign so that
 * "Return to Squad Setup" brings the same Helldivers back, in the same order, even though the
 * campaign itself is discarded.
 */
const KEY = 'hd2e:roster:v1';

export function loadRoster(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length ? v : null;
  } catch {
    return null;
  }
}

export function saveRoster(names: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable: the roster just won't be remembered */
  }
}
