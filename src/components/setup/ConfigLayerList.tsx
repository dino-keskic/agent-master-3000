import React from 'react';
import type { ConfigLayer } from '../../../shared/setup/configLayers';

/**
 * Every place OpenCode reads its config from, in the order it merges them —
 * so it is plain that the global folder is always loaded, that
 * `OPENCODE_CONFIG_DIR` adds to it rather than replacing it, and that a
 * project's own `opencode.json` only counts for tasks in that project.
 */

export const ConfigLayerList: React.FC<{ layers: ConfigLayer[] }> = ({ layers }) => (
  <ol className="m-0 p-0 list-none flex flex-col rounded-lg border border-line bg-surface overflow-hidden">
    {layers.map((layer, index) => (
      <li key={`${layer.kind}:${layer.path}`} className="flex items-start gap-2.5 px-3 py-2.5 border-b border-line last:border-b-0">
        <span className="mt-0.5 w-4 shrink-0 text-log-sm text-ink-4 tabular-nums">{index + 1}</span>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">{layer.title}</span>
          {layer.path && <span className="text-log-sm font-mono text-ink-2 break-all">{layer.path}</span>}
          {layer.files.map((file) => (
            <span key={file} className="text-log-sm font-mono text-ink-3 break-all">
              {fileWithin(file, layer.path)}
            </span>
          ))}
          <span className="text-log-sm text-ink-3">{layer.note}</span>
        </div>
      </li>
    ))}
  </ol>
);

/** A file as it reads under its layer's folder: `opencode.json`, `.opencode/opencode.json`, or in full when it is elsewhere. */
function fileWithin(file: string, dir: string): string {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return dir && file.startsWith(prefix) ? `└ ${file.slice(prefix.length)}` : `└ ${file}`;
}
