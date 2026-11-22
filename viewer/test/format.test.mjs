import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, clockRange, minutes, compass, directionLabel, laneLabel } from '../js/format.js';

test('clock matches the exporter (plain English)', () => {
  assert.equal(clock(0), 'midnight');
  assert.equal(clock(7 * 3600 + 45 * 60), '7:45 am');
  assert.equal(clock(12 * 3600), 'noon');
  assert.equal(clock(15 * 3600 + 15 * 60), '3:15 pm');
  assert.equal(clock(24 * 3600 + 30 * 60), '12:30 am (next day)');
});

test('clockRange shares the am/pm suffix', () => {
  assert.equal(clockRange(7.5 * 3600, 7.75 * 3600), '7:30–7:45 am');
  assert.equal(clockRange(11.75 * 3600, 12 * 3600), '11:45 am–noon');
});

test('minutes keeps units and sensible precision', () => {
  assert.equal(minutes(390), '6.5 min');
  assert.equal(minutes(45), '0.8 min');
  assert.equal(minutes(1500), '25 min');
  assert.equal(minutes(Infinity), 'no route');
});

test('compass and direction labels', () => {
  assert.equal(compass(2), 'north');
  assert.equal(compass(91), 'east');
  assert.equal(compass(225), 'south-west');
  assert.equal(compass(359), 'north');
  assert.equal(directionLabel(181), 'south-bound');
});

test('lane label names the kerb lane for left-hand traffic', () => {
  assert.equal(laneLabel(0, 2), 'lane 1 of 2 (kerb side)');
  assert.equal(laneLabel(1, 2), 'lane 2 of 2 (centre side)');
  assert.equal(laneLabel(0, 1), 'single lane');
});
