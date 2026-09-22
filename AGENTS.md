# Tabbit 合辑 (tabbit-collections)

A browser extension + web app that turns browser bookmarks into AI-curated collections.

## Naming Conventions

- The product name is **Tabbit 合辑** in Simplified Chinese and **Tabbit Collections** in English. Use “合辑” / “collection” consistently in localized product copy.
- The package and message namespace is `tabbit-collections`; the extension archive is `dist/tabbit-collections-extension.zip`.
- `shared/branding.ts` owns branding accessors, the identifier, and the archive filename. Localized names and descriptions come from `shared/locales.ts`; do not duplicate them in runtime code or build scripts.
- Keep persisted identifiers in `src/lib/storage-keys.ts` stable: the legacy database and draft keys preserve existing user data. Likewise, preserve existing `books` stores, API routes, and saved `Book` fields unless an explicit migration is implemented. These are compatibility names, not product branding.
- The official Tabbit browser name and logo attribution are unchanged.

## Internationalization and Copy

- Support `zh-CN` and `en`. **All new product copy must be added to `shared/locales.ts` in both languages in the same change.** This includes UI labels, placeholders, accessible names, tooltips, badges, toasts, errors, progress, evidence prefixes, generated fallback labels, exports, and extension metadata. Never hardcode product sentences in components, services, or build scripts.
- Use semantic message keys. Use `useI18n()` in React, and `translate(locale, key, params)` with an explicit locale in shared/server code. Use named placeholders for whole sentences; do not concatenate translated fragments. Keep placeholders identical across languages and supply `enOne` for count-based singular forms when needed. Format dates and numbers using the active locale.
- The settings language selector applies immediately and persists via `uiLocaleKey`. The initial language follows the browser (`zh-*` → Simplified Chinese, other languages → English). Keep language preference separate from model/API settings.
- Use `AppError` with a message key for user-facing failures. API and extension messages carry serializable error descriptors; the UI translates them at render time. Never expose arbitrary provider errors or infer safety by matching Chinese error text. Persist progress descriptors so an in-flight job can be displayed in either UI language.
- Pass the UI locale through both HTTP and extension paths. Snapshot it in `Job.locale` when generation starts and save it in `Book.locale`. Do not use mutable process-wide language on the server or change a running job's output language. Missing locale in legacy records defaults to `zh-CN`; preserve existing content and storage identifiers.
- **All model instructions, examples, and retry instructions must be written in English and centralized in `shared/prompts.ts`.** Every generation stage must include `outputLanguage(locale)` and explicitly require all generated human-readable text to match the user's UI language. Keep JSON keys, enum values, IDs, proper names, and original user content intact. Use language-appropriate length limits in both prompts and schemas.
- A newly requested editorial introduction uses the current UI language, even for an older collection. Changing the interface language must not silently translate or regenerate saved titles, introductions, or bookmark folder names.
- Export UI labels and the HTML `lang` attribute use the selected export locale. Generate extension `_locales` files from the same copy resource during the build; do not edit generated translations under `dist/`.
- Validate both language variants, placeholder parity, plural forms, locale transport/persistence, model output-language instructions, and narrow-screen layouts. See `docs/internationalization.md` for the data flow.

## Webpage Analysis

- Bookmarks represent heterogeneous webpages, not just articles. Use neutral UI terms such as “网页”, “内容”, and “打开网页”.
- Keep all model instructions in `shared/prompts.ts`. The shared pipeline classifies page type, subject, confidence, and evidence before generating type-specific introductions.
- Preserve `Source.pageAnalysis` through saving; keep it optional for old collections. Treat model classifications and extracted metadata as untrusted, fallible inputs.
- Keep both extraction paths consistent. Neither static HTML extraction nor text-only model calls imply access to rendered pages, authenticated content, images, or audiovisual media.
- See `docs/webpage-analysis.md` for stages, request counts, and compatibility boundaries.

## Webpage Covers and Reader

- Keep both `Source.images.preview` and `Source.images.screenshot`; the display preference must never delete, regenerate, or overwrite the other source. Image work is separate from the text-only AI pipeline and requires no model calls.
- `shared/page-images.ts` owns candidate ranking, image types, validation, and queue limits. `shared/capture-page.ts` owns the shared viewport/capture logic. Cache bounded raster images in the extension `images` store or server `.data/images/`; book records contain asset IDs, never bulk base64 payloads.
- Backfill covers lazily for visible detail cards, with at most two captures running and six-hour negative caching. Preserve existing titles, summaries, flags, locale, and bookmarks; a deleted book must never be recreated by late capture results.
- The extension may attach `chrome.debugger` only to its own newly created inactive tabs. Always mute and close those tabs, including errors. Do not use `captureVisibleTab` or capture/attach to the user's existing tabs. Do not upload screenshots to a model or a third-party screenshot service.
- The local server uses isolated Chromium contexts. Keep all renderer requests on the public, DNS-pinned transport, including redirects and images; never substitute an unrestricted browser fetch or bypass private-network validation.
- Reader layout and cover preferences persist separately from API settings. Reuse `LayoutToggle` across home and detail; keep bilingual copy in the central dictionary and colors in `theme.css`. Respect reduced motion.
- HTML exports embed cached raster assets and the chosen layout/cover source; keep the restrictive offline CSP. Do not introduce remote image URLs or scripts into exports. See `docs/page-covers.md` for setup and limitations.

## Build Conventions

- With every change, evaluate whether the extension frontend needs to be rebuilt. If it does:

  1. Increment the last (patch) digit of the extension version, located where `manifest.json` is generated in `scripts/build-extension.ts`.
  2. Rebuild the frontend (`pnpm build`) so `dist/extension` stays in sync with the source.

- Unless explicitly requested, do not change the first two digits (major / minor) of the extension version.
