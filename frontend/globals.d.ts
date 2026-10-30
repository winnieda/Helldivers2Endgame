/**
 * Build-time constants from next.config.ts (compiler.define).
 *
 * `__DEV_TOOLS__` is true in dev builds and false in release builds. Use it directly in a
 * condition (`{__DEV_TOOLS__ && <DevThing />}`, `__DEV_TOOLS__ ? a : b`), not through a variable,
 * so release bundles drop the dev-only branch entirely.
 */
declare const __DEV_TOOLS__: boolean;
/** Which build this is, e.g. "2026-10-29.a1b2c3d" (see next.config.ts). */
declare const __BUILD_ID__: string;
