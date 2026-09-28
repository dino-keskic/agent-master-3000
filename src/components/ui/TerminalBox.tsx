import React, { useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export interface TerminalBoxProps {
  command?: string;
  output?: string;
  meta?: string;
  failed?: boolean;
  onRerun?: () => void;
  className?: string;
}

export const TerminalBox: React.FC<TerminalBoxProps> = ({
  command,
  output,
  meta,
  failed = false,
  onRerun,
  className = ''
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const textToCopy = command ? (output ? `${command}\n\n${output}` : command) : output || '';
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`rounded-md border ${failed ? 'border-err-bd' : 'border-line'} bg-code overflow-hidden ${className}`}>
      {/* Traffic light header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-hairline bg-surface/50">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-err opacity-60" />
          <span className="w-2 h-2 rounded-full bg-wait opacity-60" />
          <span className="w-2 h-2 rounded-full bg-ok opacity-60" />
        </div>
        {meta && (
          <span className="font-mono text-[10px] text-ink-4 truncate">
            {meta}
          </span>
        )}
      </div>

      {/* Command prompt */}
      {command && (
        <div className="px-2.5 pt-2 pb-1 font-mono text-[11.5px] leading-relaxed text-ink flex items-start gap-1.5 overflow-x-auto">
          <span className={failed ? 'text-err-fg select-none' : 'text-ok select-none'}>❯</span>
          <span className="text-ink-2 break-all">{command}</span>
        </div>
      )}

      {/* Output block */}
      {output && (
        <pre className="m-0 px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-ink-3 max-h-[240px] overflow-auto whitespace-pre-wrap select-text">
          {output}
        </pre>
      )}

      {/* Action footer */}
      {(command || onRerun) && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-hairline bg-surface/30">
          <Button
            size="xs"
            variant="secondary"
            onClick={handleCopy}
            leftSection={copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
          >
            {copied ? 'Copied' : 'Copy command'}
          </Button>
          {onRerun && (
            <Button
              size="xs"
              variant="secondary"
              onClick={onRerun}
              leftSection={<RotateCcw className="w-3 h-3" />}
            >
              Re-run
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
