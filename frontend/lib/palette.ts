/**
 * Chart series colors, validated with the dataviz palette checker against the panel surface
 * #10151a in dark mode (lightness band, chroma, CVD ΔE, normal-vision ΔE, 3:1 contrast).
 *   factions (all-pairs):   worst CVD ΔE 11.3, normal-vision 19.3
 *   categories (adjacent):  worst CVD ΔE 8.4,  normal-vision 19.8
 * Identity never rides on color alone: charts carry a legend plus direct end labels.
 */
import type { Algorithm, Category, Faction } from '@engine';

export const FACTION_SERIES: Record<Faction, string> = {
  terminids: '#c68206',
  automatons: '#cf2845',
  illuminate: '#9769dc',
};

export const CATEGORY_SERIES: Record<Category, string> = {
  stratagem: '#3987e5',
  primary: '#d95926',
  secondary: '#199e70',
  throwable: '#c98500',
};

export const ALGORITHM_SERIES: Record<Algorithm, string> = {
  anchored: '#3987e5',
  legacy: '#d95926',
};

/** Status colors: always shipped with an icon + label. */
export const STATUS = {
  pass: '#0ca30c',
  warn: '#fab219',
  fail: '#d03b3b',
  info: '#8b98a5',
} as const;

export const CHART = {
  surface: '#10151a',
  grid: '#1f2830',
  axis: '#2e3a45',
  muted: '#8b98a5',
  text: '#e9edf0',
  text2: '#b9c3cc',
};
