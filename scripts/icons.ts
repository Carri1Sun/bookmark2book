import fs from 'node:fs/promises';

// Preserve Tabbit's native size-specific artwork and transparent rounded corners.
export async function buildIcons(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(
    [16, 32, 48, 128].map((size) =>
      fs.copyFile(`assets/tabbit/icon-${size}.png`, `${directory}/icon-${size}.png`),
    ),
  );
}
