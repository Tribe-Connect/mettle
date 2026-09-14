/**
 * Mettle — T1, engine unit tests.
 * Written for node:test here; portable to jest-expo in the app package.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Staircase, stepEasierFor, coarseTrialsFor, mean, sd } from '../src/staircase.ts';
import {
  newAbility, kFactor, pCorrect, seedLevel, abilityFromThreshold,
  roundGain, updateAbilityFromThreshold, updateElo,
} from '../src/elo.ts';
import {
  semFromDifferences, mdc, mdcInSDUnits, mdcForMeanOfK, rci, icc21,
  baselineFrom, assessChange, scoreBand, RELIABILITY_GATE,
} from '../src/measurement.ts';
import type { Session } from '../src/measurement.ts';
import {
  optimalGapFraction, optimalGapDays, nextReviewDate,
  dayKind, streakLength, dayCounts,
} from '../src/schedule.ts';

const close = (a: number, b: number, tol = 1e-9, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} !≈ ${b} (tol ${tol})`);

/* ================= staircase ================= */

test('stepEasier matches Kaernbach equilibrium at the canonical targets', () => {
  close(stepEasierFor(0.75, 1), 3);
  close(stepEasierFor(0.8, 1), 4);
  close(stepEasierFor(0.707, 1), 2.4129692832764507, 1e-9);
  close(stepEasierFor(0.75, 0.2), 0.6000000000000001, 1e-12);
});

test('stepEasier rejects impossible targets', () => {
  assert.throws(() => stepEasierFor(0, 1), RangeError);
  assert.throws(() => stepEasierFor(1, 1), RangeError);
});

test('a correct answer gets harder, an error gets easier, by the right ratio', () => {
  const sc = new Staircase(10, { targetP: 0.75, stepHarder: 1, coarseTrials: 0, granularity: 'continuous' });
  sc.record(true);
  close(sc.currentLevel, 11);
  sc.record(false);
  close(sc.currentLevel, 8); // 11 − 3
});

test('level is clamped to the scale and a clamped trial is not a reversal', () => {
  const sc = new Staircase(30, { minLevel: 1, maxLevel: 30, stepHarder: 1, coarseTrials: 0, granularity: 'continuous' });
  sc.record(true);  // would go to 31, clamps at 30, direction 0
  sc.record(true);  // still 30
  sc.record(false); // 27, direction -1 — first real movement, so no reversal yet
  const r = sc.result();
  assert.equal(r.ceilingTrials, 3);
  assert.equal(r.reversalLevels.length, 0, 'clamped trials must not manufacture reversals');
});

test('integer granularity keeps levels integral', () => {
  const sc = new Staircase(10, { granularity: 'integer', stepHarder: 0.4, targetP: 0.75, coarseTrials: 0 });
  for (let i = 0; i < 10; i++) sc.record(i % 3 !== 0);
  for (const t of sc.result().trials) assert.equal(Number.isInteger(t.level), true);
});

test('the coarse phase uses multiplied steps and is excluded from the estimate', () => {
  const sc = new Staircase(10, { stepHarder: 0.2, coarseTrials: 2, coarseStepMultiplier: 5, granularity: 'continuous' });
  sc.record(true);
  close(sc.currentLevel, 11);        // 0.2 × 5
  sc.record(true);
  close(sc.currentLevel, 12);
  sc.record(true);
  close(sc.currentLevel, 12.2);      // fine phase: 0.2
  const phases = sc.result().trials.map((t) => t.phase);
  assert.deepEqual(phases, ['coarse', 'coarse', 'fine']);
});

test('coarseTrialsFor pays for travel only while the user is unknown', () => {
  assert.equal(coarseTrialsFor(0), 12);
  assert.equal(coarseTrialsFor(1), 6);
  assert.equal(coarseTrialsFor(2), 6);
  assert.equal(coarseTrialsFor(3), 0);
  assert.equal(coarseTrialsFor(50), 0);
});

