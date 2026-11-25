import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_INLINE_DATA_MEDIA_LENGTH,
  mediaKindForPath,
  mediaMimeForPath,
  mediaPartToMarkdown,
  resolveMediaTarget
} from '../../../shared/transcript/media.js';

test('classifies supported image and video extensions case-insensitively', () => {
  assert.strictEqual(mediaKindForPath('shot.PNG'), 'image');
  assert.strictEqual(mediaKindForPath('/tmp/photo.jpeg?v=2#top'), 'image');
  assert.strictEqual(mediaKindForPath('anim.webp'), 'image');
  assert.strictEqual(mediaKindForPath('pic.avif'), 'image');
  assert.strictEqual(mediaKindForPath('pic.bmp'), 'image');
  assert.strictEqual(mediaKindForPath('demo.MP4'), 'video');
  assert.strictEqual(mediaKindForPath('flow.webm?token=abc'), 'video');
  assert.strictEqual(mediaKindForPath('capture.mov'), 'video');
  assert.strictEqual(mediaKindForPath('clip.m4v'), 'video');
  assert.strictEqual(mediaKindForPath('clip.ogv'), 'video');
  assert.strictEqual(mediaKindForPath('notes.txt'), null);
  assert.strictEqual(mediaKindForPath('icon.svg'), null);
  assert.strictEqual(mediaKindForPath('/etc/passwd'), null);

  assert.strictEqual(mediaMimeForPath('shot.jpg'), 'image/jpeg');
  assert.strictEqual(mediaMimeForPath('demo.mov'), 'video/quicktime');
  assert.strictEqual(mediaMimeForPath('readme.md'), null);
});

test('resolves remote http(s) URLs, attachments, and safe data URLs', () => {
  assert.deepStrictEqual(resolveMediaTarget('https://img.shields.io/badge/build-passing-green'), {
    kind: 'image',
    url: 'https://img.shields.io/badge/build-passing-green'
  });
  assert.deepStrictEqual(resolveMediaTarget('https://cdn.example.com/demo.mp4?sig=1'), {
    kind: 'video',
    url: 'https://cdn.example.com/demo.mp4?sig=1'
  });
  assert.deepStrictEqual(resolveMediaTarget('/api/attachments/abc.png'), {
    kind: 'image',
    url: '/api/attachments/abc.png'
  });
  assert.deepStrictEqual(resolveMediaTarget('/api/attachments/abc.webm'), {
    kind: 'video',
    url: '/api/attachments/abc.webm'
  });

  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepStrictEqual(resolveMediaTarget(dataUrl), {
    kind: 'image',
    url: dataUrl
  });
});

test('resolves local absolute, relative, and file:// media paths through /api/media', () => {
  assert.deepStrictEqual(
    resolveMediaTarget('./shots/ui.png', { cwd: '/repo/app', taskId: 'T-1' }),
    {
      kind: 'image',
      url: '/api/media?path=%2Frepo%2Fapp%2Fshots%2Fui.png&taskId=T-1',
      localPath: '/repo/app/shots/ui.png'
    }
  );
  assert.deepStrictEqual(
    resolveMediaTarget('../demo.mp4', { cwd: '/repo/app/sub' }),
    {
      kind: 'video',
      url: '/api/media?path=%2Frepo%2Fapp%2Fdemo.mp4',
      localPath: '/repo/app/demo.mp4'
    }
  );
  assert.deepStrictEqual(
    resolveMediaTarget('/tmp/screens/out.webp', { taskId: 'T-2' }),
    {
      kind: 'image',
      url: '/api/media?path=%2Ftmp%2Fscreens%2Fout.webp&taskId=T-2',
      localPath: '/tmp/screens/out.webp'
    }
  );
  assert.deepStrictEqual(
    resolveMediaTarget('file:///tmp/my%20clip.mov', { taskId: 'T-3' }),
    {
      kind: 'video',
      url: '/api/media?path=%2Ftmp%2Fmy%20clip.mov&taskId=T-3',
      localPath: '/tmp/my clip.mov'
    }
  );
  // Relative paths require a working directory.
  assert.strictEqual(resolveMediaTarget('./shots/ui.png'), null);
});

test('rejects unsafe schemes, SVG data URLs, and non-media local files', () => {
  assert.strictEqual(resolveMediaTarget('javascript:alert(1)'), null);
  assert.strictEqual(resolveMediaTarget('vbscript:msgbox(1)'), null);
  assert.strictEqual(resolveMediaTarget('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.strictEqual(resolveMediaTarget('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.strictEqual(resolveMediaTarget('/etc/passwd'), null);
  assert.strictEqual(resolveMediaTarget('file:///etc/passwd'), null);
  assert.strictEqual(resolveMediaTarget('./secret.env', { cwd: '/repo' }), null);
  assert.strictEqual(resolveMediaTarget('ftp://example.com/pic.png'), null);
});

test('converts renderable OpenCode file/image parts to markdown and skips unsafe/oversized ones', () => {
  assert.strictEqual(
    mediaPartToMarkdown({ url: 'file:///tmp/shot.png', mime: 'image/png', filename: 'shot.png' }),
    '![shot.png](file:///tmp/shot.png)'
  );
  assert.strictEqual(
    mediaPartToMarkdown({ url: 'data:image/png;base64,QUJD', mime: 'image/png', filename: 'paste.png' }),
    '![paste.png](data:image/png;base64,QUJD)'
  );
  assert.strictEqual(
    mediaPartToMarkdown({ url: 'https://example.com/demo.mp4', mime: 'video/mp4' }),
    '![demo.mp4](https://example.com/demo.mp4)'
  );
  assert.strictEqual(
    mediaPartToMarkdown({ url: 'file:///tmp/notes.txt', mime: 'text/plain', filename: 'notes.txt' }),
    undefined
  );
  assert.strictEqual(
    mediaPartToMarkdown({ url: 'data:image/svg+xml;base64,PHN2Zz4=', mime: 'image/svg+xml' }),
    undefined
  );
  assert.strictEqual(
    mediaPartToMarkdown({
      url: `data:image/png;base64,${'A'.repeat(MAX_INLINE_DATA_MEDIA_LENGTH)}`,
      mime: 'image/png'
    }),
    undefined
  );
});
