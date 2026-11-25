import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_BREAKPOINT_PX,
  NARROW_WORKSPACE_PX,
  showBackInPanelHeader,
  sidebarPresentation
} from '../../../shared/board/viewport.js';

test('sidebarPresentation separates desktop inline from mobile drawer', () => {
  assert.equal(MOBILE_BREAKPOINT_PX, 767);
  assert.equal(NARROW_WORKSPACE_PX, 899);

  assert.equal(sidebarPresentation(false, true, false), 'inline');
  assert.equal(sidebarPresentation(false, false, true), 'hidden');

  assert.equal(sidebarPresentation(true, true, false), 'hidden');
  assert.equal(sidebarPresentation(true, true, true), 'drawer');
  assert.equal(sidebarPresentation(true, false, true), 'drawer');

  assert.equal(sidebarPresentation(false, true, true, true), 'hidden');
  assert.equal(sidebarPresentation(true, true, true, true), 'hidden');
});

test('showBackInPanelHeader reflects narrow workspace state', () => {
  assert.equal(showBackInPanelHeader(false), false);
  assert.equal(showBackInPanelHeader(true), true);
});
