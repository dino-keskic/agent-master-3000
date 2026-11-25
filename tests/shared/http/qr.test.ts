import test from 'node:test';
import assert from 'node:assert';
import { encodeQr, qrSvgPath } from '../../../shared/http/qr.js';

/**
 * Verifies the pure ISO/IEC 18004 QR Code encoder (Byte mode, Level L, V1–V10):
 * geometry, finder/timing/dark/format/version patterns, RS parity, and SVG path.
 */

function assertFinderAt(modules: readonly (readonly boolean[])[], top: number, left: number): void {
  const size = modules.length;
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const r = top + dy;
      const c = left + dx;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const dist = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
      const expected = dist !== 2 && dist !== 4;
      assert.equal(modules[r]![c], expected, `finder mismatch at (${r}, ${c})`);
    }
  }
}

function readFormatCopy1(modules: readonly (readonly boolean[])[]): number {
  let bits = 0;
  for (let i = 0; i <= 5; i += 1) if (modules[i]![8]) bits |= 1 << i;
  if (modules[7]![8]) bits |= 1 << 6;
  if (modules[8]![8]) bits |= 1 << 7;
  if (modules[8]![7]) bits |= 1 << 8;
  for (let i = 9; i < 15; i += 1) if (modules[8]![14 - i]) bits |= 1 << i;
  return bits;
}

function readFormatCopy2(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let bits = 0;
  for (let i = 0; i < 8; i += 1) if (modules[8]![size - 1 - i]) bits |= 1 << i;
  for (let i = 8; i < 15; i += 1) if (modules[size - 15 + i]![8]) bits |= 1 << i;
  return bits;
}

test('encodeQr produces valid QR matrices across short, LAN URL, and long payloads (V1–V10)', () => {
  const samples = [
    { name: 'short', text: 'hi', expectedVersion: 1 },
    {
      name: 'typical LAN URL (~95 chars)',
      text: 'http://192.168.1.42:3738/?token=AbCdEf0123456789_-XyZ&task=TASK-123&session=ses_01JABCDEF',
      expectedVersion: 5
    },
    {
      name: 'long payload (~200 chars, multi-block with version info)',
      text: `http://macbook-pro.local:3738/?token=${'a'.repeat(40)}&task=TASK-999&session=${'s'.repeat(100)}`,
      expectedVersion: 9
    },
    {
      name: 'Version 10-L payload (16-bit byte count, 4 blocks across 2 groups)',
      text: 'x'.repeat(250),
      expectedVersion: 10
    }
  ];

  for (const sample of samples) {
    const qr = encodeQr(sample.text);
    assert.equal(qr.version, sample.expectedVersion, sample.name);
    assert.equal(qr.size, 21 + (qr.version - 1) * 4, sample.name);
    assert.equal(qr.modules.length, qr.size);
    for (const row of qr.modules) assert.equal(row.length, qr.size);

    // Three finder patterns + 1-module white separators.
    assertFinderAt(qr.modules, 0, 0);
    assertFinderAt(qr.modules, 0, qr.size - 7);
    assertFinderAt(qr.modules, qr.size - 7, 0);

    // Fixed dark module at (size - 8, 8).
    assert.equal(qr.modules[qr.size - 8]![8], true, `${sample.name} dark module`);

    // Timing patterns between finders.
    for (let i = 8; i < qr.size - 8; i += 1) {
      assert.equal(qr.modules[6]![i], i % 2 === 0, `${sample.name} horizontal timing at ${i}`);
      assert.equal(qr.modules[i]![6], i % 2 === 0, `${sample.name} vertical timing at ${i}`);
    }

    // Both format info copies must agree and decode to Level L (01).
    const fmt1 = readFormatCopy1(qr.modules);
    const fmt2 = readFormatCopy2(qr.modules);
    assert.equal(fmt1, fmt2, `${sample.name} format info copies agree`);
    const unmasked = fmt1 ^ 0x5412;
    const ecBits = (unmasked >>> 13) & 0b11;
    assert.equal(ecBits, 0b01, `${sample.name} EC level is L`);

    // For V7–V10, both 6x3 version info blocks must match and encode `qr.version`.
    if (qr.version >= 7) {
      let bl = 0;
      let tr = 0;
      for (let i = 0; i < 18; i += 1) {
        const a = qr.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        if (qr.modules[a]![b]) bl |= 1 << i;
        if (qr.modules[b]![a]) tr |= 1 << i;
      }
      assert.equal(bl, tr, `${sample.name} version info blocks agree`);
      assert.equal(bl >>> 12, qr.version, `${sample.name} version info encodes version`);
    }
  }
});

test('encodeQr rejects payloads beyond Version 10-L capacity (271 bytes)', () => {
  assert.doesNotThrow(() => encodeQr('a'.repeat(271)));
  assert.throws(() => encodeQr('a'.repeat(272)), RangeError);
});

