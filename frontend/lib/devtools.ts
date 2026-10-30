/**
 * The one link between the site and the dev-only ship terminal. Pages call openTerminal(); the
 * terminal (loaded only in dev builds, see components/shell.tsx) listens. Keeping this apart from
 * components/terminal.tsx means pages never import the terminal itself, so release builds don't
 * bundle it.
 */
type Listener = (cmd?: string) => void;
const openers = new Set<Listener>();

/** Opens the terminal, optionally pre-typing a command. Does nothing in release builds. */
export function openTerminal(cmd?: string): void {
  openers.forEach((fn) => fn(cmd));
}

export function onOpenTerminal(fn: Listener): () => void {
  openers.add(fn);
  return () => {
    openers.delete(fn);
  };
}
