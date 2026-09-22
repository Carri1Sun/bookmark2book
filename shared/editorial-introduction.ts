import { defaultLocale, type Locale } from './i18n';
import { z } from 'zod';
import { createModelClient } from './model';
import type { ModelSettings } from './settings';
import type { Book } from './types';
import { editorialIntroductionPrompt } from './prompts';

export async function generateEditorialIntroduction(
  book: Book,
  settings: ModelSettings,
  locale: Locale = defaultLocale,
) {
  return createModelClient(settings)(
    editorialIntroductionPrompt(book, locale),
    z.object({ introduction: z.string().trim().min(1).max(1000) }),
    AbortSignal.timeout(90000),
    800,
  );
}