test('encodeQr round-trips raw Byte-mode payload and satisfies RS syndromes across V1, V5, and V10', () => {
  // Independently unmask and read back the zigzag bitstream from the QR grid,
  // verify every RS block evaluates to 0 at roots alpha^0..alpha^(ec-1), and
  // confirm the decoded UTF-8 string equals the original input.
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i += 1) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) gfExp[i] = gfExp[i - 255]!;
  const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a]! + gfLog[b]!]!);

  const specs: Record<number, { ec: number; blocks: number[]; align: number[] }> = {
    1: { ec: 7, blocks: [19], align: [] },
    5: { ec: 26, blocks: [108], align: [6, 30] },
    10: { ec: 18, blocks: [68, 68, 69, 69], align: [6, 28, 50] }
  };

  const maskFn = (mask: number, r: number, c: number): boolean => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  const inputs = [
    'http://1.2.3.4:9/',
    'http://192.168.1.42:3738/?token=AbCdEf0123456789_-XyZ&task=TASK-123&session=ses_01JABCDEF',
    `http://192.168.1.42:3738/?token=${'T'.repeat(80)}&task=TASK-42&session=${'S'.repeat(120)}`
  ];

  for (const text of inputs) {
    const qr = encodeQr(text);
    const spec = specs[qr.version]!;
    const size = qr.size;
    const fmt = readFormatCopy1(qr.modules) ^ 0x5412;
    const mask = (fmt >>> 10) & 0b111;

    // Mark function regions.
    const fn = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    const mark = (r0: number, c0: number, h: number, w: number) => {
      for (let r = r0; r < r0 + h; r += 1) {
        for (let c = c0; c < c0 + w; c += 1) fn[r]![c] = true;
      }
    };
    mark(0, 0, 9, 9);
    mark(0, size - 8, 9, 8);
    mark(size - 8, 0, 8, 9);
    for (let i = 0; i < size; i += 1) {
      fn[6]![i] = true;
      fn[i]![6] = true;
    }
    const last = spec.align.length - 1;
    for (let i = 0; i < spec.align.length; i += 1) {
      for (let j = 0; j < spec.align.length; j += 1) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        mark(spec.align[i]! - 2, spec.align[j]! - 2, 5, 5);
      }
    }
    if (qr.version >= 7) {
      mark(size - 11, 0, 3, 6);
      mark(0, size - 11, 6, 3);
    }

    // Read interleaved codewords back in zigzag order.
    const totalCw = spec.blocks.reduce((sum, len) => sum + len + spec.ec, 0);
    const rawBits: number[] = [];
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step;
        for (let dx = 0; dx < 2; dx += 1) {
          const col = right - dx;
          if (fn[row]![col]) continue;
          const bit = qr.modules[row]![col]! !== maskFn(mask, row, col);
          rawBits.push(bit ? 1 : 0);
        }
      }
      upward = !upward;
    }

    const codewords = new Uint8Array(totalCw);
    for (let i = 0; i < totalCw; i += 1) {
      let b = 0;
      for (let j = 0; j < 8; j += 1) b = (b << 1) | rawBits[i * 8 + j]!;
      codewords[i] = b;
    }

    // De-interleave data and EC blocks and check all RS syndromes are 0.
    const dataBlocks = spec.blocks.map((len) => new Uint8Array(len));
    const ecBlocks = spec.blocks.map(() => new Uint8Array(spec.ec));
    let pos = 0;
    const maxData = Math.max(...spec.blocks);
    for (let i = 0; i < maxData; i += 1) {
      for (let b = 0; b < dataBlocks.length; b += 1) {
        if (i < dataBlocks[b]!.length) dataBlocks[b]![i] = codewords[pos++]!;
      }
    }
    for (let i = 0; i < spec.ec; i += 1) {
      for (let b = 0; b < ecBlocks.length; b += 1) {
        ecBlocks[b]![i] = codewords[pos++]!;
      }
    }

    for (let b = 0; b < dataBlocks.length; b += 1) {
      const full = new Uint8Array(dataBlocks[b]!.length + spec.ec);
      full.set(dataBlocks[b]!, 0);
      full.set(ecBlocks[b]!, dataBlocks[b]!.length);
      for (let root = 0; root < spec.ec; root += 1) {
        let evalVal = 0;
        const alpha = gfExp[root]!;
        for (let k = 0; k < full.length; k += 1) {
          evalVal = gfMul(evalVal, alpha) ^ full[k]!;
        }
        assert.equal(evalVal, 0, `V${qr.version} block ${b} RS syndrome at alpha^${root} must be 0`);
      }
    }

    // Reconstruct data bitstream and decode Byte-mode text.
    const flatData = new Uint8Array(spec.blocks.reduce((a, b) => a + b, 0));
    let off = 0;
    for (const blk of dataBlocks) {
      flatData.set(blk, off);
      off += blk.length;
    }
    const readBits = (start: number, len: number): number => {
      let val = 0;
      for (let i = 0; i < len; i += 1) {
        const idx = start + i;
        val = (val << 1) | ((flatData[idx >>> 3]! >>> (7 - (idx & 7))) & 1);
      }
      return val;
    };
    const mode = readBits(0, 4);
    assert.equal(mode, 0b0100, 'Byte mode indicator');
    const countBits = qr.version <= 9 ? 8 : 16;
    const len = readBits(4, countBits);
    const decoded = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      decoded[i] = readBits(4 + countBits + i * 8, 8);
    }
    assert.equal(new TextDecoder().decode(decoded), text);
  }
});

test('qrSvgPath emits one M x y h1v1h-1z subpath per dark module', () => {
  const sample = [
    [true, false],
    [false, true]
  ];
  assert.equal(qrSvgPath(sample), 'M0 0h1v1h-1zM1 1h1v1h-1z');

  const qr = encodeQr('http://192.168.1.5:3002/?task=TASK-1');
  const darkCount = qr.modules.flat().filter(Boolean).length;
  const path = qrSvgPath(qr.modules);
  const subpaths = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
  assert.equal(subpaths.length, darkCount);
  assert.equal(subpaths.join(''), path);
});
