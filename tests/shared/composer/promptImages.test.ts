import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_IMAGES_PER_TURN,
  MAX_IMAGE_BYTES,
  PromptImage,
  dragHasFiles,
  imageCountLabel,
  imageExtension,
  imageRejection,
  imageUrl,
  isSupportedImageType,
  parseImageDataUrl,
  promptBlocks,
  sameImages
} from '../../../shared/composer/promptImages.js';

const image = (id: string): PromptImage => ({ id, name: `${id}.png`, mimeType: 'image/png', size: 10 });

test('accepts the image types a model can read, and refuses SVG', () => {
  assert.ok(isSupportedImageType('image/png'));
  assert.ok(isSupportedImageType('IMAGE/JPEG'));
  assert.ok(isSupportedImageType('image/webp'));
  assert.ok(!isSupportedImageType('image/svg+xml'));
  assert.ok(!isSupportedImageType('application/pdf'));
});

test('names a stored file after what it holds', () => {
  assert.strictEqual(imageExtension('image/jpeg'), 'jpg');
  assert.strictEqual(imageExtension('image/gif'), 'gif');
  assert.strictEqual(imageExtension('text/plain'), 'bin');
});

test('serves an image back from its own id', () => {
  assert.strictEqual(imageUrl({ id: 'abc.png' }), '/api/attachments/abc.png');
});

test('explains a refused drop in a sentence naming the file', () => {
  const wrongType = imageRejection({ name: 'notes.pdf', type: 'application/pdf', size: 10 }, 0);
  assert.ok(wrongType?.includes('notes.pdf'));

  const tooBig = imageRejection({ name: 'huge.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }, 0);
  assert.ok(tooBig?.includes('huge.png'));

  const tooMany = imageRejection({ name: 'ok.png', type: 'image/png', size: 10 }, MAX_IMAGES_PER_TURN);
  assert.ok(tooMany?.includes(String(MAX_IMAGES_PER_TURN)));

  assert.strictEqual(imageRejection({ name: 'ok.png', type: 'image/png', size: 10 }, 0), undefined);
});

test('only a drag carrying files can become an attachment', () => {
  assert.ok(dragHasFiles(['Files']));
  assert.ok(dragHasFiles(['text/plain', 'Files']));
  // A card being dragged across the board announces its own types.
  assert.ok(!dragHasFiles(['application/board-task']));
  assert.ok(!dragHasFiles(undefined));
  assert.ok(!dragHasFiles([]));
});

test('splits a data URL into the halves an upload needs', () => {
  assert.deepStrictEqual(parseImageDataUrl('data:image/PNG;base64,QUJD'), {
    mimeType: 'image/png',
    base64: 'QUJD'
  });
  assert.strictEqual(parseImageDataUrl('data:image/png,QUJD'), null);
  assert.strictEqual(parseImageDataUrl('QUJD'), null);
  assert.strictEqual(parseImageDataUrl('data:image/png;base64,'), null);
});

test('sends the pictures before the sentence that refers to them', () => {
  const blocks = promptBlocks('what is wrong here?', [{ mimeType: 'image/png', base64: 'QUJD' }]);
  assert.deepStrictEqual(blocks, [
    { type: 'image', mimeType: 'image/png', data: 'QUJD' },
    { type: 'text', text: 'what is wrong here?' }
  ]);
});

test('an image on its own is a turn; blank text is not sent as an instruction', () => {
  assert.deepStrictEqual(promptBlocks('   ', [{ mimeType: 'image/png', base64: 'QUJD' }]), [
    { type: 'image', mimeType: 'image/png', data: 'QUJD' }
  ]);
  assert.deepStrictEqual(promptBlocks('just text'), [{ type: 'text', text: 'just text' }]);
  assert.deepStrictEqual(promptBlocks(''), []);
});

test('two turns match only when they carry the same pictures in the same order', () => {
  assert.ok(sameImages(undefined, []));
  assert.ok(sameImages([image('a')], [image('a')]));
  assert.ok(!sameImages([image('a')], [image('b')]));
  assert.ok(!sameImages([image('a')], [image('a'), image('b')]));
  assert.ok(!sameImages([image('a'), image('b')], [image('b'), image('a')]));
});

test('counts images the way a sentence would', () => {
  assert.strictEqual(imageCountLabel([image('a')]), '1 image');
  assert.strictEqual(imageCountLabel([image('a'), image('b')]), '2 images');
});
