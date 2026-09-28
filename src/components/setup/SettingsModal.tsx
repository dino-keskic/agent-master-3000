import React from 'react';
import { Group, Modal, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { LocationList } from './LocationList';
import { OpenCodeEnvEditor } from './OpenCodeEnvEditor';
import { RestartNotice } from './RestartNotice';
import { Setup } from './useSetup';

/**
 * The board's settings: where its data lives, where OpenCode and its files
 * are, and anything else OpenCode needs in its environment. All of it is
 * saved to the setup file named at the bottom, which is plain JSON.
 */

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
  setup: Setup;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ opened, onClose, setup }) => {
  const { report, error } = setup;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Settings className="w-4 h-4 text-ink-2" />
          <Text fw={600}>Settings</Text>
        </Group>
      }
      size="xl"
      styles={{
        content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
        header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
        body: { backgroundColor: 'rgb(var(--c-canvas))', padding: 0 }
      }}
    >
      <div className="flex flex-col gap-5 p-5">
        {error && <p className="m-0 text-log-ui text-err-fg">Could not read the setup: {error}</p>}
        {!report && !error && <p className="m-0 text-log-ui text-ink-4">Looking…</p>}
        {report && (
          <>
            <RestartNotice setup={setup} />
            <section className="flex flex-col gap-2">
              <SectionTitle>Locations</SectionTitle>
              <LocationList report={report} save={setup.save} />
            </section>
            <section className="flex flex-col gap-2">
              <SectionTitle>OpenCode environment</SectionTitle>
              <p className="m-0 text-log-ui text-ink-3">
                Added to every OpenCode the board starts, one <code>NAME=value</code> per line — for example{' '}
                <code>XDG_DATA_HOME</code> when OpenCode keeps its sign-ins somewhere other than the usual place.
              </p>
              <OpenCodeEnvEditor env={report.opencodeEnv} save={setup.save} />
            </section>
            <p className="m-0 text-log-sm text-ink-4">
              Saved in <span className="font-mono break-all">{report.configFile}</span>. An environment variable
              always wins over what is set here.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="m-0 text-log-sm font-semibold uppercase tracking-wide text-ink-4">{children}</h3>
);
