import React, { useMemo, useState } from 'react';
import { Combobox, useCombobox } from '@mantine/core';
import { Check, ChevronDown } from 'lucide-react';
import { filterInlineOptions, InlineOption, inlineTriggerText } from '../../../shared/composer/inlineSelect';

/**
 * A picker that reads as text until clicked: icon, the chosen label in full,
 * a small chevron.
 *
 * The composer's settings (model, agent, project, worktree…) used to be
 * unstyled Mantine `Select`s. Those are text inputs underneath, so their width
 * is a guess — a fixed max clipped long project and branch names, and
 * `field-sizing` does not work everywhere. This trigger is a button, so it is
 * exactly as wide as its label and never cuts one off unless the row itself
 * runs out of room.
 *
 * What a search leaves and what the closed picker reads are decided in
 * `shared/composer/inlineSelect.ts`.
 */

interface InlineSelectProps<T extends InlineOption> {
  value: string | null | undefined;
  options: T[];
  onChange: (value: string) => void;
  /** Names the picker for screen readers, and for the tooltip when there is no `title`. */
  label: string;
  icon?: React.ReactNode;
  /** Shown when nothing is chosen. Defaults to the lowercased `label`. */
  placeholder?: string;
  /** Adds a filter box above the list; worth it past a dozen options. */
  searchable?: boolean;
  /** How a row in the open list looks; the label alone when left out. */
  renderOption?: (option: T) => React.ReactNode;
  /** Hover text on the closed picker, e.g. the full path it stands for. */
  title?: string;
  /** Set the label in the mono face — for branch names and slugs. */
  mono?: boolean;
  disabled?: boolean;
}

export function InlineSelect<T extends InlineOption>({
  value,
  options,
  onChange,
  label,
  icon,
  placeholder,
  searchable = false,
  renderOption,
  title,
  mono = false,
  disabled = false
}: InlineSelectProps<T>) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch('');
    },
    onDropdownOpen: () => {
      if (searchable) combobox.focusSearchInput();
      combobox.updateSelectedOptionIndex('active');
    }
  });

  const shown = useMemo(() => filterInlineOptions(options, search), [options, search]);
  const trigger = inlineTriggerText(options, value, placeholder ?? label.toLowerCase());

  return (
    <Combobox
      store={combobox}
      // As wide as the longest row, so a branch name is read, not guessed at;
      // the viewport is the only limit.
      width="max-content"
      position="bottom-start"
      offset={4}
      disabled={disabled}
      onOptionSubmit={(picked) => {
        onChange(picked);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target targetType="button">
        <button
          type="button"
          aria-label={label}
          title={title ?? `${label}: ${trigger.text}`}
          disabled={disabled}
          onClick={() => combobox.toggleDropdown()}
          className="inline-flex items-center gap-1.5 h-7 max-w-full min-w-0 px-2 -mx-1 rounded-md text-[12px] leading-none font-medium cursor-pointer transition-colors hover:bg-ink/[0.06] data-[expanded]:bg-ink/[0.08] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {icon && <span className="shrink-0 flex items-center text-ink-3">{icon}</span>}
          <span
            className={`truncate ${mono ? 'font-mono text-[11.5px]' : ''} ${trigger.known ? 'text-ink' : 'text-ink-3'}`}
          >
            {trigger.text}
          </span>
          <ChevronDown className="w-3 h-3 shrink-0 text-ink-4" />
        </button>
      </Combobox.Target>

      <Combobox.Dropdown className="p-1" style={{ minWidth: 180, maxWidth: 'calc(100vw - 32px)' }}>
        {searchable && (
          <Combobox.Search
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              // The highlight moves to the first match so Enter takes it. It
              // is found in the DOM, so wait for the filtered list to render.
              requestAnimationFrame(() => combobox.selectFirstOption());
            }}
            placeholder="Filter…"
            size="xs"
          />
        )}
        <Combobox.Options mah={300} style={{ overflowY: 'auto' }}>
          {shown.length === 0 ? (
            <Combobox.Empty className="text-[12px]">{options.length ? 'Nothing matches' : 'Nothing to choose from'}</Combobox.Empty>
          ) : (
            shown.map((option) => {
              const selected = option.value === value;
              return (
                <Combobox.Option
                  key={option.value}
                  value={option.value}
                  active={selected}
                  className="flex items-center gap-2 rounded-md text-[12px]"
                >
                  <span className="min-w-0 flex-1">{renderOption ? renderOption(option) : option.label}</span>
                  <Check className={`w-3.5 h-3.5 shrink-0 text-accent ${selected ? '' : 'invisible'}`} />
                </Combobox.Option>
              );
            })
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
