import React, { useMemo, useRef, useState } from 'react';
import { Group, Loader, Tooltip } from '@mantine/core';
import { PanelLeftOpen } from 'lucide-react';
import { STUDIO_LIST_BOUNDS, resizedWidth } from '../../../shared/board/panelResize';
import { OpenCodeModel } from '../../../shared/sessions/types';
import { ToolRestartBanner } from '../tools/ToolRestartBanner';
import { ResizeHandle } from '../ui/ResizeHandle';
import { useIsNarrowPane } from '../ui/useIsNarrowPane';
import { usePanelWidth } from '../ui/usePanelWidth';
import { AgentEditor } from './AgentEditor';
import { AgentsList } from './AgentsList';
import { useTaskAgents } from './useTaskAgents';

/**
 * Built-in custom agent editor in the task view: browse project/global/built-in
 * agents, create and edit them on the fly, and toggle tools per agent.
 */

interface AgentsPanelProps {
  taskId?: string;
  sessionId?: string;
  cwd?: string;
  activeAgent?: string;
  models: OpenCodeModel[];
  onUseAgent?: (agentId: string) => void;
}

export const AgentsPanel: React.FC<AgentsPanelProps> = ({
  taskId,
  sessionId,
  cwd,
  activeAgent,
  models,
  onUseAgent
}) => {
  const {
    inventory,
    toolInventory,
    loading,
    toolsLoading,
    saving,
    restarting,
    needsForce,
    selectedKey,
    creating,
    createTemplate,
    setSelectedKey,
    startCreate,
    reload,
    saveAgent,
    toggleTool,
    deleteAgent,
    restart
  } = useTaskAgents(taskId, sessionId, activeAgent, cwd);

  const [filter, setFilter] = useState('');
  const [narrowEditorOpen, setNarrowEditorOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [containerRef, narrow] = useIsNarrowPane(680);
  const bodyRef = useRef<HTMLDivElement>(null);

  const listWidth = usePanelWidth('agentMasterAgentsListWidth', STUDIO_LIST_BOUNDS);
  const listDragStart = useRef(listWidth.width);

  const selectedAgent = useMemo(
    () => inventory?.agents.find((a) => a.key === selectedKey) ?? null,
    [inventory?.agents, selectedKey]
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
              <Tooltip label="Show agents list" position="right" withArrow>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setListCollapsed(false)}
                  aria-label="Show agents list"
                >
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
          )}

          {showList && (
            <AgentsList
              agents={inventory?.agents || []}
              selectedKey={selectedKey}
              creating={creating}
              activeAgent={activeAgent}
              filter={filter}
              onFilterChange={setFilter}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onRefresh={() => reload(true)}
              fullWidth={narrow}
              width={listWidth.width}
              onCollapse={narrow ? undefined : () => setListCollapsed(true)}
            />
          )}

          {!narrow && !listCollapsed && (
            <ResizeHandle
              label="Resize agents list"
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
            <AgentEditor
              agent={selectedAgent}
              creating={creating}
              template={createTemplate}
              models={models}
              activeAgent={activeAgent}
              toolInventory={toolInventory}
              agentToolPolicy={selectedAgent ? inventory?.agentToolPolicy[selectedAgent.id] : undefined}
              toolsLoading={toolsLoading}
              busy={saving || restarting}
              narrow={narrow}
              onBack={() => setNarrowEditorOpen(false)}
              onSave={saveAgent}
              onImmediateToggleTool={toggleTool}
              onDelete={async (filePath) => {
                await deleteAgent(filePath);
                if (narrow) setNarrowEditorOpen(false);
              }}
              onDuplicate={(agent) => {
                startCreate(agent);
                if (narrow) setNarrowEditorOpen(true);
              }}
              onUseInSession={onUseAgent}
            />
          )}
        </div>
      )}
    </div>
  );
};
