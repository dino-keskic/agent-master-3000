import React, { useMemo, useState } from 'react';
import { Drawer } from '@mantine/core';
import { ArrowLeft, Bot, Folder, LucideIcon, WandSparkles, Wrench } from 'lucide-react';
import { OpenCodeModel } from '../../../shared/sessions/types';
import { ProjectFolder } from '../../../shared/types';
import { AgentsPanel } from '../agents/AgentsPanel';
import { SkillsPanel } from '../skills/SkillsPanel';
import { ToolsPanel } from '../tools/ToolsPanel';
import { InlineSelect } from '../ui';

/**
 * Dedicated full-screen studio pages for Tools, Agents, and Skills.
 *
 * Accessible from the command palette or the board menu without opening a
 * task first. A single top bar switches between the three pages and scopes
 * project-level config to whichever project folder is picked.
 */

export type StudioSection = 'tools' | 'agents' | 'skills';

interface StudioPageProps {
  section: StudioSection | null;
  onChangeSection: (section: StudioSection) => void;
  onClose: () => void;
  projects: ProjectFolder[];
  defaultProjectId?: string;
  models: OpenCodeModel[];
}

const STUDIO_STYLES = {
  content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
  body: { padding: 0, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
} as const;

const STUDIO_SECTIONS: { id: StudioSection; label: string; Icon: LucideIcon }[] = [
  { id: 'tools', label: 'Tools', Icon: Wrench },
  { id: 'agents', label: 'Agents', Icon: Bot },
  { id: 'skills', label: 'Skills', Icon: WandSparkles }
];

export const StudioPage: React.FC<StudioPageProps> = ({
  section,
  onChangeSection,
  onClose,
  projects,
  defaultProjectId,
  models
}) => {
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>(undefined);

  const selectedProject = useMemo(() => {
    if (chosenProjectId) {
      const chosen = projects.find((project) => project.id === chosenProjectId);
      if (chosen) return chosen;
    }
    if (defaultProjectId) {
      const fallback = projects.find((project) => project.id === defaultProjectId);
      if (fallback) return fallback;
    }
    return projects[0];
  }, [chosenProjectId, defaultProjectId, projects]);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name, keywords: project.path })),
    [projects]
  );

  const cwd = selectedProject?.path;

  return (
    <Drawer
      opened={section !== null}
      onClose={onClose}
      position="right"
      size="100%"
      withCloseButton={false}
      transitionProps={{ transition: 'fade', duration: 120 }}
      styles={STUDIO_STYLES}
    >
      <header className="bg-surface border-b border-line min-h-[44px] h-auto sm:h-[44px] px-2.5 sm:px-3.5 py-1.5 sm:py-0 pt-[max(6px,env(safe-area-inset-top))] sm:pt-0 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 h-7 px-2 -ml-1 rounded-lg bg-transparent border-0 text-[13px] font-semibold text-ink-2 hover:text-ink hover:bg-s3h cursor-pointer transition-colors shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Board</span>
          <span className="kbd hidden sm:inline-flex">esc</span>
        </button>

        <span className="h-4 w-px bg-line shrink-0" aria-hidden />

        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar" aria-label="Studio pages">
          {STUDIO_SECTIONS.map(({ id, label, Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onChangeSection(id)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12.5px] font-medium border cursor-pointer transition-colors shrink-0 ${
                  active
                    ? 'bg-acc-bg border-acc-bd text-acc-fg'
                    : 'bg-transparent border-transparent text-ink-3 hover:text-ink hover:bg-s3h'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {projects.length > 0 && (
          <div className="ml-auto flex items-center min-w-0">
            <InlineSelect
              value={selectedProject?.id}
              options={projectOptions}
              onChange={setChosenProjectId}
              label="Project"
              icon={<Folder className="w-3.5 h-3.5" />}
              title={selectedProject?.path}
              searchable={projects.length > 8}
            />
          </div>
        )}
      </header>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-canvas">
        {section === 'tools' && <ToolsPanel key={cwd || 'default'} cwd={cwd} />}
        {section === 'agents' && <AgentsPanel key={cwd || 'default'} cwd={cwd} models={models} />}
        {section === 'skills' && <SkillsPanel key={cwd || 'default'} cwd={cwd} />}
      </div>
    </Drawer>
  );
};
