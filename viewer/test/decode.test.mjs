import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { maybeGunzip, decodeLanes, decodeEdgeTimes, laneSeries } from '../js/decode.js';

const SAMPLE = fileURLToPath(new URL('../../sim/data/viewer/sample/', import.meta.url));

const LAYOUT = {
  planes: [
    { name: 'waiting_s', dtype: 'uint16', offset: 0, scale: 1, missing: null },
    { name: 'vehicles', dtype: 'uint16', offset: 12, scale: 1, missing: null },
    { name: 'speed_ratio', dtype: 'uint8', offset: 24, scale: 1 / 254, missing: 255 },
    { name: 'density', dtype: 'uint8', offset: 32, scale: 1, missing: 255 },
  ],
};

function lanesBuffer() {
  // T = 2 intervals, N = 3 lanes; planes padded to 4 bytes
  const buf = new ArrayBuffer(40);
  new Uint16Array(buf, 0, 6).set([0, 10, 65535, 1, 2, 3]);
  new Uint16Array(buf, 12, 6).set([5, 6, 7, 8, 9, 10]);
  new Uint8Array(buf, 24, 6).set([254, 127, 255, 0, 255, 254]);
  new Uint8Array(buf, 32, 6).set([10, 255, 20, 30, 40, 255]);
  return buf;
}

test('gunzip only when the bytes are gzip', async () => {
  const raw = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual(new Uint8Array(await maybeGunzip(raw.buffer)), raw);
  const gz = gzipSync(raw);
  assert.deepEqual(new Uint8Array(await maybeGunzip(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length))), raw);
});

test('decodeLanes returns typed views and decoded values (null = missing)', () => {
  const lanes = decodeLanes(lanesBuffer(), LAYOUT, 2, 3);
  assert.equal(lanes.value('waiting_s', 0, 2), 65535);
  assert.equal(lanes.value('vehicles', 1, 0), 8);
  assert.ok(Math.abs(lanes.value('speed_ratio', 0, 1) - 0.5) < 0.003);
  assert.equal(lanes.value('speed_ratio', 0, 2), null);
  assert.equal(lanes.value('density', 1, 2), null);
  assert.equal(lanes.raw.speed_ratio.length, 6);
  assert.deepEqual(laneSeries(lanes, 'vehicles', 1), [6, 9]);
});

test('decodeEdgeTimes converts deciseconds and impassable', () => {
  const buf = new ArrayBuffer(8);
  new Uint16Array(buf).set([105, 65535, 20, 30]);
  const tt = decodeEdgeTimes(buf, { planes: [{ offset: 0, scale: 0.1, missing: 65535 }] }, 2, 2);
  assert.ok(Math.abs(tt[0] - 10.5) < 1e-5);
  assert.equal(tt[1], Infinity);
  assert.ok(Math.abs(tt[3] - 3) < 1e-6);
});

test('the committed sample decodes consistently with its meta.json', async () => {
  const idx = JSON.parse(readFileSync(SAMPLE + 'index.json', 'utf8'));
  const run = idx.runs[0];
  const meta = JSON.parse(readFileSync(SAMPLE + run.path, 'utf8'));
  const dir = SAMPLE + run.path.replace(/meta\.json$/, '');
  const lb = readFileSync(dir + meta.files.lanes.path);
  const lanes = decodeLanes(await maybeGunzip(lb.buffer.slice(lb.byteOffset, lb.byteOffset + lb.length)),
    meta.files.lanes, meta.n_intervals, meta.n_lanes);
  let seen = 0;
  for (let i = 0; i < meta.n_lanes; i++) {
    const v = lanes.value('speed_ratio', 40, i);
    if (v !== null) { seen++; assert.ok(v >= 0 && v <= 1); }
  }
  assert.ok(seen > 10);
  const eb = readFileSync(dir + meta.files.edge_times.path);
  const tt = decodeEdgeTimes(await maybeGunzip(eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.length)),
    meta.files.edge_times, meta.n_intervals, meta.n_edges);
  assert.equal(tt.length, meta.n_intervals * meta.n_edges);
  assert.ok(tt.every((x) => x > 0));
});

test('fromBase64Text decodes a .b64.txt body back to the original bytes (published artifacts serve no .gz)', async () => {
  const { fromBase64Text, maybeGunzip } = await import('../js/decode.js');
  const bytes = Uint8Array.from([0x1f, 0x8b, 0, 255, 7]);
  const text = Buffer.from(bytes).toString('base64') + '\n';
  assert.deepEqual([...new Uint8Array(fromBase64Text(text))], [...bytes]);
  const gz = (await import('node:zlib')).gzipSync(Buffer.from('hello'));
  const back = await maybeGunzip(fromBase64Text(gz.toString('base64')));
  assert.equal(Buffer.from(back).toString(), 'hello');
});
