import React, { useState } from 'react';
import { Modal, ScrollArea } from '@mantine/core';
import { AlertTriangle, Bell, FolderOpen, Layers, Settings, Terminal } from 'lucide-react';
import { Banner, SegmentedControl, Surface } from '../ui';
import { ConfigLayerList } from './ConfigLayerList';
import { LocationList } from './LocationList';
import { OpenCodeEnvEditor } from './OpenCodeEnvEditor';
import { RestartNotice } from './RestartNotice';
import { Setup } from './useSetup';

/**
 * The board's settings: when it may interrupt you, where its data lives, where
 * OpenCode and its files are, and anything else OpenCode needs in its
 * environment.
 */

type SettingsTab = 'locations' | 'alerts' | 'opencode';

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
  setup: Setup;
  /** The desktop-alert section, which is wired to the inbox rather than the setup. */
  alerts?: React.ReactNode;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ opened, onClose, setup, alerts }) => {
  const { report, error } = setup;
  const [tab, setTab] = useState<SettingsTab>('locations');
  const activeTab: SettingsTab = tab === 'alerts' && !alerts ? 'locations' : tab;
  const issueCount = report?.locations.filter((l) => l.severity !== 'ok').length ?? 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-accent" />
          <span className="text-[14px] font-semibold text-ink">Settings</span>
        </div>
      }
      size="xl"
      styles={{
        content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
        header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
        body: { backgroundColor: 'transparent', padding: 0 }
      }}
    >
      <div className="flex flex-col h-[min(640px,74vh)] min-h-0">
        <div className="px-5 py-2.5 border-b border-line bg-surface/60 shrink-0 flex items-center justify-between gap-3">
          <SegmentedControl<SettingsTab>
            size="sm"
            value={activeTab}
            onChange={setTab}
            options={[
              {
                value: 'locations',
                label: 'Locations',
                icon: <FolderOpen className="w-3.5 h-3.5" />,
                ...(issueCount > 0 ? { count: issueCount } : {})
              },
              ...(alerts
                ? [{ value: 'alerts' as const, label: 'Alerts', icon: <Bell className="w-3.5 h-3.5" /> }]
                : []),
              {
                value: 'opencode',
                label: 'OpenCode Config',
                icon: <Layers className="w-3.5 h-3.5" />
              }
            ]}
          />
          {report && (
            <span className="hidden sm:inline font-mono text-[11px] text-ink-4 truncate max-w-[260px]" title={report.configFile}>
              {report.configFile}
            </span>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0" type="auto">
          <div className="flex flex-col gap-4 p-5">
            {error && (
              <Banner tone="err" icon={<AlertTriangle className="w-4 h-4" />}>
                Could not read the setup: {error}
              </Banner>
            )}
            {report && <RestartNotice setup={setup} />}

            {activeTab === 'alerts' && alerts && (
              <Surface level="s2" border="default" radius="lg" className="p-4 flex flex-col gap-3">
                <SectionTitle icon={<Bell className="w-3.5 h-3.5" />}>Desktop alerts</SectionTitle>
                {alerts}
              </Surface>
            )}

            {activeTab === 'locations' && (
              <>
                {!report && !error && <p className="m-0 text-[12.5px] text-ink-4">Looking…</p>}
                {report && (
                  <Surface level="s2" border="default" radius="lg" className="p-4 flex flex-col gap-3">
                    <SectionTitle icon={<FolderOpen className="w-3.5 h-3.5" />}>Locations</SectionTitle>
                    <LocationList report={report} save={setup.save} />
                  </Surface>
                )}
              </>
            )}

            {activeTab === 'opencode' && (
              <>
                {!report && !error && <p className="m-0 text-[12.5px] text-ink-4">Looking…</p>}
                {report && (
                  <>
                    <Surface level="s2" border="default" radius="lg" className="p-4 flex flex-col gap-3">
                      <SectionTitle icon={<Layers className="w-3.5 h-3.5" />}>
                        OpenCode config, in the order it is merged
                      </SectionTitle>
                      <p className="m-0 text-[12px] text-ink-3 leading-relaxed">
                        Later layers win. The board restarts OpenCode on its own when one of these files changes and
                        nothing is running.
                      </p>
                      <ConfigLayerList layers={report.configLayers} />
                    </Surface>

                    <Surface level="s2" border="default" radius="lg" className="p-4 flex flex-col gap-3">
                      <SectionTitle icon={<Terminal className="w-3.5 h-3.5" />}>OpenCode environment</SectionTitle>
                      <p className="m-0 text-[12px] text-ink-3 leading-relaxed">
                        Added to every OpenCode the board starts, one <code className="font-mono text-ink-2">NAME=value</code> per line — for example{' '}
                        <code className="font-mono text-ink-2">XDG_DATA_HOME</code> when OpenCode keeps its sign-ins somewhere other than the usual place.
                      </p>
                      <OpenCodeEnvEditor env={report.opencodeEnv} save={setup.save} />
                    </Surface>

                    <p className="m-0 text-[11.5px] text-ink-4 px-1">
                      Saved in <span className="font-mono break-all text-ink-3">{report.configFile}</span>. An environment variable
                      always wins over what is set here.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </Modal>
  );
};

const SectionTitle: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="m-0 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-3">
    {icon}
    {children}
  </h3>
);
