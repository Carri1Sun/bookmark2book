import { useLayoutEffect, useRef, type ReactNode } from 'react';

// Keep document scrolling native; only the header is anchored to the viewport.
export function FixedHeader({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const spacer = spacerRef.current;
    if (!enabled || !header || !spacer) return;
    const measure = () => {
      spacer.style.height = `${header.getBoundingClientRect().height}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [enabled]);

  // Standalone HTML exports retain their script-free sticky header.
  if (!enabled) return children;
  return (
    <>
      <div className="fixed-header" ref={headerRef}>
        {children}
      </div>
      <div className="fixed-header-spacer" ref={spacerRef} aria-hidden="true" />
    </>
  );
}