test('a user pinned at the ceiling is flagged off-scale, not given a number', () => {
  const sc = new Staircase(30, { minLevel: 1, maxLevel: 30, stepHarder: 0.2, coarseTrials: 0, granularity: 'continuous' });
  for (let i = 0; i < 30; i++) sc.record(true);
  assert.equal(sc.result().offScale, true);
});

test('a user in the middle of the scale is not flagged off-scale', () => {
  const sc = new Staircase(15, { minLevel: 1, maxLevel: 30, stepHarder: 0.2, coarseTrials: 0, granularity: 'continuous' });
  for (let i = 0; i < 30; i++) sc.record(i % 4 !== 0);
  assert.equal(sc.result().offScale, false);
});

test('the staircase converges on its target proportion correct', () => {
  // Deterministic pseudo-observer: an ideal 75% performer at level 15.
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const p = (level: number) => 1 / (1 + Math.exp(level - 15));
  const sc = new Staircase(15, { targetP: 0.75, stepHarder: 0.2, coarseTrials: 0, granularity: 'continuous', minLevel: 1, maxLevel: 30 });
  for (let i = 0; i < 400; i++) sc.record(rnd() < p(sc.currentLevel));
  const r = sc.result();
  assert.ok(Math.abs(r.proportionCorrect - 0.75) < 0.06, `pc ${r.proportionCorrect}`);
  assert.ok(Math.abs(r.threshold - (15 - Math.log(3))) < 0.5, `threshold ${r.threshold}`);
});

test('mean and sd behave, including the degenerate cases', () => {
  close(mean([1, 2, 3]), 2);
  close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395, 1e-12);
  assert.ok(Number.isNaN(mean([])));
  assert.ok(Number.isNaN(sd([1])));
});

/* ================= ability ================= */

test('K decays with evidence', () => {
  close(kFactor(0), 1);
  close(kFactor(20), 0.5);
  assert.ok(kFactor(100) < kFactor(10));
});

test('pCorrect respects the guess floor and is monotonic in ability', () => {
  close(pCorrect(-50, 0, 4), 0.25, 1e-6);
  assert.ok(pCorrect(5, 0, 4) > 0.99);
  assert.ok(pCorrect(1, 0) > pCorrect(0, 0));
  close(pCorrect(0, 0), 0.5);
});

test('seedLevel is the exact inverse of pCorrect', () => {
  for (const k of [undefined, 2, 4]) {
    for (const target of [0.7, 0.75, 0.8]) {
      const d = seedLevel(12, target, k);
      close(pCorrect(12, d, k), target, 1e-12, `k=${k} target=${target}`);
    }
  }
});

test('seedLevel refuses a target at or below the guess rate', () => {
  assert.throws(() => seedLevel(0, 0.25, 4), RangeError);
});

test('abilityFromThreshold round-trips seedLevel', () => {
  for (const k of [undefined, 4]) {
    const theta = 17.3;
    close(abilityFromThreshold(seedLevel(theta, 0.75, k), 0.75, k), theta, 1e-12);
  }
});

test('a new user starts at the population prior, not zero', () => {
  assert.equal(newAbility().theta, 0);
  assert.equal(newAbility(15).theta, 15);
});

test('round gain decays and the first round is taken at face value', () => {
  close(roundGain(0), 1);
  assert.ok(roundGain(12) < roundGain(3));
  const a0 = newAbility(15);
  const a1 = updateAbilityFromThreshold(a0, seedLevel(22, 0.75, 4), 0.75, 4);
  close(a1.theta, 22, 1e-9, 'first observation should be taken whole');
  assert.equal(a1.n, 1);
});

test('ability converges on a stable observer', () => {
  let a = newAbility(15);
  const trueTheta = 22;
  const obs = seedLevel(trueTheta, 0.75, 4);
  for (let i = 0; i < 12; i++) a = updateAbilityFromThreshold(a, obs, 0.75, 4);
  close(a.theta, trueTheta, 1e-6);
});

test('per-trial Elo still works, for content with genuinely unknown difficulty', () => {
  const up = updateElo(newAbility(), { d: 0, n: 0 }, true);
  assert.ok(up.ability.theta > 0, 'a correct answer raises ability');
  assert.ok(up.difficulty.d < 0, 'and lowers the item difficulty');
  close(up.expected, 0.5);
});

