'use client';
export type ToastTone = 'info' | 'good' | 'bad' | 'warn';
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}
type Listener = (t: Toast[]) => void;
let toasts: Toast[] = [];
let seq = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(toasts));

/** Shows a toast. A toast with the same title replaces the previous one instead of stacking. */
export function toast(title: string, body?: string, tone: ToastTone = 'info', ms = 4200): void {
  const t = { id: seq++, title, body, tone };
  const same = toasts.find((x) => x.title === title);
  if (same) {
    clearTimeout(timers.get(same.id));
    timers.delete(same.id);
    toasts = toasts.map((x) => (x === same ? t : x));
  } else toasts = [...toasts.slice(-3), t];
  emit();
  timers.set(
    t.id,
    setTimeout(() => {
      timers.delete(t.id);
      toasts = toasts.filter((x) => x.id !== t.id);
      emit();
    }, ms),
  );
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => listeners.delete(fn);
}
