import React, { useState } from 'react';
import { Paper, Stack, Text } from '@mantine/core';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { PermissionMode, PromptImage } from '../../../shared/types';
import { dragHasFiles } from '../../../shared/composer/promptImages';
import { ComposerMenuEntry } from '../../../shared/composer/menu';
import { SlashCommand } from '../../../shared/composer/slashCommands';
import { insertDictation } from '../../../shared/composer/dictation';
import { MicButton } from '../../speech/MicButton';
import { CommandMenu } from './CommandMenu';
import { MentionContextBar } from './MentionContextBar';
import { ComposerSubmitKind, TurnControls } from './TurnControls';
import { PromptImageStrip } from './PromptImageStrip';
import { PromptTextarea } from './PromptTextarea';
import { usePromptImages } from './usePromptImages';
import { useComposerMenu } from './useComposerMenu';
import { useMentionContext } from './useMentionContext';
import { usePromptField } from './usePromptField';

export type { ComposerSubmitKind };

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called with the prompt as the agent will receive it: what was typed, plus
   * the description and any other blocks fetched for the tickets linked in it,
   * and the images dropped into the box. The textarea itself only ever holds
   * the typed text and the links.
   */
  onSubmit: (prompt: string, images: PromptImage[]) => void | Promise<void>;
  placeholder: string;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  thinkingLevel: string;
  onThinkingLevelChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (value: PermissionMode) => void;
  agent: string;
  onAgentChange: (value: string) => void;
  submitting?: boolean;
  disabled?: boolean;
  submitKind?: ComposerSubmitKind;
  submitTooltip?: string;
  /** Homepage sits at the top of the board; the drawer sits at the bottom. */
  mentionPlacement?: 'above' | 'below';
  /** Board `/` commands such as address comments. */
  slashCommands?: SlashCommand[];
  /** The folder `@` files and `/` project commands are read from. */
  cwd?: string;
}

/**
 * The prompt box used on the board header and inside a task. Project and
 * worktree pickers stay on the header; this is the textarea, turn config, and
 * submit control — one component so the two places cannot drift.
 *
 * What it does itself is arrange the parts and decide what a submit means.
 * The box, the `/` and `@` menu, and the context riding along with a linked
 * ticket each have their own file under `composer/`.
 */
export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  textareaRef,
  models,
  agents,
  thinkingLevel,
  onThinkingLevelChange,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  agent,
  onAgentChange,
  submitting = false,
  disabled = false,
  submitKind = 'send',
  submitTooltip,
  mentionPlacement = 'above',
  slashCommands,
  cwd
}) => {
  const field = usePromptField(value, onChange, textareaRef);
  const menu = useComposerMenu(value, field.cursor, cwd, slashCommands);
  const mentions = useMentionContext(value, field);
  const images = usePromptImages();
  const [dragging, setDragging] = useState(false);
  // An image on its own is a perfectly good turn — "what is wrong with this?"
  // is the drop, not the sentence.
  const empty = !value.trim() && images.items.length === 0;
  const idle = empty || submitting || disabled || images.uploading;

  const pick = (entry: ComposerMenuEntry) => {
    const next = menu.apply(entry);
    if (!next) return;
    field.place(next);
    menu.reset();
    if (entry.kind === 'mention') mentions.pick(entry.mention);
  };

  const send = () => {
    if (idle) return;
    const attached = images.items;
    void mentions
      .buildPrompt(field.latest())
      .then((prompt) => onSubmit(prompt, attached))
      // Cleared only once the send went through, so a failed turn keeps the
      // pictures it was written with.
      .then(() => images.clear());
  };

  /**
   * A dictated clip lands where the caret was when the mic was pressed, read
   * off the node now — the user may have typed on while it transcribed.
   */
  const dictate = (clip: string) => {
    const [start, end] = field.selection();
    field.place(insertDictation(field.latest(), start, end, clip));
  };

  /** Files dropped anywhere on the composer, not only on the textarea. */
  const drop = (e: React.DragEvent) => {
    setDragging(false);
    if (!dragHasFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    void images.add(Array.from(e.dataTransfer.files));
  };

  /** Enter and the button do the same two things, in the same order. */
  const submit = () => {
    if (menu.open && menu.entries.length > 0) {
      pick(menu.entries[menu.active] || menu.entries[0]!);
      return;
    }
    send();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Paper
        px={14}
        pt={12}
        pb={8}
        radius={14}
        onDragEnter={(e) => {
          if (dragHasFiles(e.dataTransfer.types)) setDragging(true);
        }}
        onDragOver={(e) => {
          if (!dragHasFiles(e.dataTransfer.types)) return;
          // Without this the browser navigates to the dropped file instead.
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={drop}
        // The box lights up while it has the cursor, the same way a dragged
        // file does: the ring says "this is where typing goes".
        className={`bg-surface-2 border relative overflow-visible transition-[border-color,box-shadow] shadow-sm focus-within:border-acc-bd focus-within:shadow-[0_0_0_3px_var(--acc-bg)] ${
          dragging ? 'border-acc-bd shadow-[0_0_0_3px_var(--acc-bg)]' : 'border-line'
        }`}
      >
        <Stack gap={6}>
          {menu.open && (
            <CommandMenu
              entries={menu.entries}
              active={menu.active}
              loading={menu.loading}
              error={menu.error}
              emptyHint={menu.emptyHint}
              placement={mentionPlacement}
              onHover={menu.setActive}
              onPick={pick}
            />
          )}

          <PromptTextarea
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            attachRef={field.attach}
            field={field}
            menu={menu}
            onPick={pick}
            onSend={send}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length > 0) {
                e.preventDefault();
                void images.add(pasted);
                return;
              }
              if (mentions.paste(e, value)) menu.reset();
            }}
          />

          <PromptImageStrip
            images={images.items}
            uploading={images.uploading}
            error={images.error}
            onRemove={images.remove}
            disabled={disabled}
          />

          <MentionContextBar
            items={mentions.linked}
            attached={mentions.attached}
            pending={mentions.pending}
            onToggle={mentions.toggle}
          />
          {mentions.error && (
            <Text size="10px" className="font-mono text-wait-fg px-0.5">
              {mentions.error}
            </Text>
          )}

          <TurnControls
            models={models}
            agents={agents}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            model={model}
            onModelChange={onModelChange}
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            agent={agent}
            onAgentChange={onAgentChange}
            submitKind={submitKind}
            submitTooltip={submitTooltip}
            submitting={submitting}
            idle={idle}
            dictation={<MicButton onText={dictate} disabled={disabled} />}
          />
        </Stack>
      </Paper>
    </form>
  );
};
