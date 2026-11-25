/**
 * Pure TypeScript ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction
 * Level L, Versions 1 through 10 — up to 271 UTF-8 bytes).
 *
 * Zero dependencies so the client renders crisp SVG QR codes directly from
 * LAN deep links without bundling an external encoder.
 */

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

interface VersionSpec {
  version: number;
  /** Error-correction codewords per RS block (Level L). */
  ecPerBlock: number;
  /** Group 1: [blockCount, dataCodewordsPerBlock]. */
  g1: readonly [number, number];
  /** Group 2: [blockCount, dataCodewordsPerBlock]. */
  g2: readonly [number, number];
  /** Alignment pattern center coordinates (empty for Version 1). */
  alignment: readonly number[];
}

/**
 * ISO/IEC 18004 Table 9 (Level L) & Table E.1 (alignment centers) for V1–V10.
 * Total codewords = g1[0]*(g1[1]+ec) + g2[0]*(g2[1]+ec).
 */
const VERSIONS: readonly VersionSpec[] = [
  { version: 1, ecPerBlock: 7, g1: [1, 19], g2: [0, 0], alignment: [] },
  { version: 2, ecPerBlock: 10, g1: [1, 34], g2: [0, 0], alignment: [6, 18] },
  { version: 3, ecPerBlock: 15, g1: [1, 55], g2: [0, 0], alignment: [6, 22] },
  { version: 4, ecPerBlock: 20, g1: [1, 80], g2: [0, 0], alignment: [6, 26] },
  { version: 5, ecPerBlock: 26, g1: [1, 108], g2: [0, 0], alignment: [6, 30] },
  { version: 6, ecPerBlock: 18, g1: [2, 68], g2: [0, 0], alignment: [6, 34] },
  { version: 7, ecPerBlock: 20, g1: [2, 78], g2: [0, 0], alignment: [6, 22, 38] },
  { version: 8, ecPerBlock: 24, g1: [2, 97], g2: [0, 0], alignment: [6, 24, 42] },
  { version: 9, ecPerBlock: 30, g1: [2, 116], g2: [0, 0], alignment: [6, 26, 46] },
  { version: 10, ecPerBlock: 18, g1: [2, 68], g2: [2, 69], alignment: [6, 28, 50] }
];

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Generator polynomial g(x) = prod_{i=0}^{degree-1} (x - alpha^i), highest power first. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, root);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder of `data * x^ecCount` divided by the degree-`ecCount` generator. */
function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i]! ^ rem[0]!;
    for (let j = 0; j < ecCount - 1; j += 1) {
      rem[j] = rem[j + 1]! ^ gfMul(gen[j + 1]!, factor);
    }
    rem[ecCount - 1] = gfMul(gen[ecCount]!, factor);
  }
  return rem;
}

function totalDataCodewords(spec: VersionSpec): number {
  return spec.g1[0] * spec.g1[1] + spec.g2[0] * spec.g2[1];
}

function byteCountBits(version: number): number {
  // ISO/IEC 18004 Table 3: Byte mode uses 8-bit count for V1–V9, 16-bit for V10–V26.
  return version <= 9 ? 8 : 16;
}

function selectVersion(byteLength: number): VersionSpec {
  for (const spec of VERSIONS) {
    const capacityBits = totalDataCodewords(spec) * 8;
    const neededBits = 4 + byteCountBits(spec.version) + byteLength * 8;
    if (neededBits <= capacityBits) return spec;
  }
  throw new RangeError(`QR input exceeds Version 10-L capacity (${byteLength} bytes > 271 bytes)`);
}

function pushBits(bits: number[], value: number, count: number): void {
  for (let i = count - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

/** Encodes UTF-8 bytes in Byte mode and pads with alternating 0xEC / 0x11 codewords. */
function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const capacityCw = totalDataCodewords(spec);
  const capacityBits = capacityCw * 8;
  const bits: number[] = [];

  // Mode indicator: 0100 (Byte mode).
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, byteCountBits(spec.version));
  for (let i = 0; i < bytes.length; i += 1) {
    pushBits(bits, bytes[i]!, 8);
  }

  // Up to 4 zero terminator bits, then pad to a byte boundary.
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(capacityCw);
  const byteCount = bits.length / 8;
  for (let i = 0; i < byteCount; i += 1) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) {
      b = (b << 1) | bits[i * 8 + j]!;
    }
    codewords[i] = b;
  }

  const pads = [0xec, 0x11];
  for (let i = byteCount; i < capacityCw; i += 1) {
    codewords[i] = pads[(i - byteCount) % 2]!;
  }
  return codewords;
}

