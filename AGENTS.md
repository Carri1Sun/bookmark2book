# bookmark2book (Tabbit 文集)

A browser extension + web app that turns browser bookmarks into AI-curated collections.

## Build Conventions

- With every change, evaluate whether the extension frontend needs to be rebuilt. If it does:

  1. Increment the last (patch) digit of the extension version, located where `manifest.json` is generated in `scripts/build-extension.ts`.
  2. Rebuild the frontend (`pnpm build`) so `dist/extension` stays in sync with the source.

- Unless explicitly requested, do not change the first two digits (major / minor) of the extension version.
