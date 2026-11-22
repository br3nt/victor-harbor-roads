// Hotspot player helpers: track decoding, motion (heading/speed), speed classes, frame state and queues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTrack, motion, speedClass, prepare, vehiclesAt, clock, queuesAt, STOP } from '../hotspots/player.js';

test('decodeTrack expands deltas and still runs', () => {
  const xy = decodeTrack([10, 20, 2, 0, STOP, 3, 0, -1]);
  assert.deepEqual([...xy], [10, 20, 12, 20, 12, 20, 12, 20, 12, 20, 12, 19]);
});

test('motion: heading from movement, kept while standing still; speed in m/s', () => {
  // quantum 0.5 m: east 20 units = 10 m/s, then still, then north
  const xy = decodeTrack([0, 0, 20, 0, STOP, 2, 0, 20]);
  const { head, speed } = motion(xy, 0, 0.5);
  assert.equal(Math.round(head[0]), 90);
  assert.equal(Math.round(head[3]), 0);       // last frame of the still run looks ahead to the move north
  assert.equal(Math.round(head[1]), 90);      // standing still keeps the heading it arrived with
  assert.equal(speed[1], 10);
  assert.equal(speed[2], 0);
  assert.equal(speed[4], 10);
});

test('speed classes: stopped is class 0 (red), fast is the last', () => {
  assert.equal(speedClass(0), 0);
  assert.equal(speedClass(0.4), 0);
  assert.equal(speedClass(2), 1);
  assert.equal(speedClass(5), 2);
  assert.equal(speedClass(15), 3);
});

test('vehiclesAt and queuesAt follow the frame', () => {
  const doc = {
    t0: 44100, frames: 4, dt: 1, quantum: 0.5,
    tracks: [{ k: 1, f: 2, h: 180, p: [4, 6, 0, -2] }, { k: 0, f: 0, h: 90, p: [0, 0, 2, 0, 2, 0] }],
    approaches: [{ label: 'Lindsay Street from the south-west', xy: [0, 0] }],
    queues: [[0, 0, 1, 2]],
  };
  const p = prepare(doc);
  assert.equal(vehiclesAt(p, 0).length, 1);
  const at2 = vehiclesAt(p, 2);
  assert.equal(at2.length, 2);
  const truck = at2.find((v) => v.k === 1);
  assert.deepEqual([truck.x, truck.y], [2, 3]);
  assert.equal(vehiclesAt(p, 4).length, 0);
  assert.deepEqual(queuesAt(p, 3), [{ label: 'Lindsay Street from the south-west', n: 2 }]);
  assert.equal(clock(44100, 75), '12:16:15');
});