/** Splits data into RS blocks, computes EC bytes per block, and interleaves both halves. */
function interleaveBlocks(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const blocks: Array<{ data: Uint8Array; ec: Uint8Array }> = [];
  let offset = 0;

  for (const [count, size] of [spec.g1, spec.g2] as const) {
    for (let i = 0; i < count; i += 1) {
      const slice = data.subarray(offset, offset + size);
      offset += size;
      blocks.push({ data: slice, ec: rsRemainder(slice, spec.ecPerBlock) });
    }
  }

  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  const totalLen = blocks.reduce((sum, b) => sum + b.data.length + b.ec.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;

  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out[pos++] = block.data[i]!;
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of blocks) {
      out[pos++] = block.ec[i]!;
    }
  }
  return out;
}

function makeGrid(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

function setFunction(
  modules: boolean[][],
  isFunction: boolean[][],
  row: number,
  col: number,
  dark: boolean
): void {
  modules[row]![col] = dark;
  isFunction[row]![col] = true;
}

function placeFinder(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  top: number,
  left: number
): void {
  // Include the 1-module white separator ring around each 7x7 finder.
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const r = top + dy;
      const c = left + dx;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const dist = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
      const dark = dist !== 2 && dist !== 4;
      setFunction(modules, isFunction, r, c, dark);
    }
  }
}

function placeAlignment(
  modules: boolean[][],
  isFunction: boolean[][],
  centerRow: number,
  centerCol: number
): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dist = Math.max(Math.abs(dy), Math.abs(dx));
      setFunction(modules, isFunction, centerRow + dy, centerCol + dx, dist !== 1);
    }
  }
}

function placeFunctionPatterns(
  modules: boolean[][],
  isFunction: boolean[][],
  spec: VersionSpec
): void {
  const size = modules.length;

  // Timing patterns (placed first so finders and alignment patterns overlay cleanly).
  for (let i = 0; i < size; i += 1) {
    setFunction(modules, isFunction, 6, i, i % 2 === 0);
    setFunction(modules, isFunction, i, 6, i % 2 === 0);
  }

  // Three 7x7 finder patterns with 1-module separators.
  placeFinder(modules, isFunction, size, 0, 0);
  placeFinder(modules, isFunction, size, 0, size - 7);
  placeFinder(modules, isFunction, size, size - 7, 0);

  // Alignment patterns (skip the three corners occupied by finders).
  const centers = spec.alignment;
  const last = centers.length - 1;
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = 0; j < centers.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      placeAlignment(modules, isFunction, centers[i]!, centers[j]!);
    }
  }

  // Reserve format info strips and dark module (actual format bits written per mask).
  writeFormatBits(modules, isFunction, 0);

  // Version info (Versions 7–10): BCH(18, 6) with generator 0x1f25.
  if (spec.version >= 7) {
    let rem = spec.version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (spec.version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(modules, isFunction, a, b, dark);
      setFunction(modules, isFunction, b, a, dark);
    }
  }
}

/** Writes the 15-bit BCH(15, 5) masked format info for Level L (`01`) and `mask` (0..7). */
function writeFormatBits(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  // Error correction Level L indicator is binary `01`.
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  // Copy 1: around top-left finder (LSB at (0,8), MSB at (8,0)).
  for (let i = 0; i <= 5; i += 1) {
    setFunction(modules, isFunction, i, 8, ((bits >>> i) & 1) !== 0);
  }
  setFunction(modules, isFunction, 7, 8, ((bits >>> 6) & 1) !== 0);
  setFunction(modules, isFunction, 8, 8, ((bits >>> 7) & 1) !== 0);
  setFunction(modules, isFunction, 8, 7, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i += 1) {
    setFunction(modules, isFunction, 8, 14 - i, ((bits >>> i) & 1) !== 0);
  }

  // Copy 2: top-right horizontal strip (bits 0..7) and bottom-left vertical strip (bits 8..14).
  for (let i = 0; i < 8; i += 1) {
    setFunction(modules, isFunction, 8, size - 1 - i, ((bits >>> i) & 1) !== 0);
  }
  for (let i = 8; i < 15; i += 1) {
    setFunction(modules, isFunction, size - 15 + i, 8, ((bits >>> i) & 1) !== 0);
  }

  // Fixed dark module at (size - 8, 8) = (4 * version + 9, 8).
  setFunction(modules, isFunction, size - 8, 8, true);
}

