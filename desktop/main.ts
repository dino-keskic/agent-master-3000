import path from 'path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  session,
  shell
} from 'electron';
import { boardEnv } from '../shared/desktop/shellEnv.js';
import { DESKTOP_PORT, boardOrigin, boardWindowUrl, linkTarget } from '../shared/desktop/window.js';
import { BoardProcess, answers, logTail, startBoard } from './boardProcess.js';
import { readShellEnv } from './shellEnv.js';

/**
 * The desktop app's main process: Agent Master 3000 as a Mac app.
 *
 * It starts the board server (`desktop/boardProcess.ts`) with the user's shell
 * environment, then shows the board's own UI in a window. Closing the window
 * leaves the board running, as a Mac app does, so turns carry on; quitting
 * stops it. If a board already answers on the port — `agent-master-3000`
 * started in a terminal — the app shows that one instead of starting another
 * against the same state file.
 *
 * Decisions (the environment, where a link goes) are in `shared/desktop/`;
 * this file only wires them to Electron.
 */

const ORIGIN = boardOrigin(DESKTOP_PORT);
const LOG_FILE = path.join(app.getPath('logs'), 'board.log');

let board: BoardProcess | undefined;
let windowUrl = boardWindowUrl(ORIGIN, undefined);
let ready = false;

function openBoardWindow(url = windowUrl): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    title: 'Agent Master 3000',
    backgroundColor: '#0b0f19',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });

  // A task opened "in a new window" is another board window; the web goes to the browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    const where = linkTarget(target, ORIGIN);
    if (where === 'board') openBoardWindow(target);
    else if (where === 'browser') void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (linkTarget(target, ORIGIN) === 'board') return;
    event.preventDefault();
    if (linkTarget(target, ORIGIN) === 'browser') void shell.openExternal(target);
  });

  void win.loadURL(url);
  return win;
}

function showOrOpenWindow(): void {
  if (!ready) return;
  const [win] = BrowserWindow.getAllWindows();
  if (!win) {
    openBoardWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
}

/** Dictation needs the microphone and finished turns notify; nothing else is granted. */
function grantBoardPermissions(): void {
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
  const fromBoard = (url: string) => linkTarget(url, ORIGIN) === 'board';
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed.has(permission) && fromBoard(contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed.has(permission) && fromBoard(origin));
}

function buildMenu(): void {
  const boardMenu: MenuItemConstructorOptions = {
    label: 'Board',
    submenu: [
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => { if (ready) openBoardWindow(); } },
      { type: 'separator' },
      { label: 'Open in Browser', click: () => { void shell.openExternal(ORIGIN); } },
      { label: 'Copy Board Address', click: () => { void clipboard.writeText(ORIGIN); } },
      { type: 'separator' },
      { label: 'Show Server Log', click: () => { shell.showItemInFolder(LOG_FILE); } }
    ]
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      boardMenu,
      { role: 'windowMenu' }
    ])
  );
}

async function useExistingBoard(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: `A board is already running at ${ORIGIN}`,
    detail:
      'Probably agent-master-3000 started in a terminal. Show that board here, or quit and stop it first ' +
      'so this app can run its own?',
    buttons: ['Show It', 'Quit'],
    defaultId: 0,
    cancelId: 1
  });
  return response === 0;
}

async function launch(): Promise<void> {
  buildMenu();
  grantBoardPermissions();

  const shellEnv = await readShellEnv();
  const env = boardEnv({ inherited: process.env, shell: shellEnv, port: DESKTOP_PORT });
  windowUrl = boardWindowUrl(ORIGIN, env.BOARD_TOKEN?.trim() || undefined);

  if (await answers(ORIGIN)) {
    if (!(await useExistingBoard())) {
      app.quit();
      return;
    }
  } else {
    board = startBoard(env, ORIGIN, LOG_FILE);
    try {
      await board.ready;
    } catch (e) {
      dialog.showErrorBox(
        'Agent Master 3000 could not start its board',
        `${e instanceof Error ? e.message : String(e)}\n\n${logTail(LOG_FILE)}\n\nThe full log is ${LOG_FILE}.`
      );
      await board.stop();
      app.exit(1);
      return;
    }
  }

  ready = true;
  openBoardWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showOrOpenWindow);
  // The board keeps running with no window open; the Dock icon brings one back.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', showOrOpenWindow);

  let quitting = false;
  app.on('before-quit', (event) => {
    if (!board || quitting) return;
    // Hold the quit until the board has saved its state.
    event.preventDefault();
    quitting = true;
    void board.stop().then(() => app.quit());
  });

  void app.whenReady().then(launch);
}
