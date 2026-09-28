import React, { useState } from 'react';
import { formatEnvLines, parseEnvLines } from '../../../shared/setup/report';
import { Button } from '../ui/Button';
import { Setup } from './useSetup';

/**
 * Extra environment for every OpenCode the board starts — for what has no
 * setting of its own, such as `XDG_DATA_HOME` when OpenCode's credentials live
 * somewhere unusual, or a proxy. `NAME=value`, one per line.
 */

interface OpenCodeEnvEditorProps {
  env: Record<string, string>;
  save: Setup['save'];
}

export const OpenCodeEnvEditor: React.FC<OpenCodeEnvEditorProps> = ({ env, save }) => {
  const saved = formatEnvLines(env);
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const parsed = parseEnvLines(text);
  const dirty = text.trim() !== saved.trim();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await save({ opencodeEnv: parsed.env });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={'XDG_DATA_HOME=/Volumes/Work/.local/share\nHTTPS_PROXY=http://proxy:8080'}
        aria-label="Extra OpenCode environment"
        className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-ink text-log-ui font-mono placeholder:text-ink-4 focus:outline-none focus:border-acc-bd resize-y"
      />
      {parsed.errors.map((message) => (
        <span key={message} className="text-log-sm text-err-fg">
          {message}
        </span>
      ))}
      {error && <span className="text-log-sm text-err-fg">{error}</span>}
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || parsed.errors.length > 0} loading={busy} onClick={() => void submit()}>
          Save environment
        </Button>
      </div>
    </div>
  );
};
