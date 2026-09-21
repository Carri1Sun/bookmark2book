import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Star } from 'lucide-react';
import { featuredMedals, normalizeMedalTier, type MedalTier } from '../../shared/featured-medals';

const sparkleBeats = [[0, 3], [1, 4, 5], [2], [0, 2, 4], [1, 5]] as const;

export function MedalVisual({ tier: savedTier }: { tier?: MedalTier }) {
  const tier = normalizeMedalTier(savedTier);
  const level = featuredMedals.find((medal) => medal.id === tier)?.level ?? 0;
  return (
    <span className={`book-badge book-badge-featured medal-visual medal-${tier}`}>
      {level >= 3 && <span className="medal-halo-glow" aria-hidden="true" />}
      {level === 4 && <span className="medal-aurora-fill" aria-hidden="true" />}
      {level >= 5 && <span className="medal-jewel-fill" aria-hidden="true" />}
      <span className="featured-content">
        <Star size={12} aria-hidden="true" />
        <span>精选</span>
        {level >= 1 && (
          <span className="featured-shine" aria-hidden="true">
            <Star size={12} />
            <span>精选</span>
          </span>
        )}
      </span>
      {level >= 2 && (
        <span className="featured-sparkles" aria-hidden="true">
          {sparkleBeats.map((positions, beat) => (
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
      )}
    </span>
  );
}

export function FeaturedBadge({
  tier: savedTier,
  onEquip,
}: {
  tier?: MedalTier;
  onEquip?: (tier: MedalTier) => Promise<void>;
}) {
  const tier = normalizeMedalTier(savedTier);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    arrow: 24,
    side: 'bottom',
    maxHeight: 500,
  });
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const focusOnOpen = useRef(false);
  function show(focus = false) {
    focusOnOpen.current = focus;
    window.dispatchEvent(new CustomEvent('featured-medal-open', { detail: id }));
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      const options = panel.current.querySelector<HTMLElement>('.medal-options');
      const fullHeight =
        panel.current.scrollHeight +
        (options ? options.scrollHeight - options.clientHeight : 0) +
        2;
      const below = innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const bottom = below >= Math.min(fullHeight, 480) || below >= above;
      const maxHeight = Math.max(100, bottom ? below : above);
      const height = Math.min(fullHeight, maxHeight);
      const left = Math.max(12, Math.min(rect.left - 16, innerWidth - width - 12));
      setPosition({
        left,
        top: bottom ? rect.bottom + 10 : Math.max(12, rect.top - height - 10),
        arrow: Math.max(14, Math.min(width - 14, rect.left + rect.width / 2 - left)),
        side: bottom ? 'bottom' : 'top',
        maxHeight,
      });
    };
    place();
    if (focusOnOpen.current) {
      panel.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
      focusOnOpen.current = false;
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const otherMedal = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener('featured-medal-open', otherMedal);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('featured-medal-open', otherMedal);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function equip(next: MedalTier) {
    if (!onEquip || busy.current || tier === next) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await onEquip(next);
    } catch (error) {
      setError((error as Error).message || '佩戴失败，请重试。');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // Exported HTML retains the worn appearance without presenting an inert control.
  if (!onEquip) return <MedalVisual tier={tier} />;
  return (
    <>
      <button
        className="featured-medal-trigger"
        type="button"
        ref={trigger}
        aria-label="精选勋章"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show();
        }}
        onClick={() => {
          if (!open) {
            show(true);
          } else
            panel.current
              ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
              ?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            show(true);
          }
        }}
      >
        <MedalVisual tier={tier} />
      </button>
      {open &&
        createPortal(
          <div
            className="medal-popover"
            ref={panel}
            id={id}
            role="dialog"
            aria-labelledby={`${id}-title`}
            data-side={position.side}
            style={
              {
                left: position.left,
                top: position.top,
                '--medal-arrow': `${position.arrow}px`,
                maxHeight: position.maxHeight,
              } as CSSProperties
            }
          >
            <h2 id={`${id}-title`}>已解锁以下勋章</h2>
            <div
              className="medal-options"
              aria-busy={saving}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const buttons = [
                  ...panel.current!.querySelectorAll<HTMLButtonElement>('.medal-option'),
                ];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              {featuredMedals.map((medal) => (
                <button
                  key={medal.id}
                  type="button"
                  className="medal-option"
                  aria-pressed={tier === medal.id}
                  aria-disabled={saving}
                  onClick={() => void equip(medal.id)}
                >
                  <span className="medal-preview" aria-hidden="true">
                    <MedalVisual tier={medal.id} />
                  </span>
                  <span className="medal-description">
                    <strong>{medal.name}</strong>
                    <small>{medal.requirement}</small>
                  </span>
                  {tier === medal.id && <span className="medal-equipped">已佩戴</span>}
                </button>
              ))}
            </div>
            {error && (
              <p className="medal-error" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
