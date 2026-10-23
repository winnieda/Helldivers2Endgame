# Frontend

Next.js 15 (App Router) + React 19 + Tailwind CSS 4, exported as a static site. Run it from the
repository root with `npm run dev`; see the [root README](../README.md) for the full picture.

- `app/` holds the pages: landing, `play` (the game), `market`, `lab` (simulation bench) and `manual`.
- `components/` holds the shell and ship terminal, the icons (original SVG pictograms), the charts
  (hand-rolled SVG), and the per-page pieces.
- `lib/store.ts` owns all state: market, price history, active campaign and hall of fame. It's
  persisted to localStorage and synced across tabs.
- `lib/sim.worker.ts` runs Market Lab simulations off the main thread.

The economic engine is imported straight from `../engine/src` through the `@engine` path alias
(`experimental.externalDir` in `next.config.ts`), so the browser runs exactly the code the unit
tests and CLIs use.
