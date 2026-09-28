/**
 * Preloaded into the board server by `load-test.sh` (`tsx --import`): once a
 * second it appends one JSON line to $PROBE_LOG with heap/RSS, event-loop delay
 * and how much the process wrote under the state file's folder. Measurement
 * only; never loaded outside the sandbox.
 */
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { setInterval } from 'timers';

const out = process.env.PROBE_LOG || '/sandbox/probe.log';
const stateDir = path.dirname(path.resolve(process.env.BOARD_STATE_FILE || 'data/board_state.json'));
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();

let writes = 0;
let bytes = 0;
let writeMs = 0;
let transcriptWrites = 0;
let transcriptBytes = 0;
const inState = (file) => typeof file === 'string' && path.resolve(file).startsWith(stateDir);
const count = (file, data, started) => {
  if (!inState(file)) return;
  const size = typeof data === 'string' ? Buffer.byteLength(data) : (data?.length ?? 0);
  writes += 1;
  bytes += size;
  writeMs += performance.now() - started;
  if (file.includes('.logs')) {
    transcriptWrites += 1;
    transcriptBytes += size;
  }
};

const syncWrite = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...rest) {
  const started = performance.now();
  const result = syncWrite.call(this, file, data, ...rest);
  count(file, data, started);
  return result;
};
const asyncWrite = fs.promises.writeFile;
fs.promises.writeFile = async function (file, data, ...rest) {
  const started = performance.now();
  const result = await asyncWrite.call(this, file, data, ...rest);
  count(typeof file === 'string' ? file : undefined, data, started);
  return result;
};

const started = Date.now();
setInterval(() => {
  const mem = process.memoryUsage();
  fs.appendFileSync(out, JSON.stringify({
    t: Math.round((Date.now() - started) / 1000),
    rssMb: +(mem.rss / 1e6).toFixed(1),
    heapMb: +(mem.heapUsed / 1e6).toFixed(1),
    lagP50: +(lag.percentile(50) / 1e6).toFixed(1),
    lagP99: +(lag.percentile(99) / 1e6).toFixed(1),
    lagMax: +(lag.max / 1e6).toFixed(1),
    writes,
    writeMb: +(bytes / 1e6).toFixed(2),
    writeMs: Math.round(writeMs),
    transcriptWrites,
    transcriptMb: +(transcriptBytes / 1e6).toFixed(2)
  }) + '\n');
  lag.reset();
  writes = 0;
  bytes = 0;
  writeMs = 0;
  transcriptWrites = 0;
  transcriptBytes = 0;
}, 1000).unref();
