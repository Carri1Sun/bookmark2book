import { useLayoutEffect, useRef } from 'react';
import type { Book } from '../../shared/types';
import { collectionArticles } from '../lib/collection';
import { BookCover, palettes } from './BookCover';
import { NotebookCover } from './NotebookCover';

type Rect = { left: number; top: number; width: number; height: number };
export interface OpeningState {
  book: Book;
  cover: Rect;
}

export function captureOpening(book: Book, trigger: HTMLElement): OpeningState | null {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const card = trigger.closest('.library-card');
  const cover = card?.querySelector<HTMLElement>('.book-object');
  if (!cover) return null;
  const rect = (element: HTMLElement): Rect => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  };
  if (!cover.clientWidth || !cover.clientHeight) return null;
  return {
    book,
    cover: rect(cover),
  };
}

export function CollectionOpening({
  opening,
  onFinish,
}: {
  opening: OpeningState;
  onFinish: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previews = collectionArticles(opening.book).slice(0, 4);
  useLayoutEffect(() => {
    const element = root.current;
    const documentElement = document.querySelector<HTMLElement>('.collection-document');
    const header = documentElement?.querySelector<HTMLElement>('.collection-header');
    const title = header?.querySelector<HTMLElement>('.collection-title');
    if (!element || !documentElement || !header || !title) {
      onFinish();
      return;
    }
    const book = element.querySelector<HTMLElement>('.opening-book')!;
    const front = element.querySelector<HTMLElement>('.book-front')!;
    const paper = element.querySelector<HTMLElement>('.opening-paper')!;
    const veil = element.querySelector<HTMLElement>('.opening-veil')!;
    const aspect = opening.cover.width / opening.cover.height;
    const narrow = innerWidth <= 600;
    const pageWidth = Math.min(
      narrow ? innerWidth * 0.76 : innerWidth * 0.31,
      Math.min(620, innerHeight * 0.6) * aspect,
    );
    const scale = pageWidth / opening.cover.width;
    const pageHeight = opening.cover.height * scale;
    // A spread is centered on desktop. On mobile the open right page fills the view.
    const pageLeft = narrow ? (innerWidth - pageWidth) / 2 : innerWidth / 2;
    const pageTop = Math.max(115, (innerHeight - pageHeight) / 2);
    const travel = `translate3d(${pageLeft - opening.cover.left}px,${pageTop - opening.cover.top}px,0) scale(${scale})`;
    const animations: Animation[] = [];
    const liftedCards: HTMLElement[] = [];
    const easing = 'cubic-bezier(.22,.7,.15,1)';
    let cancelled = false;
    const animate = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = node.animate(frames, { easing, fill: 'both', ...options });
      animations.push(animation);
      return animation;
    };
    const finish = () => {
      if (!cancelled) onFinish();
    };

    async function play() {
      element!.dataset.phase = 'opening';
      const openingAnimations = [
        animate(book, [{ transform: 'none' }, { transform: travel }], { duration: 300 }),
        animate(
          front,
          [
            {
              transform: 'rotateY(0deg)',
              backgroundColor: palettes[opening.book.palette].background,
            },
            { transform: 'rotateY(-18deg)', offset: 0.16 },
            { transform: 'rotateY(-168deg)', backgroundColor: '#eeeade' },
          ],
          { delay: 100, duration: 480 },
        ),
        animate(
          element!.querySelector<HTMLElement>('.cover-motif')!,
          [{ opacity: 0.77 }, { opacity: 0 }],
          { delay: 100, duration: 220 },
        ),
        animate(
          element!.querySelector<HTMLElement>('.cover-heading')!,
          [{ opacity: 1 }, { opacity: 0 }],
          { delay: 100, duration: 160 },
        ),
      ];
      element!.querySelectorAll<HTMLElement>('.opening-leaf').forEach((leaf, index) => {
        openingAnimations.push(
          animate(
            leaf,
            [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${-155 + index * 5}deg)` }],
            { delay: 160 + index * 30, duration: 360 },
          ),
        );
      });
      // The content cannot start until every part of the cover and pages has settled.
      await Promise.all(openingAnimations.map((animation) => animation.finished));
      if (cancelled) return;
      element!.dataset.phase = 'settling';
      const headerAnimations = [
        animate(header!, [{ opacity: 0 }, { opacity: 1 }], { duration: 320 }),
        animate(title!, [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }], {
          duration: 320,
        }),
      ];
      await animate(paper, [{ opacity: 1 }, { opacity: 1 }], { duration: 120 }).finished;
      if (cancelled) return;
      element!.dataset.phase = 'releasing';

      const cards = [...documentElement!.querySelectorAll<HTMLElement>('.article-card')];
      const thumbnails = [...element!.querySelectorAll<HTMLElement>('.opening-thumbnail')];
      const releaseAnimations: Animation[] = [...headerAnimations];
      thumbnails.forEach((thumbnail, index) => {
        const card = cards[index];
        if (!card) return;
        const preview = thumbnail.querySelector<HTMLElement>('.notebook-cover')!;
        const previewBounds = preview.getBoundingClientRect();
        const cover = card.querySelector<HTMLElement>('.notebook-cover')!;
        const cardBounds = card.getBoundingClientRect();
        const coverBounds = cover.getBoundingClientRect();
        const thumbnailScale = previewBounds.width / coverBounds.width;
        const x =
          previewBounds.left -
          cardBounds.left -
          (coverBounds.left - cardBounds.left) * thumbnailScale;
        const y =
          previewBounds.top - cardBounds.top - (coverBounds.top - cardBounds.top) * thumbnailScale;
        const origin = `translate3d(${x}px,${y}px,0) scale(${thumbnailScale})`;
        card.dataset.openingLift = 'true';
        liftedCards.push(card);
        releaseAnimations.push(
          animate(
            card,
            [
              { transform: origin, opacity: 0, offset: 0 },
              { transform: origin, opacity: 1, offset: 0.2, easing },
              {
                transform: `translate3d(${x}px,${y - 25}px,0) scale(${thumbnailScale * 1.06})`,
                opacity: 1,
                offset: 0.36,
                easing,
              },
              { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
            ],
            { duration: 540, delay: index * 30, easing: 'linear' },
          ),
          animate(thumbnail, [{ opacity: 1 }, { opacity: 0 }], {
            delay: index * 30,
            duration: 110,
            easing: 'linear',
          }),
          animate(cover.querySelector<HTMLElement>('h2')!, [{ opacity: 0 }, { opacity: 1 }], {
            delay: 90 + index * 30,
            duration: 240,
          }),
        );
        card
          .querySelectorAll<HTMLElement>(
            '.article-introduction,.article-source-note,.article-original',
          )
          .forEach((copy) => {
            releaseAnimations.push(
              animate(
                copy,
                [
                  { opacity: 0, transform: 'translateY(8px)' },
                  { opacity: 1, transform: 'translateY(0)' },
                ],
                { delay: 340 + index * 30, duration: 220 },
              ),
            );
          });
      });
      // Only animate additional cards that can be seen; long collections stay inexpensive.
      cards.slice(thumbnails.length).forEach((card) => {
        const bounds = card.getBoundingClientRect();
        if (bounds.top >= innerHeight || bounds.bottom <= 0) return;
        releaseAnimations.push(
          animate(card, [{ opacity: 0 }, { opacity: 1 }], { delay: 420, duration: 220 }),
        );
      });
      releaseAnimations.push(
        animate(book, [{ opacity: 1 }, { opacity: 0 }], { delay: 260, duration: 330 }),
        animate(veil, [{ opacity: 1 }, { opacity: 0 }], { delay: 200, duration: 390 }),
      );
      documentElement!.querySelectorAll<HTMLElement>('.collection-count').forEach((control) => {
        releaseAnimations.push(
          animate(control, [{ opacity: 0 }, { opacity: 1 }], { delay: 300, duration: 220 }),
        );
      });
      await Promise.all(releaseAnimations.map((animation) => animation.finished));
      finish();
    }
    void play().catch(finish);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', finish);
    window.addEventListener('resize', finish);
    return () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
      liftedCards.forEach((card) => delete card.dataset.openingLift);
      media.removeEventListener('change', finish);
      window.removeEventListener('resize', finish);
    };
  }, [opening, onFinish]);
  return (
    <div className="collection-opening" ref={root} aria-hidden="true">
      <div className="opening-veil" />
      <div
        className="opening-book"
        style={{
          left: opening.cover.left,
          top: opening.cover.top,
          width: opening.cover.width,
          height: opening.cover.height,
        }}
      >
        <div className="opening-paper">
          <div className="opening-thumbnails" data-count={previews.length}>
            {previews.map((article, index) => (
              <div className="opening-thumbnail" key={article.id}>
                <NotebookCover title="" index={index} skeleton />
              </div>
            ))}
          </div>
        </div>
        {[0, 1, 2].map((index) => (
          <div className="opening-leaf" key={index} />
        ))}
        <BookCover
          title={opening.book.title}
          palette={opening.book.palette}
          variant={Object.keys(palettes).indexOf(opening.book.palette)}
        />
      </div>
    </div>
  );
}
