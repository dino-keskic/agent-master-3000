import React, { useMemo, useRef, useState } from 'react';
import { Group, Loader, Tooltip } from '@mantine/core';
import { PanelLeftOpen } from 'lucide-react';
import { STUDIO_LIST_BOUNDS, resizedWidth } from '../../../shared/board/panelResize';
import { ToolRestartBanner } from '../tools/ToolRestartBanner';
import { ResizeHandle } from '../ui/ResizeHandle';
import { useIsNarrowPane } from '../ui/useIsNarrowPane';
import { usePanelWidth } from '../ui/usePanelWidth';
import { SkillEditor } from './SkillEditor';
import { SkillsList } from './SkillsList';
import { useTaskSkills } from './useTaskSkills';

/**
 * Built-in skills browser and editor in the task view: list project/global
 * skills, create and edit `SKILL.md` + bundled files on the fly.
 */

interface SkillsPanelProps {
  taskId?: string;
  sessionId?: string;
  cwd?: string;
  onInsertSkill?: (name: string) => void;
}

export const SkillsPanel: React.FC<SkillsPanelProps> = ({ taskId, sessionId, cwd, onInsertSkill }) => {
  const {
    inventory,
    loading,
    saving,
    restarting,
    needsForce,
    selectedKey,
    creating,
    setSelectedKey,
    startCreate,
    reload,
    saveSkill,
    deleteSkill,
    toggleSkill,
    restart,
    readAuxFile,
    saveAuxFile,
    deleteAuxFile
  } = useTaskSkills(taskId, sessionId, cwd);

  const [filter, setFilter] = useState('');
  const [narrowEditorOpen, setNarrowEditorOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [containerRef, narrow] = useIsNarrowPane(680);
  const bodyRef = useRef<HTMLDivElement>(null);

  const listWidth = usePanelWidth('agentMasterSkillsListWidth', STUDIO_LIST_BOUNDS);
  const listDragStart = useRef(listWidth.width);

  const selectedSkill = useMemo(
    () => inventory?.skills.find((s) => s.key === selectedKey) ?? null,
    [inventory?.skills, selectedKey]
  );

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    if (narrow) setNarrowEditorOpen(true);
  };

  const handleCreate = () => {
    startCreate();
    if (narrow) setNarrowEditorOpen(true);
  };

  const showList = narrow ? !narrowEditorOpen : !listCollapsed;

  return (
    <div ref={containerRef} className="flex flex-col min-h-0 flex-1">
      {inventory?.pendingRestart && (
        <ToolRestartBanner needsForce={needsForce} restarting={restarting} onRestart={restart} />
      )}

      {loading && !inventory ? (
        <Group justify="center" py="xl">
          <Loader size="sm" color="gray" />
        </Group>
      ) : (
        <div ref={bodyRef} className="flex flex-1 min-h-0 min-w-0">
          {!narrow && listCollapsed && (
            <div className="w-9 shrink-0 border-r border-line bg-surface/60 flex flex-col items-center pt-2.5">
              <Tooltip label="Show skills list" position="right" withArrow>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setListCollapsed(false)}
                  aria-label="Show skills list"
                >
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
          )}

          {showList && (
            <SkillsList
              skills={inventory?.skills || []}
              selectedKey={selectedKey}
              creating={creating}
              filter={filter}
              busy={saving}
              onFilterChange={setFilter}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onRefresh={reload}
              onToggleSkill={(name, enabled) => void toggleSkill(name, enabled)}
              fullWidth={narrow}
              width={listWidth.width}
              onCollapse={narrow ? undefined : () => setListCollapsed(true)}
            />
          )}

          {!narrow && !listCollapsed && (
            <ResizeHandle
              label="Resize skills list"
              onDragStart={() => {
                listDragStart.current = listWidth.width;
              }}
              onDragMove={(deltaX) => {
                const containerWidth = bodyRef.current?.clientWidth;
                listWidth.setWidth(
                  resizedWidth(listDragStart.current, deltaX, 'right', STUDIO_LIST_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onNudge={(deltaX) => {
                const containerWidth = bodyRef.current?.clientWidth;
                listWidth.setWidth(
                  resizedWidth(listWidth.width, deltaX, 'right', STUDIO_LIST_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onReset={listWidth.reset}
            />
          )}

          {(!narrow || narrowEditorOpen) && (
            <SkillEditor
              skill={selectedSkill}
              creating={creating}
              busy={saving}
              narrow={narrow}
              onBack={() => setNarrowEditorOpen(false)}
              onSave={saveSkill}
              onDelete={async (dirPath) => {
                await deleteSkill(dirPath);
                if (narrow) setNarrowEditorOpen(false);
              }}
              onToggleSkill={(name, enabled) => void toggleSkill(name, enabled)}
              onReadAuxFile={readAuxFile}
              onSaveAuxFile={saveAuxFile}
              onDeleteAuxFile={deleteAuxFile}
              onInsertSkill={onInsertSkill}
            />
          )}
        </div>
      )}
    </div>
  );
};
