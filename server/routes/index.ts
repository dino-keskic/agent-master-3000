import { Express } from 'express';
import { registerAttachmentRoutes } from './attachments.js';
import { registerBoardRoutes } from './board.js';
import { registerCommentRoutes } from './comments.js';
import { RouteContext } from './context.js';
import { registerLinkRoutes } from './links.js';
import { registerMentionRoutes } from './mentions.js';
import { registerProjectMoveRoutes } from './projectMove.js';
import { registerProjectRoutes } from './projects.js';
import { registerRespondRoutes } from './respond.js';
import { registerSessionImportRoutes } from './sessionImport.js';
import { registerSessionRoutes } from './sessions.js';
import { registerSetupRoutes } from './setup.js';
import { registerSpendRoutes } from './spend.js';
import { registerSpeechRoutes } from './speech.js';
import { registerTaskMoveRoutes } from './taskMove.js';
import { registerTaskRoutes } from './tasks.js';
import { registerTaskRunRoutes } from './taskRuns.js';
import { registerToolRoutes } from './tools.js';
import { registerWorkspaceRoutes } from './workspace.js';

export type { RouteContext } from './context.js';

/**
 * Every HTTP route the board serves.
 *
 * Groups are independent: no path is ambiguous between two of them, so this
 * order is for reading, not for matching.
 */
export function registerRoutes(app: Express, ctx: RouteContext): void {
  registerBoardRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerWorkspaceRoutes(app);
  registerSetupRoutes(app, ctx);
  registerSessionImportRoutes(app, ctx);
  registerTaskRoutes(app, ctx);
  registerTaskMoveRoutes(app, ctx);
  registerProjectMoveRoutes(app, ctx);
  registerTaskRunRoutes(app, ctx);
  registerRespondRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerCommentRoutes(app, ctx);
  registerLinkRoutes(app, ctx);
  registerMentionRoutes(app);
  registerToolRoutes(app, ctx);
  registerSpendRoutes(app);
  registerSpeechRoutes(app);
  registerAttachmentRoutes(app);
}
