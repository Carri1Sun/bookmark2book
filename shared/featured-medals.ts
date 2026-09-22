import type { MessageKey } from './i18n';
export const medalTiers = [
  'gold',
  'shine',
  'sparkles',
  'halo',
  'aurora',
  'amethyst',
  'crimson',
] as const;
export type MedalTier = (typeof medalTiers)[number];

// Debug build: every featured collection can wear any tier; these are milestones, not read counts.
export const featuredMedals = [
  { id: 'gold', name: 'medal.gold', views: 0, level: 0 },
  { id: 'shine', name: 'medal.shine', views: 100, level: 1 },
  { id: 'sparkles', name: 'medal.sparkles', views: 1000, level: 2 },
  { id: 'halo', name: 'medal.halo', views: 5000, level: 3 },
  { id: 'aurora', name: 'medal.aurora', views: 10000, level: 4 },
  { id: 'amethyst', name: 'medal.amethyst', views: 50000, level: 5 },
  { id: 'crimson', name: 'medal.crimson', views: 100000, level: 6 },
] as const satisfies ReadonlyArray<{
  id: MedalTier;
  name: MessageKey;
  views: number;
  level: number;
}>;

// Keep legacy orbit and corona selections on their aurora replacement.
export function normalizeMedalTier(value: unknown): MedalTier {
  if (value === 'orbit' || value === 'corona') return 'aurora';
  return medalTiers.includes(value as MedalTier) ? (value as MedalTier) : 'gold';
}
