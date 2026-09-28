import React from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { Monitor, Moon, Sun } from 'lucide-react';

/**
 * Light / system / dark, as a segmented control.
 *
 * Mantine owns the choice: it persists it and stamps
 * `data-mantine-color-scheme` on `<html>`, which is the same attribute the
 * colour tokens in `src/theme.css` key off. One switch, one source of truth,
 * and no chance of Mantine's own components disagreeing with the rest of the UI
 * about which scheme is on.
 */

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'auto', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon }
] as const;

export const ThemeToggle: React.FC = () => {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <div className="seg" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setColorScheme(value)}
          className={`seg-btn is-icon${value === colorScheme ? ' is-on' : ''}`}
          aria-pressed={value === colorScheme}
          title={label}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
};
