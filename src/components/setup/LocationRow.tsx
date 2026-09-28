import React, { useState } from 'react';
import { FolderOpen, Lock } from 'lucide-react';
import {
  DataMove,
  LOCATION_INFO,
  LocationCheck,
  LocationStatus,
  Severity,
  sourceLabel
} from '../../../shared/setup/report';
import { api } from '../../api';
import { Button } from '../ui/Button';

/**
 * One location on the setup screens: what it is, where it points, who decided
 * that, and whether something is there. "Change" opens a path field with the
 * native picker beside it; the path is checked before it can be saved, and a
 * data folder without a board asks whether this one comes along.
 */

const DOT: Record<Severity, string> = { ok: 'bg-run', warn: 'bg-wait', error: 'bg-err' };
const NOTE: Record<Severity, string> = { ok: 'text-ink-3', warn: 'text-wait-fg', error: 'text-err-fg' };

interface LocationRowProps {
  status: LocationStatus;
  /** OpenCode executables that were found, offered as one-click choices on the program's row. */
  candidates?: string[];
  onSave: (value: string | null, dataMove?: DataMove) => Promise<void>;
}

export const LocationRow: React.FC<LocationRowProps> = ({ status, candidates = [], onSave }) => {
  const info = LOCATION_INFO[status.key];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [check, setCheck] = useState<LocationCheck>();
  const [dataMove, setDataMove] = useState<DataMove>('move');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const locked = status.source === 'env';

  const begin = () => {
    setDraft(status.value);
    setCheck(undefined);
    setError(undefined);
    setEditing(true);
  };

  const runCheck = async (value: string): Promise<LocationCheck | undefined> => {
    if (!value.trim()) return undefined;
    try {
      const next = await api.checkLocation(status.key, value);
      setCheck(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    }
  };

  const commit = async (value: string | null) => {
    setBusy(true);
    setError(undefined);
    try {
      let target = value;
      if (value !== null) {
        const checked = await runCheck(value);
        if (!checked || checked.severity === 'error') return;
        target = checked.value;
      }
      await onSave(target, status.key === 'dataDir' ? dataMove : undefined);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    try {
      const picked = await api.pickPath(info.kind === 'dir' ? 'folder' : 'file', draft || status.value);
      if (picked.cancelled) return;
      setDraft(picked.path);
      void runCheck(picked.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Moving to a folder that has no board yet: bring this one, or start empty.
  const asksAboutMove = status.key === 'dataDir' && check && check.severity !== 'error' && !check.hasBoard && check.value !== status.value;

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 border-b border-line last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[status.severity]}`} aria-label={status.severity} />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{info.title}</span>
            <span className="chip" title={locked ? `Unset $${status.envVar} to change it here` : undefined}>
              {locked && <Lock className="w-3 h-3 inline mr-1" />}
              {sourceLabel(status)}
            </span>
          </div>
          <span className="text-log-sm font-mono text-ink-2 break-all">{status.value}</span>
          <span className={`text-log-sm ${NOTE[status.severity]}`}>{status.note}</span>
        </div>
        {!editing && !locked && (
          <div className="flex gap-1 shrink-0">
            {status.source === 'config' && (
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void commit(null)} title="Go back to the default">
                Default
              </Button>
            )}
            <Button size="xs" variant="secondary" onClick={begin}>
              Change
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <form
          className="flex flex-col gap-2 pl-[18px]"
          onSubmit={(event) => {
            event.preventDefault();
            void commit(draft);
          }}
        >
          <p className="m-0 text-log-sm text-ink-4">{info.hint}</p>
          {status.key === 'opencodeBin' && candidates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {candidates.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="chip cursor-pointer"
                  onClick={() => {
                    setDraft(candidate);
                    void runCheck(candidate);
                  }}
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setCheck(undefined);
              }}
              onBlur={() => void runCheck(draft)}
              aria-label={info.title}
              spellCheck={false}
              className="flex-1 min-w-0 h-8 px-3 rounded-lg border border-line bg-surface text-ink text-log-ui font-mono placeholder:text-ink-4 focus:outline-none focus:border-acc-bd"
            />
            <Button type="button" size="md" variant="secondary" onClick={() => void browse()} leftSection={<FolderOpen className="w-4 h-4" />}>
              Browse
            </Button>
          </div>
          {check && <span className={`text-log-sm ${NOTE[check.severity]}`}>{check.note}</span>}
          {asksAboutMove && (
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-1 text-log-ui text-ink-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={dataMove === 'move'} onChange={() => setDataMove('move')} />
                Copy this board there (the old copy stays where it is)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={dataMove === 'fresh'} onChange={() => setDataMove('fresh')} />
                Start an empty board there
              </label>
            </fieldset>
          )}
          {error && <span className="text-log-sm text-err-fg">{error}</span>}
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={!draft.trim() || check?.severity === 'error'}>
              Save
            </Button>
          </div>
        </form>
      )}
    </li>
  );
};
