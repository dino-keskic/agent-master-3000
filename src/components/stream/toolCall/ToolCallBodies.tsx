import { Group } from '@mantine/core';
import { ToolCallInfo } from '../../../../shared/types';
import { highlight } from '../../../../shared/transcript/highlight';
import { omitKeys, stripAnsi, toolOutputLanguage } from '../../../../shared/agent/toolCallView';
import { parseTodoRawInput } from '../../../../shared/agent/todoPlan';
import { PlanChecklist } from '../../plan/PlanChecklist';
import { HighlightedCode } from '../HighlightedCode';
import { CODE_PANE, ERROR_BADGE, SECTION_LABEL } from './styles';
import { FileText } from 'lucide-react';
import { TerminalBox } from '../../ui';

/**
 * What is under an expanded tool call. A shell call gets a terminal — prompt,
 * command, printed output — because that is the form its result was written in;
 * everything else gets its input and output as panes.
 */

function JsonPane({ value }: { value: unknown }) {
  return (
    <pre className={CODE_PANE}>
      <code>
        <HighlightedCode tokens={highlight(JSON.stringify(value, null, 2), 'json')} />
      </code>
    </pre>
  );
}

export function TerminalBody({ info, command }: { info: ToolCallInfo; command?: string }) {
  const extra = info.rawInput ? omitKeys(info.rawInput, ['command', 'cmd']) : null;
  const output = info.output ? stripAnsi(info.output) : '';
  const failed = info.status === 'failed';

  return (
    <div className="space-y-2">
      {(command || output || failed) && (
        <TerminalBox
          command={command}
          output={output}
          meta={failed ? 'failed' : undefined}
          failed={failed}
        />
      )}

      {extra && (
        <details>
          <summary className={`${SECTION_LABEL} cursor-pointer select-none py-0.5`}>Input</summary>
          <div className="mt-1">
            <JsonPane value={extra} />
          </div>
        </details>
      )}
    </div>
  );
}

export function ToolBody({ info }: { info: ToolCallInfo }) {
  const lang = toolOutputLanguage(info);
  const plan = info.rawInput ? parseTodoRawInput(info.rawInput) : undefined;

  return (
    <>
      {plan && plan.items.length > 0 ? (
        <div className="border border-run-bd/70 rounded-lg p-2.5 bg-surface-2 mb-2">
          <PlanChecklist plan={plan} />
          {info.rawInput && (
            <details className="mt-2 border-t border-hairline pt-1">
              <summary className={`${SECTION_LABEL} cursor-pointer select-none py-0.5`}>Raw input</summary>
              <div className="mt-1">
                <JsonPane value={info.rawInput} />
              </div>
            </details>
          )}
        </div>
      ) : (
        info.rawInput && Object.keys(info.rawInput).length > 0 && (
          <div>
            <div className={`${SECTION_LABEL} mb-1 mt-2`}>Input</div>
            <JsonPane value={info.rawInput} />
          </div>
        )
      )}

      {info.output && (
        <div>
          <Group justify="space-between" align="center" mb={4}>
            <div className={SECTION_LABEL}>Output</div>
            {info.status === 'failed' && <span className={ERROR_BADGE}>error</span>}
          </Group>
          <pre className={`${CODE_PANE} overflow-auto max-h-[280px] whitespace-pre-wrap`}>
            <code>
              <HighlightedCode tokens={highlight(info.output, lang)} />
            </code>
          </pre>
        </div>
      )}
    </>
  );
}

/** The files a call touched, listed only when the summary line cannot name them all. */
export function ToolFileList({ locations }: { locations: string[] }) {
  return (
    <div>
      <div className={`${SECTION_LABEL} mb-1`}>Files</div>
      <div className="space-y-0.5">
        {locations.map((path) => (
          <Group key={path} gap={6} wrap="nowrap">
            <FileText className="w-3 h-3 text-ink-4 shrink-0" />
            <span className="font-mono type-sm text-ink-3 truncate" title={path}>{path}</span>
          </Group>
        ))}
      </div>
    </div>
  );
}