/* ================= measurement ================= */

test('MDC in SD units matches the published arithmetic', () => {
  close(mdcInSDUnits(0.9), 2.77 * Math.sqrt(0.1), 0.005);
  close(mdcInSDUnits(0.9), 0.8763, 0.001);
  close(mdcInSDUnits(0.4), 2.1471, 0.001);
  assert.ok(mdcInSDUnits(0.95) < mdcInSDUnits(0.7));
});

test('MDC95 is about 2.77 SEM and MDC90 is smaller', () => {
  close(mdc(1), 2.7719, 0.001);
  assert.ok(mdc(1, 90) < mdc(1, 95));
  assert.ok(mdc(1, 99) > mdc(1, 95));
});

test('averaging k sessions divides the bar by root k', () => {
  close(mdcForMeanOfK(1, 4), mdc(1) / 2, 1e-12);
  assert.throws(() => mdcForMeanOfK(1, 0), RangeError);
});

test('SEM from differences is SD_diff over root 2', () => {
  const diffs = [1, -1, 2, -2, 0, 1, -1];
  close(semFromDifferences(diffs), sd(diffs) / Math.SQRT2, 1e-12);
});

test('RCI crosses 1.96 exactly at the MDC95 boundary', () => {
  const SD = 10, r = 0.9;
  const bar = mdcInSDUnits(r) * SD;
  close(Math.abs(rci(50, 50 + bar, SD, r)), 1.96, 1e-9);
});

test('ICC is 1 for perfect agreement and near 0 for pure noise', () => {
  const perfect: Array<[number, number]> = [[1, 1], [4, 4], [9, 9], [2, 2], [7, 7]];
  close(icc21(perfect), 1, 1e-9);

  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const noise: Array<[number, number]> = Array.from({ length: 400 }, () => [rnd() * 10, rnd() * 10]);
  assert.ok(Math.abs(icc21(noise)) < 0.15, `noise ICC ${icc21(noise)}`);

  assert.ok(Number.isNaN(icc21([[1, 1], [2, 2]])), 'too few pairs is NaN, not a number');
});

/* --- the practice-effect rule --- */

const S = (attempt: number, threshold: number, deviceId = 'A', offScale = false): Session => ({
  attempt, threshold, deviceId, at: new Date(2026, 8, attempt), offScale,
});

test('baseline discards session 1 outright', () => {
  const sessions = [S(1, 100), S(2, 10), S(3, 10), S(4, 10), S(5, 10)];
  close(baselineFrom(sessions, 4), 10, 1e-12, 'session 1 must not contribute');
});

test('baseline refuses when there are not enough post-first sessions', () => {
  assert.equal(baselineFrom([S(1, 10), S(2, 10), S(3, 10)], 4), null);
});

/* --- the verdict --- */

const BASE = [S(1, 99), S(2, 10), S(3, 10), S(4, 10), S(5, 10)];

test('a task below the reliability gate is never scored', () => {
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 30), S(21, 30), S(22, 30), S(23, 30)],
    taskReliability: RELIABILITY_GATE - 0.01,
    cohortSDdiff: 1,
  });
  assert.equal(r.verdict, 'not-reportable');
  assert.equal(r.delta, null);
  assert.match(r.copy, /don't score it/);
});

test('a change spanning two devices is refused, not corrected', () => {
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 30, 'B'), S(21, 30, 'B'), S(22, 30, 'B'), S(23, 30, 'B')],
    taskReliability: 0.9,
    cohortSDdiff: 1,
  });
  assert.equal(r.verdict, 'device-changed');
});

test('off-scale sessions are set aside rather than averaged in', () => {
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 30, 'A', true), S(21, 30, 'A', true), S(22, 30, 'A', true), S(23, 30, 'A', true)],
    taskReliability: 0.9,
    cohortSDdiff: 1,
  });
  assert.equal(r.verdict, 'off-scale');
});

