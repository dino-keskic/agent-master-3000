import { useCallback, useState } from 'react';

/**
 * An on/off preference that outlives the panel it was set in — whether the
 * task details are showing. Off until it is turned on.
 */
export function useStoredFlag(key: string): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setOn((prev) => {
      try {
        window.localStorage.setItem(key, prev ? '0' : '1');
      } catch {
        // A private window: the preference just lasts for this page.
      }
      return !prev;
    });
  }, [key]);
  return [on, toggle];
}
