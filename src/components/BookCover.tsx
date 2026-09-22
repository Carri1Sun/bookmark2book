import type { MessageKey } from '../../shared/i18n';
import type { CSSProperties } from 'react';
import type { Palette } from '../../shared/types';

export const palettes: Record<
  Palette,
  { name: MessageKey; background: string; ink: string; accent: string }
> = {
  forest: {
    name: 'palette.forest',
    background: 'var(--cover-forest-bg)',
    ink: 'var(--cover-forest-ink)',
    accent: 'var(--cover-forest-accent)',
  },
  vermilion: {
    name: 'palette.vermilion',
    background: 'var(--cover-vermilion-bg)',
    ink: 'var(--cover-vermilion-ink)',
    accent: 'var(--cover-vermilion-accent)',
  },
  sand: {
    name: 'palette.sand',
    background: 'var(--cover-sand-bg)',
    ink: 'var(--cover-sand-ink)',
    accent: 'var(--cover-sand-accent)',
  },
  ink: {
    name: 'palette.ink',
    background: 'var(--cover-ink-bg)',
    ink: 'var(--cover-ink-ink)',
    accent: 'var(--cover-ink-accent)',
  },
};
export function CoverMotif({ variant = 0 }: { variant?: number }) {
  return (
    <svg className="cover-motif" viewBox="0 0 300 230" fill="none" aria-hidden="true">
      {variant % 3 === 0 ? (
        <g stroke="currentColor" strokeWidth=".8">
          {Array.from({ length: 18 }, (_, i) => (
            <ellipse
              key={i}
              cx="150"
              cy="116"
              rx={35 + i * 5.1}
              ry="94"
              transform={`rotate(${i * 6 - 48} 150 116)`}
            />
          ))}
        </g>
      ) : variant % 3 === 1 ? (
        <g stroke="currentColor" strokeWidth=".85">
          {Array.from({ length: 13 }, (_, i) => (
            <rect
              key={i}
              x={41 + i * 5.5}
              y={29 + i * 4}
              width={160 - i * 4.3}
              height={158 - i * 4.3}
              transform={`rotate(${i * 3 - 12} 150 115)`}
            />
          ))}
        </g>
      ) : (
        <g stroke="currentColor" strokeWidth="1">
          {Array.from({ length: 13 }, (_, i) => (
            <path key={i} d={`M ${35 + i * 17} 205 V ${180 - i * 12} H ${52 + i * 17} V 205`} />
          ))}
        </g>
      )}
    </svg>
  );
}
export function BookCover({
  title,
  palette = 'forest',
  variant = 0,
  image,
  className = '',
}: {
  title: string;
  palette?: Palette;
  variant?: number;
  image?: string;
  className?: string;
}) {
  const colors = palettes[palette];
  const titleLength = title.replace(/\s/g, '').length;
  const coverTitle =
    !title.includes('\n') && titleLength >= 8 && titleLength < 24
      ? title.replace(/([，、：])/, '$1\n')
      : title;
  return (
    <div
      className={`book-object ${className}`}
      style={
        {
          '--cover-bg': colors.background,
          '--cover-ink': colors.ink,
          '--cover-accent': colors.accent,
        } as CSSProperties
      }
    >
      <div className="book-pages" />
      <div className="book-front">
        {image && (
          <>
            <img className="cover-photo" src={image} alt="" aria-hidden="true" />
            <i className="cover-photo-scrim" aria-hidden="true" />
          </>
        )}
        <div className="cover-heading">
          <h3
            style={{
              fontSize: titleLength > 36 ? '6.4cqw' : titleLength > 18 ? '8.5cqw' : undefined,
            }}
          >
            {coverTitle}
          </h3>
        </div>
        {!image && <CoverMotif variant={variant} />}
      </div>
    </div>
  );
}