test('too few sessions produces no claim at all', () => {
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 30), S(21, 30)],
    taskReliability: 0.9,
    cohortSDdiff: 1,
  });
  assert.equal(r.verdict, 'insufficient-data');
});

test('movement inside measurement error is NOT called a change — and says so', () => {
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 10.5), S(21, 10.5), S(22, 10.5), S(23, 10.5)],
    taskReliability: 0.9,
    cohortSDdiff: 2,
  });
  assert.equal(r.verdict, 'no-detectable-change');
  assert.match(r.copy, /not the same as no change/);
});

test('movement past the bar is called, in both directions', () => {
  const up = assessChange({
    baseline: BASE,
    recent: [S(20, 16), S(21, 16), S(22, 16), S(23, 16)],
    taskReliability: 0.9,
    cohortSDdiff: 2,
  });
  assert.equal(up.verdict, 'improved');
  assert.ok((up.delta ?? 0) > (up.threshold ?? Infinity));

  const down = assessChange({
    baseline: BASE,
    recent: [S(20, 4), S(21, 4), S(22, 4), S(23, 4)],
    taskReliability: 0.9,
    cohortSDdiff: 2,
  });
  assert.equal(down.verdict, 'declined');
});

test('the bar is exactly MDC95 of the mean of k', () => {
  const cohortSDdiff = 2;
  const r = assessChange({
    baseline: BASE,
    recent: [S(20, 16), S(21, 16), S(22, 16), S(23, 16)],
    taskReliability: 0.9,
    cohortSDdiff,
  });
  close(r.threshold!, mdcForMeanOfK(cohortSDdiff / Math.SQRT2, 4), 1e-12);
});

test('every score is an interval, never a bare point', () => {
  const b = scoreBand(10, 2);
  close(b.point, 10);
  close(b.lower, 10 - 1.96 * 2, 1e-12);
  close(b.upper, 10 + 1.96 * 2, 1e-12);
  assert.ok(scoreBand(10, 2, 90).upper < b.upper, 'a 90% band is narrower than a 95% band');
});

/* ================= schedule ================= */

test('spacing follows the Cepeda anchors', () => {
  close(optimalGapFraction(7), 0.2);
  close(optimalGapFraction(35), 0.2);
  close(optimalGapFraction(365), 0.05);
  const mid = optimalGapFraction(110);
  assert.ok(mid < 0.2 && mid > 0.05, `interpolated fraction ${mid}`);
});

test('gap in days is at least one and scales with the retention target', () => {
  assert.equal(optimalGapDays(1), 1);
  assert.equal(optimalGapDays(35), 7);
  assert.ok(optimalGapDays(365) > optimalGapDays(35));
});

test('next review lands the right number of days out', () => {
  const from = new Date(2026, 8, 14);
  const next = nextReviewDate(from, 35);
  assert.equal(Math.round((next.getTime() - from.getTime()) / 86400000), 7);
});

test('train days are Mon/Wed/Fri by default; other days are apply-and-prove days', () => {
  assert.equal(dayKind(new Date(2026, 8, 14)), 'train');        // Monday
  assert.equal(dayKind(new Date(2026, 8, 15)), 'apply-prove');  // Tuesday
  assert.equal(dayKind(new Date(2026, 8, 16)), 'train');        // Wednesday
  assert.equal(dayKind(new Date(2026, 8, 19)), 'apply-prove');  // Saturday
});

test('any one of the three actions counts for the day', () => {
  assert.equal(dayCounts({ trained: false, applied: true, proved: false }), true);
  assert.equal(dayCounts({ trained: false, applied: false, proved: true }), true);
  assert.equal(dayCounts({ trained: false, applied: false, proved: false }), false);
});

test('the streak counts back from today and stops at the first empty day', () => {
  const yes = { trained: false, applied: true, proved: false };
  const no = { trained: false, applied: false, proved: false };
  assert.equal(streakLength([yes, yes, yes]), 3);
  assert.equal(streakLength([yes, no, yes, yes]), 2);
  assert.equal(streakLength([yes, yes, no]), 0);
  assert.equal(streakLength([]), 0);
});
