/**
 * What the prompt box looks things up with while you type: mentions, files,
 * slash commands, dropped images and dictation.
 */

import { SpeechStatus } from '../../shared/composer/dictation';
import { SlashCommand } from '../../shared/composer/slashCommands';
import { FileItem, MentionExtra, MentionItem } from '../../shared/trackers/mentions';
import { PromptImage } from '../../shared/types';
import { post, request } from './http';

export const composerApi = {
  searchMentions: (query: string) =>
    request<{ items: MentionItem[]; error?: string }>(`/api/mentions?q=${encodeURIComponent(query)}`),

  /** The title behind a ticket or PR link that was pasted rather than picked. */
  resolveMention: (item: MentionItem) =>
    post<{ item?: MentionItem; error?: string }>('/api/mentions/resolve', item),

  /** One block of context for a ticket or PR: description, comments or checks. */
  mentionContext: (item: MentionItem, extra: MentionExtra) =>
    post<{ body: string; error?: string }>('/api/mentions/context', { ...item, extra }),

  searchFiles: (cwd: string, query: string) =>
    request<{ items: FileItem[]; error?: string }>(
      `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`
    ),

  agentCommands: (cwd: string) =>
    request<{ commands: SlashCommand[]; error?: string }>(
      `/api/agent-commands?cwd=${encodeURIComponent(cwd)}`
    ),

  /**
   * Store one dropped image and get back the reference a turn carries. The
   * bytes go up once, here; every later mention of the image is its id.
   */
  uploadImage: (input: { name: string; mimeType: string; data: string }) =>
    post<PromptImage>('/api/attachments', input),

  /** Whether the local speech model can run, and whether it is loaded. */
  speechStatus: () => request<SpeechStatus>('/api/speech'),

  /** Start loading the speech model while the user is still talking. */
  warmSpeech: () => post<SpeechStatus>('/api/speech/warm'),

  /** A 16 kHz mono WAV in, cleaned-up text out. */
  transcribe: (wav: Blob) =>
    request<{ text: string }>('/api/speech/transcribe', {
      method: 'POST',
      body: wav,
      headers: { 'Content-Type': 'audio/wav' }
    })
};
