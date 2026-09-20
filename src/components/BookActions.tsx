import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, Ellipsis, Pin, Star } from 'lucide-react';
import type { Book } from '../../shared/types';
import type { BookFlags } from '../../shared/book-flags';

// Five fixed beats use six positions without a clockwise/chasing pattern.
const featuredSparkleBeats = [[0, 3], [1, 4, 5], [2], [0, 2, 4], [1, 5]] as const;

export function BookBadges({ book }: { book: Book }) {
  if (!book.pinned && !book.featured) return null;
  return (
    <span className="book-badges">
      {book.pinned && (
        <span className="book-badge book-badge-pin">
          <Pin size={12} aria-hidden="true" />
          置顶
        </span>
      )}
      {book.featured && <FeaturedBadge />}
    </span>
  );
}

export function FeaturedBadge() {
  return (
    <span className="book-badge book-badge-featured">
      <span className="featured-content">
        <Star size={12} aria-hidden="true" />
        <span>精选</span>
        <span className="featured-shine" aria-hidden="true">
          <Star size={12} />
          <span>精选</span>
        </span>
      </span>
      <span className="featured-sparkles" aria-hidden="true">
        {featuredSparkleBeats.map((positions, beat) => (
          <span className="featured-sparkle-beat" key={beat}>
            {positions.map((position) => (
              <span
                className={`featured-sparkle featured-sparkle-position-${position}`}
                key={position}
              />
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}

export function BookActions({
  book,
  open,
  onOpenChange,
  onUpdate,
  onExport,
}: {
  book: Book;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (flags: BookFlags) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const close = (restoreFocus = false) => {
    onOpenChange(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)),
      top: Math.max(
        8,
        anchor.bottom + bounds.height + 8 <= innerHeight
          ? anchor.bottom + 8
          : anchor.top - bounds.height - 8,
      ),
    });
    menu.current.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  });
  async function run(action: () => Promise<void>) {
    close(true);
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        className="icon-button book-more"
        aria-label={`更多操作：${book.title.replace(/\n/g, '')}`}
        title="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-busy={pending}
        aria-disabled={pending}
        onClick={() => !pending && onOpenChange(!open)}
        onKeyDown={(event) => {
          if (!pending && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <Ellipsis size={19} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={`${book.title}的更多操作`}
            className="book-actions-menu"
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') {
                close(true);
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button')];
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                        items.length;
                items[next]?.focus({ preventScroll: true });
              }
            }}
          >
            <button
              role="menuitemcheckbox"
              aria-checked={Boolean(book.pinned)}
              onClick={() => void run(() => onUpdate({ pinned: !book.pinned }))}
            >
              <Pin size={16} aria-hidden="true" />
              <span>{book.pinned ? '取消置顶' : '置顶'}</span>
              {book.pinned && <Check size={14} className="menu-check" aria-hidden="true" />}
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={Boolean(book.featured)}
              onClick={() => void run(() => onUpdate({ featured: !book.featured }))}
            >
              <Star size={16} aria-hidden="true" />
              <span>{book.featured ? '取消精选' : '设为精选'}</span>
              {book.featured && <Check size={14} className="menu-check" aria-hidden="true" />}
            </button>
            <div className="book-menu-divider" role="separator" />
            <button role="menuitem" onClick={() => void run(onExport)}>
              <Download size={16} aria-hidden="true" />
              <span>导出为 HTML</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
