/**
 * What the agent sees in its tool list.
 *
 * Descriptions are the whole interface: the agent decides whether to call
 * these from the text alone, so they say when to use the tool, not what it
 * does internally. `server/mcp/boardMcp.ts` serves them.
 */

import { isManagerTask } from '../../shared/manager/identity.js';

export const BOARD_MCP_NAME = 'agent-master-3000';

const CHANGELOG_TOOLS = [
  {
    name: 'list_changelog_comments',
    description:
      "List every local changelog comment on this task's changes, with its id, location and thread. "
      + 'These are board review notes, not GitHub comments. One call returns all of them — do not call this per comment.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'resolved', 'all'],
          description: 'Which comments to return. Defaults to open.'
        }
      }
    }
  },
  {
    name: 'respond_to_changelog_comments',
    description:
      'Reply to and/or resolve changelog comments, so the user sees your response on the Changes tab. '
      + 'Takes a list: pass every comment you handled this turn in ONE call — one entry per comment, '
      + 'each with a reply, a status, or both. Do not call this once per comment.',
    inputSchema: {
      type: 'object',
      properties: {
        responses: {
          type: 'array',
          minItems: 1,
          description: 'One entry per comment you are responding to.',
          items: {
            type: 'object',
            properties: {
              commentId: {
                type: 'string',
                description: 'The comment id from list_changelog_comments or the attached prompt.'
              },
              reply: { type: 'string', description: 'What to tell the user about this comment.' },
              status: {
                type: 'string',
                enum: ['resolved', 'open'],
                description:
                  "'resolved' closes the thread once the change is done; 'open' reopens one that was resolved too early. "
                  + 'Omit to leave the thread as it is.'
              }
            },
            required: ['commentId']
          }
        }
      },
      required: ['responses']
    }
  }
] as const;

const LINK_TOOLS = [
  {
    name: 'list_task_links',
    description:
      'List the links on this task — the Jira ticket it implements, the PR it produced, design docs, '
      + 'CI runs. Read this before asking the user for a ticket or PR: if the task is about one, it is here.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'save_task_links',
    description:
      'Put a link on this task so it shows up on the card — the PR you opened, the ticket you found, '
      + 'the doc the work follows. Takes a list: pass every link in ONE call rather than one call each. '
      + 'Links are identified by URL, so saving one that is already there edits it instead of duplicating it. '
      + 'Only save pages the task is *about*; a URL you merely read while working does not belong here.',
    inputSchema: {
      type: 'object',
      properties: {
        links: {
          type: 'array',
          minItems: 1,
          description: 'One entry per link.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Absolute http(s) URL.' },
              title: {
                type: 'string',
                description: 'What it is, in a few words. Defaults to the ticket/PR reference.'
              },
              note: { type: 'string', description: 'Optional: why this link is on the task.' }
            },
            required: ['url']
          }
        }
      },
      required: ['links']
    }
  },
  {
    name: 'remove_task_link',
    description: 'Take a link off this task. Use the id from list_task_links.',
    inputSchema: {
      type: 'object',
      properties: { linkId: { type: 'string', description: 'The link id from list_task_links.' } },
      required: ['linkId']
    }
  }
] as const;

const WORKSPACE_TOOLS = [
  {
    name: 'list_workspaces',
    description:
      'Where this task can run: every project folder the board knows, the git worktrees of each, '
      + "and which folder each of this task's sessions is working in now. "
      + 'Read this before move_session — it is where the project ids and checkout paths come from.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'move_session',
    description:
      'Move a session to another project or git worktree, so its next turn runs there. '
      + 'Use it when the work belongs somewhere else — a sibling repo, or its own branch checkout '
      + 'instead of the shared one. Defaults to the session you are talking through, which keeps '
      + 'running in the folder it started in: on its next turn it continues in a new session filed '
      + 'under the new folder, carrying the whole conversation over. '
      + 'Pass no project and no folder to send the session back to wherever its task lives.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'A project id from list_workspaces. Omit to keep whichever project the folder belongs to.'
        },
        cwd: {
          type: 'string',
          description:
            'An existing checkout path from list_workspaces. Omit to land in the project root, '
            + 'or in the checkout of it the session is already in.'
        },
        newWorktree: {
          type: 'string',
          description:
            'Cut a fresh git worktree with this name and move into it, instead of using `cwd`. '
            + 'A branch is made for it. Use when the work needs its own checkout.'
        },
        sessionId: {
          type: 'string',
          description: 'A session id from list_workspaces. Omit to move the session you are running in.'
        }
      }
    }
  }
] as const;

/** Only the manager's sessions get these: they reach every task, not just their own. */
export const MANAGER_TOOLS = [
  {
    name: 'board_overview',
    description:
      'Where every task on the board stands, most urgent first: what is blocked on the user (with the question '
      + 'and its options), what failed, what is running, what is idle — each with its last request and reply. '
      + 'Call this first whenever you are asked for a status, and again before saying anything changed.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'task_detail',
    description:
      "One task's original request and its recent conversation — the prompts, replies and errors, without the "
      + 'tool calls. Use it when the overview line is not enough to tell what a task needs.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task id from board_overview, e.g. TASK-12.' },
        turns: { type: 'number', description: 'How many recent messages to return. Defaults to 8.' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'prompt_task',
    description:
      "Send a message to a task's agent, as if the user typed it in that task: it continues the conversation, "
      + 'or is queued if a turn is running. Only after the user asked for it or agreed to your suggestion. '
      + 'It does not answer a blocked permission or question — those still wait for the user.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task id from board_overview.' },
        prompt: { type: 'string', description: 'The message, written to the agent doing the task.' }
      },
      required: ['taskId', 'prompt']
    }
  }
] as const;

/** Everything the board attaches to a task's session, in the order it is listed. */
export const BOARD_MCP_TOOLS = [...CHANGELOG_TOOLS, ...LINK_TOOLS, ...WORKSPACE_TOOLS];

/**
 * The tool list one session is offered. The manager has no changes, links or
 * workspace of its own worth managing, so it gets the board tools instead.
 */
export function toolsFor(taskId: string): readonly { name: string }[] {
  return isManagerTask(taskId) ? MANAGER_TOOLS : BOARD_MCP_TOOLS;
}

/** Older tool names, still accepted so a remembered call is not a dead end. */
export const LEGACY_TOOL_STATUS: Record<string, 'resolved' | 'open' | undefined> = {
  reply_to_changelog_comment: undefined,
  resolve_changelog_comment: 'resolved',
  reopen_changelog_comment: 'open'
};
