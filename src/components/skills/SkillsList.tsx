import React, { useMemo, useState } from 'react';
import { ScrollArea, Switch, Tooltip } from '@mantine/core';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Folder,
  Globe,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Sparkles,
  WandSparkles
} from 'lucide-react';
import { STUDIO_LIST_BOUNDS } from '../../../shared/board/panelResize';
import { SkillItem, filterSkills, groupSkills } from '../../../shared/skills/skills';
import { Button, Chip, SearchInput, SegmentedControl } from '../ui';

interface SkillsListProps {
  skills: SkillItem[];
  selectedKey: string | null;
  creating: boolean;
  filter: string;
  busy?: boolean;
  onFilterChange: (value: string) => void;
  onSelect: (key: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onToggleSkill?: (name: string, enabled: boolean) => void;
  fullWidth?: boolean;
  width?: number;
  onCollapse?: () => void;
}

type ScopeFilter = 'all' | 'project' | 'global';
type GroupKey = 'project' | 'global';

export const SkillsList: React.FC<SkillsListProps> = ({
  skills,
  selectedKey,
  creating,
  filter,
  busy = false,
  onFilterChange,
  onSelect,
  onCreate,
  onRefresh,
  onToggleSkill,
  fullWidth = false,
  width = STUDIO_LIST_BOUNDS.defaultSize,
  onCollapse
}) => {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<GroupKey, boolean>>>({});

  const toggleGroup = (group: GroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const filtered = useMemo(() => {
    const byText = filterSkills(skills, filter);
    if (scopeFilter === 'project') return byText.filter((s) => s.scope === 'project');
    if (scopeFilter === 'global') return byText.filter((s) => s.scope === 'global');
    return byText;
  }, [skills, filter, scopeFilter]);

  const groups = useMemo(() => groupSkills(filtered), [filtered]);
  const counts = useMemo(
    () => ({
      all: skills.length,
      project: skills.filter((s) => s.scope === 'project').length,
      global: skills.filter((s) => s.scope === 'global').length
    }),
    [skills]
  );

  const renderItem = (skill: SkillItem) => {
    const isSelected = !creating && skill.key === selectedKey;
    const auxCount = skill.files.length;

    return (
      <div
        key={skill.key}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(skill.key)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(skill.key);
          }
        }}
        className={`w-full text-left rounded-xl p-2.5 transition-all duration-150 cursor-pointer border flex flex-col gap-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
          isSelected
            ? 'bg-acc-bg border-acc-bd shadow-card'
            : 'bg-surface border-line hover:border-line-strong hover:bg-s3h'
        } ${skill.disabled ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <WandSparkles
              className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-acc-fg' : 'text-ink-3'}`}
            />
            <span className="font-mono text-[12.5px] font-semibold text-ink truncate">
              /{skill.name}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {skill.disabled && <Chip>Off</Chip>}
            <Chip>{skill.layout}</Chip>
            {auxCount > 0 && (
              <Chip tone="accent" title={`${auxCount} bundled file(s)`}>
                <FileCode className="w-2.5 h-2.5" />
                {auxCount}
              </Chip>
            )}
            {onToggleSkill && (
              <Tooltip label={skill.disabled ? `Enable /${skill.name}` : `Disable /${skill.name}`} withArrow>
                <div
                  className="flex items-center ml-0.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Switch
                    size="xs"
                    checked={!skill.disabled}
                    disabled={busy}
                    onChange={(e) => onToggleSkill(skill.name, e.currentTarget.checked)}
                    aria-label={`${skill.disabled ? 'Enable' : 'Disable'} ${skill.name}`}
                  />
                </div>
              </Tooltip>
            )}
          </div>
        </div>

        {skill.description ? (
          <p className="m-0 text-[11.5px] leading-[1.4] text-ink-3 line-clamp-2">
            {skill.description}
          </p>
        ) : (
          <p className="m-0 text-[11px] italic text-ink-4">No description</p>
        )}
      </div>
    );
  };

  const renderGroup = (
    key: GroupKey,
    label: string,
    icon: React.ReactNode,
    items: SkillItem[]
  ) => {
    if (items.length === 0) return null;
    const collapsed = !!collapsedGroups[key];
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => toggleGroup(key)}
          aria-expanded={!collapsed}
          className="flex items-center justify-between w-full px-1 py-0.5 rounded-md hover:bg-s3h transition-colors cursor-pointer text-left"
        >
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">
            {collapsed ? (
              <ChevronRight className="w-3 h-3 text-ink-4 shrink-0" />
            ) : (
              <ChevronDown className="w-3 h-3 text-ink-4 shrink-0" />
            )}
            {icon}
            {label}
          </span>
          <span className="bubble is-muted">{items.length}</span>
        </button>
        {!collapsed && items.map(renderItem)}
      </div>
    );
  };

  return (
    <div
      style={fullWidth ? undefined : { width }}
      className={`${fullWidth ? 'flex-1' : 'shrink-0'} flex flex-col min-h-0 bg-surface/50`}
    >
      <div className="p-2.5 border-b border-line flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <SearchInput
            value={filter}
            onChange={onFilterChange}
            placeholder="Search skills…"
            containerClassName="flex-1 min-w-0"
          />
          <Tooltip label="Refresh skills" withArrow>
            <button type="button" className="icon-btn shrink-0" onClick={onRefresh} aria-label="Refresh skills">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Button
            size="xs"
            variant="primary"
            onClick={onCreate}
            leftSection={<Plus className="w-3 h-3" />}
            className="shrink-0"
          >
            New
          </Button>
          {onCollapse && (
            <Tooltip label="Collapse skills list" withArrow>
              <button
                type="button"
                className="icon-btn shrink-0"
                onClick={onCollapse}
                aria-label="Collapse skills list"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        <SegmentedControl<ScopeFilter>
          size="xs"
          fullWidth
          value={scopeFilter}
          onChange={setScopeFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'project', label: 'Project', count: counts.project },
            { value: 'global', label: 'Global', count: counts.global }
          ]}
        />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2.5 flex flex-col gap-3">
          {creating && (
            <div className="rounded-xl p-2.5 border border-acc-bd bg-acc-bg flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-acc-fg shrink-0" />
              <span className="font-mono text-[12px] font-semibold text-acc-fg truncate">
                New skill…
              </span>
            </div>
          )}

          {renderGroup('project', 'Project', <Folder className="w-3 h-3" />, groups.project)}
          {renderGroup('global', 'Global', <Globe className="w-3 h-3" />, groups.global)}

          {filtered.length === 0 && !creating && (
            <div className="py-10 px-3 text-center flex flex-col items-center gap-2">
              <WandSparkles className="w-6 h-6 text-ink-4" />
              <span className="text-[12px] text-ink-3">
                {filter.trim() ? 'No skills match your search.' : 'No skills in this scope yet.'}
              </span>
              {!filter.trim() && (
                <Button size="xs" variant="secondary" onClick={onCreate} leftSection={<Plus className="w-3 h-3" />}>
                  Create a skill
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
