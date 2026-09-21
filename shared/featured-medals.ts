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
  { id: 'gold', name: '编辑金章', requirement: '编辑精选', level: 0 },
  { id: 'shine', name: '流光', requirement: '累计 100 次阅读', level: 1 },
  { id: 'sparkles', name: '星芒', requirement: '累计 1,000 次阅读', level: 2 },
  { id: 'halo', name: '辉光', requirement: '累计 5,000 次阅读', level: 3 },
  { id: 'aurora', name: '极光', requirement: '累计 10,000 次阅读', level: 4 },
  { id: 'amethyst', name: '紫金', requirement: '累计 50,000 次阅读', level: 5 },
  { id: 'crimson', name: '绯金', requirement: '累计 100,000 次阅读', level: 6 },
] as const satisfies ReadonlyArray<{
  id: MedalTier;
  name: string;
  requirement: string;
  level: number;
}>;

// Keep legacy orbit and corona selections on their aurora replacement.
export function normalizeMedalTier(value: unknown): MedalTier {
  if (value === 'orbit' || value === 'corona') return 'aurora';
  return medalTiers.includes(value as MedalTier) ? (value as MedalTier) : 'gold';
}
