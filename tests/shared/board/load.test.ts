import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BoardLoadInput,
  LOADING_REVEAL_MS,
  LOADING_SLOW_MS,
  boardLoadState,
  connectionLabel
} from '../../../shared/board/load.js';

const input = (over: Partial<BoardLoadInput> = {}): BoardLoadInput => ({
  hasLoaded: false,
  loadError: null,
  isConnected: false,
  elapsedMs: 1000,
  ...over
});

describe('boardLoadState', () => {
  it('shows the loading screen and hides the board on a first load', () => {
    const state = boardLoadState(input());
    assert.equal(state.phase, 'loading');
    assert.equal(state.showBoard, false);
    assert.equal(state.showLoadingScreen, true);
    assert.equal(state.canRetry, false);
    assert.match(state.message, /Connecting/);
  });

  it('holds the loading screen back until a fast load has had its chance', () => {
    assert.equal(boardLoadState(input({ elapsedMs: 0 })).showLoadingScreen, false);
    assert.equal(
      boardLoadState(input({ elapsedMs: LOADING_REVEAL_MS - 1 })).showLoadingScreen,
      false
    );
    assert.equal(boardLoadState(input({ elapsedMs: LOADING_REVEAL_MS })).showLoadingScreen, true);
  });

  it('explains itself once the first load is taking a long time', () => {
    const quick = boardLoadState(input({ elapsedMs: LOADING_SLOW_MS - 1 }));
    const slow = boardLoadState(input({ elapsedMs: LOADING_SLOW_MS }));
    assert.equal(slow.phase, 'loading');
    assert.notEqual(slow.message, quick.message);
    assert.match(slow.message, /Still connecting/);
  });

  it('reports a failed first load with its reason and offers a retry', () => {
    const state = boardLoadState(input({ loadError: 'Network request failed' }));
    assert.equal(state.phase, 'failed');
    assert.equal(state.message, 'Network request failed');
    assert.equal(state.showBoard, false);
    assert.equal(state.showLoadingScreen, true);
    assert.equal(state.canRetry, true);
  });

  it('shows a failed first load immediately, without the reveal delay', () => {
    const state = boardLoadState(input({ loadError: 'Boom', elapsedMs: 0 }));
    assert.equal(state.showLoadingScreen, true);
  });

  it('is ready once data has landed and the socket is up', () => {
    const state = boardLoadState(input({ hasLoaded: true, isConnected: true }));
    assert.equal(state.phase, 'ready');
    assert.equal(state.showBoard, true);
    assert.equal(state.showLoadingScreen, false);
  });

  it('keeps the board on screen when the socket drops after data landed', () => {
    const state = boardLoadState(input({ hasLoaded: true, isConnected: false }));
    assert.equal(state.phase, 'reconnecting');
    assert.equal(state.showBoard, true);
    assert.equal(state.showLoadingScreen, false);
    assert.equal(state.canRetry, false);
  });

  it('keeps the board on screen when a later refresh fails', () => {
    const state = boardLoadState(
      input({ hasLoaded: true, isConnected: true, loadError: 'Could not load the board' })
    );
    assert.equal(state.phase, 'ready');
    assert.equal(state.showBoard, true);
    assert.equal(state.showLoadingScreen, false);
  });

  it('never offers a retry while the board itself is visible', () => {
    for (const isConnected of [true, false]) {
      for (const loadError of [null, 'nope']) {
        const state = boardLoadState(input({ hasLoaded: true, isConnected, loadError }));
        assert.equal(state.canRetry, false);
        assert.equal(state.showBoard, true);
      }
    }
  });
});

describe('connectionLabel', () => {
  it('separates a first connect from a reconnect', () => {
    assert.equal(connectionLabel('loading'), 'Connecting…');
    assert.equal(connectionLabel('failed'), 'Connecting…');
    // The board is on screen here, so the tasks are real and only the feed is not.
    assert.equal(connectionLabel('reconnecting'), 'Reconnecting…');
    assert.equal(connectionLabel('ready'), 'Connected');
  });
});