/** Places interleaved data and EC bits along the standard bottom-right zigzag path. */
function placeCodewords(modules: boolean[][], isFunction: boolean[][], codewords: Uint8Array): void {
  const size = modules.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; shift left by one before stepping.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const col = right - dx;
        if (isFunction[row]![col]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex += 1;
        }
        modules[row]![col] = dark;
      }
    }
    upward = !upward;
  }
}

function maskBit(mask: number, r: number, c: number): boolean {
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
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!isFunction[r]![c] && maskBit(mask, r, c)) {
        modules[r]![c] = !modules[r]![c];
      }
    }
  }
}

function linePenalty(line: readonly boolean[]): number {
  let score = 0;
  let runColor = line[0]!;
  let runLen = 1;

  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === runColor) {
      runLen += 1;
    } else {
      if (runLen >= 5) score += 3 + (runLen - 5);
      runColor = line[i]!;
      runLen = 1;
    }
  }
  if (runLen >= 5) score += 3 + (runLen - 5);

  // Rule 3: finder-like 1:1:3:1:1 ratio preceded or followed by 4 light modules.
  for (let i = 0; i <= line.length - 11; i += 1) {
    const a =
      line[i] &&
      !line[i + 1] &&
      line[i + 2] &&
      line[i + 3] &&
      line[i + 4] &&
      !line[i + 5] &&
      line[i + 6] &&
      !line[i + 7] &&
      !line[i + 8] &&
      !line[i + 9] &&
      !line[i + 10];
    const b =
      !line[i] &&
      !line[i + 1] &&
      !line[i + 2] &&
      !line[i + 3] &&
      line[i + 4] &&
      !line[i + 5] &&
      line[i + 6] &&
      line[i + 7] &&
      line[i + 8] &&
      !line[i + 9] &&
      line[i + 10];
    if (a || b) score += 40;
  }

  return score;
}

/** ISO/IEC 18004 Section 7.8.3.1 penalty score across all four rules. */
function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;
  let darkCount = 0;

  // Rules 1 & 3 horizontally, plus dark count.
  for (let r = 0; r < size; r += 1) {
    const row = modules[r]!;
    score += linePenalty(row);
    for (let c = 0; c < size; c += 1) {
      if (row[c]) darkCount += 1;
    }
  }

  // Rules 1 & 3 vertically.
  const col = new Array<boolean>(size);
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r < size; r += 1) col[r] = modules[r]![c]!;
    score += linePenalty(col);
  }

  // Rule 2: 2x2 blocks of the same color.
  for (let r = 0; r < size - 1; r += 1) {
    const row0 = modules[r]!;
    const row1 = modules[r + 1]!;
    for (let c = 0; c < size - 1; c += 1) {
      const v = row0[c];
      if (v === row0[c + 1] && v === row1[c] && v === row1[c + 1]) score += 3;
    }
  }

  // Rule 4: deviation of dark-module balance from 50% in 5% steps.
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  score += k * 10;

  return score;
}

/**
 * Encodes `text` as a QR Code matrix (Byte mode, Error Correction Level L,
 * Versions 1–10), choosing the lowest-penalty mask pattern.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const spec = selectVersion(bytes.length);
  const size = 17 + 4 * spec.version;

  const data = encodeDataCodewords(bytes, spec);
  const codewords = interleaveBlocks(data, spec);

  const modules = makeGrid(size);
  const isFunction = makeGrid(size);
  placeFunctionPatterns(modules, isFunction, spec);
  placeCodewords(modules, isFunction, codewords);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(modules, isFunction, mask);
    writeFormatBits(modules, isFunction, mask);
    const score = penaltyScore(modules);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask);
  }

  applyMask(modules, isFunction, bestMask);
  writeFormatBits(modules, isFunction, bestMask);

  return { version: spec.version, size, modules };
}

/**
 * Renders every dark module as a compact SVG path (`M x y h1v1h-1z`) so a QR
 * code draws in a single `<path>` element with a quiet-zone `viewBox`.
 */
export function qrSvgPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  for (let y = 0; y < modules.length; y += 1) {
    const row = modules[y]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join('');
}
