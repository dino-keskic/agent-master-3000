import { useEffect, useRef, useState } from 'react';

/**
 * True when the container is narrower than `breakpoint` px.
 * Used by task-drawer master-detail panels so multi-pane split views stack
 * cleanly instead of using viewport media queries.
 */
export function useIsNarrowPane(breakpoint = 680): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setNarrow(el.clientWidth > 0 && el.clientWidth < breakpoint);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [breakpoint]);

  return [ref, narrow];
}
