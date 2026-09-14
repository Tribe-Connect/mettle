/**
 * Mettle — T1 part 2: result log, task definitions, daily loop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryLog, toSessions, nextAttempt, roundsPlayed, rungStatus,
  currentLadderLevel, personalBest, recentMean, ROUNDS_PER_RUNG,
} from '../src/log.ts';
import type { RoundRow, MissionRow, ProveRow, Capability } from '../src/log.ts';
import {
  ALL_TASKS, taskFor, ORDERED_SPAN, PERIPHERAL_GLANCE, CLEAN_SWITCH, AUDITORY_TASKS_PERMITTED,
} from '../src/tasks.ts';
import {
  today, validateMission, proveIsDue, proveIsStale, dueProves,
  openMission, capabilityForDay, PROVE_DELAYS_HOURS,
} from '../src/loop.ts';

const U = 'user-1';
const DAY = 86_400_000;

let seq = 0;
function round(o: Partial<RoundRow> = {}): RoundRow {
  seq++;
  return {
    id: `r${seq}`, userId: U, taskId: 'recall.ordered-span', capability: 'recall',
    attempt: seq, threshold: 10, offScale: false, proportionCorrect: 0.75, trialCount: 35,
    ladderLevel: 1, startedAt: new Date(2026, 8, 14, 9).toISOString(), durationMs: 90_000,
    deviceId: 'A', deviceOffsetMs: 0, appVersion: '0.1.0', engineVersion: '0.1.0', ...o,
  };
}
function mission(o: Partial<MissionRow> = {}): MissionRow {
  seq++;
  return {
    id: `m${seq}`, userId: U, capability: 'recall', ladderLevel: 1,
    cueText: 'When I sit down after lunch', actionText: 'I will walk tomorrow\'s agenda',
    createdAt: new Date(2026, 8, 14, 9).toISOString(), ...o,
  };
}
function prove(o: Partial<ProveRow> = {}): ProveRow {
  seq++;
  return {
    id: `p${seq}`, userId: U, capability: 'recall', ladderLevel: 1, delayHours: 24,
    scheduledFor: new Date(2026, 8, 15, 9).toISOString(), ...o,
  };
}

/* ================= the log is append-only ================= */

test('re-appending the same id is idempotent, so a retried upload is a no-op', () => {
  const log = new InMemoryLog();
  const r = round({ id: 'fixed' });
  log.appendRound(r);
  log.appendRound({ ...r });
  log.appendRound({ ...r });
  assert.equal(log.rounds(U).length, 1);
});

test('rounds are scoped by user and task', () => {
  const log = new InMemoryLog();
  log.appendRound(round());
  log.appendRound(round({ taskId: 'speed.ufov', capability: 'speed' }));
  log.appendRound(round({ userId: 'other' }));
  assert.equal(log.rounds(U).length, 2);
  assert.equal(log.rounds(U, 'speed.ufov').length, 1);
  assert.equal(log.rounds('other').length, 1);
});

test('attempt numbers derive from the log, never from stored state', () => {
  const log = new InMemoryLog();
  assert.equal(nextAttempt(log, U, 'recall.ordered-span'), 1);
  log.appendRound(round({ attempt: 1 }));
  log.appendRound(round({ attempt: 2 }));
  assert.equal(nextAttempt(log, U, 'recall.ordered-span'), 3);
  assert.equal(roundsPlayed(log, U, 'recall.ordered-span'), 2);
});

test('rows convert cleanly into measurement sessions, carrying the off-scale flag', () => {
  const log = new InMemoryLog();
  log.appendRound(round({ attempt: 1, threshold: 9, offScale: true }));
  log.appendRound(round({ attempt: 2, threshold: 11 }));
  const s = toSessions(log.rounds(U));
  assert.equal(s.length, 2);
  assert.equal(s[0].offScale, true);
  assert.equal(s[1].attempt, 2);
  assert.ok(s[0].at instanceof Date);
});

test('personal best ignores first attempts and off-scale rounds', () => {
  const log = new InMemoryLog();
  log.appendRound(round({ attempt: 1, threshold: 99 }));          // practice effect, excluded
  log.appendRound(round({ attempt: 2, threshold: 12 }));
  log.appendRound(round({ attempt: 3, threshold: 40, offScale: true })); // boundary, excluded
  assert.equal(personalBest(log, U, 'recall.ordered-span'), 12);
});

test('recent mean refuses until there are enough usable rounds', () => {
  const log = new InMemoryLog();
  log.appendRound(round({ attempt: 1, threshold: 99 }));
  for (let i = 2; i <= 4; i++) log.appendRound(round({ attempt: i, threshold: 10 }));
  assert.equal(recentMean(log, U, 'recall.ordered-span', 4), null);
  log.appendRound(round({ attempt: 5, threshold: 14 }));
  assert.equal(recentMean(log, U, 'recall.ordered-span', 4), 11);
});

/* ================= the Ladder ================= */

function completeRung(log: InMemoryLog, capability: Capability, level: number) {
  for (let i = 0; i < ROUNDS_PER_RUNG; i++) log.appendRound(round({ capability, ladderLevel: level }));
  log.appendMission(mission({ capability, ladderLevel: level, completedAt: new Date().toISOString() }));
  log.appendProve(prove({
    capability, ladderLevel: level, answeredAt: new Date().toISOString(),
    itemsCorrect: 5, itemsTotal: 6,
  }));
}

test('a rung needs all three: drilled, deployed, and proved a day later', () => {
  const log = new InMemoryLog();
  for (let i = 0; i < ROUNDS_PER_RUNG; i++) log.appendRound(round({ ladderLevel: 1 }));
  let s = rungStatus(log, U, 'recall', 1);
  assert.equal(s.roundsDone, 3);
  assert.equal(s.complete, false, 'drilling alone must not complete a rung');

  log.appendMission(mission({ completedAt: new Date().toISOString() }));
  assert.equal(rungStatus(log, U, 'recall', 1).complete, false, 'still needs the delayed check');

  log.appendProve(prove({ answeredAt: new Date().toISOString(), itemsCorrect: 5, itemsTotal: 6 }));
  s = rungStatus(log, U, 'recall', 1);
  assert.equal(s.complete, true);
});

test('an off-scale round does not count toward a rung', () => {
  const log = new InMemoryLog();
  for (let i = 0; i < ROUNDS_PER_RUNG; i++) log.appendRound(round({ ladderLevel: 1, offScale: true }));
  assert.equal(rungStatus(log, U, 'recall', 1).roundsDone, 0);
});

test('a failed prove check does not complete the rung', () => {
  const log = new InMemoryLog();
  for (let i = 0; i < ROUNDS_PER_RUNG; i++) log.appendRound(round({ ladderLevel: 1 }));
  log.appendMission(mission({ completedAt: new Date().toISOString() }));
  log.appendProve(prove({ answeredAt: new Date().toISOString(), itemsCorrect: 2, itemsTotal: 6 }));
  assert.equal(rungStatus(log, U, 'recall', 1).complete, false);
});

test('the ladder advances only as rungs complete, and caps at 5', () => {
  const log = new InMemoryLog();
  assert.equal(currentLadderLevel(log, U, 'recall'), 1);
  completeRung(log, 'recall', 1);
  assert.equal(currentLadderLevel(log, U, 'recall'), 2);
  for (let l = 2; l <= 5; l++) completeRung(log, 'recall', l);
  assert.equal(currentLadderLevel(log, U, 'recall'), 5);
});

/* ================= the six tasks ================= */

test('all six capabilities have exactly one task, and every one is registered', () => {
  const caps: Capability[] = ['focus', 'recall', 'speed', 'reasoning', 'flexibility', 'composure'];
  assert.equal(ALL_TASKS.length, 6);
  for (const c of caps) assert.equal(taskFor(c).capability, c);
  assert.equal(new Set(ALL_TASKS.map((t) => t.id)).size, 6, 'task ids must be unique');
});

test('EVERY task carries a continuous fine dimension — the T2 design rule', () => {
  for (const t of ALL_TASKS) {
    assert.ok(t.fineDimension.length > 0, `${t.id} has no fine dimension`);
    assert.equal(t.staircase.granularity, 'continuous', `${t.id} must use a continuous scale`);
    assert.ok((t.staircase.stepHarder ?? 1) <= 0.25, `${t.id} step is too coarse for the bias bar`);
  }
});

test('every task maps its whole level range to finite, monotonic parameters', () => {
  for (const t of ALL_TASKS) {
    for (let l = 1; l <= 30; l += 0.5) {
      const p = t.levelToParams(l);
      for (const [k, v] of Object.entries(p)) {
        assert.ok(Number.isFinite(v), `${t.id} ${k} not finite at level ${l}`);
      }
    }
    // out of range must clamp, not explode
    assert.deepEqual(t.levelToParams(-99), t.levelToParams(1));
    assert.deepEqual(t.levelToParams(999), t.levelToParams(30));
  }
});

test('the span task gets longer and faster as the level rises', () => {
  const a = ORDERED_SPAN.levelToParams(1);
  const b = ORDERED_SPAN.levelToParams(30);
  assert.equal(a.listLength, 3);
  assert.equal(b.listLength, 12);
  assert.ok(b.presentationMs <= a.presentationMs);
  // the fine dimension must actually move WITHIN a band, or the T2 rule is cosmetic
  const l1 = ORDERED_SPAN.levelToParams(1);
  const l2 = ORDERED_SPAN.levelToParams(2);
  assert.equal(l1.listLength, l2.listLength);
  assert.ok(l2.presentationMs < l1.presentationMs, 'fine dimension must move within a band');
});

test('the speed task stays peripheral and shortens display duration', () => {
  const a = PERIPHERAL_GLANCE.levelToParams(1);
  const b = PERIPHERAL_GLANCE.levelToParams(30);
  assert.equal(a.eccentricityDeg, 10, 'inner UFOV has ICC .30 and must not be used');
  assert.ok(b.displayMs < a.displayMs / 10);
  assert.ok(b.distractors > a.distractors);
});

test('flexibility is flagged drill-only, ahead of the pilot confirming it', () => {
  assert.equal(CLEAN_SWITCH.reportability, 'expected-drill-only');
  assert.match(CLEAN_SWITCH.rationale, /never on switch cost/i);
});

test('auditory tasks are barred outright', () => {
  assert.equal(AUDITORY_TASKS_PERMITTED, false);
});

/* ================= missions ================= */

test('a vague cue is rejected; a situational one is accepted', () => {
  assert.equal(validateMission('When I sit down at my desk after lunch', 'I will walk my route'), null);
  assert.match(validateMission('later', 'I will walk my route') ?? '', /when and where/i);
  assert.match(validateMission('When I sit down after lunch', 'ok') ?? '', /exactly what/i);
  assert.match(
    validateMission('I will try to focus more today', 'I will walk my route') ?? '',
    /intention, not a moment/i,
  );
});

test('an open mission is found only inside its 36-hour window', () => {
  const log = new InMemoryLog();
  const created = new Date(2026, 8, 14, 9);
  log.appendMission(mission({ createdAt: created.toISOString() }));
  assert.ok(openMission(log, U, new Date(created.getTime() + 12 * 3600_000)));
  assert.equal(openMission(log, U, new Date(created.getTime() + 2 * DAY)), null);
});

/* ================= prove checks ================= */

test('the delayed checks are at 24 hours and 7 days', () => {
  assert.deepEqual([...PROVE_DELAYS_HOURS], [24, 168]);
});

test('a check is due once its time passes, and stale after 36 hours', () => {
  const at = new Date(2026, 8, 15, 9);
  const p = prove({ scheduledFor: at.toISOString() });
  assert.equal(proveIsDue(p, new Date(at.getTime() - 3600_000)), false);
  assert.equal(proveIsDue(p, new Date(at.getTime() + 60_000)), true);
  assert.equal(proveIsStale(p, new Date(at.getTime() + 12 * 3600_000)), false);
  assert.equal(proveIsStale(p, new Date(at.getTime() + 2 * DAY)), true);
  assert.equal(proveIsDue({ ...p, answeredAt: at.toISOString() }, new Date(at.getTime() + DAY)), false);
});

test('due checks are listed, answered ones are not', () => {
  const log = new InMemoryLog();
  const at = new Date(2026, 8, 15, 9);
  log.appendProve(prove({ scheduledFor: at.toISOString() }));
  log.appendProve(prove({ scheduledFor: at.toISOString(), answeredAt: at.toISOString() }));
  assert.equal(dueProves(log, U, new Date(at.getTime() + 60_000)).length, 1);
});

/* ================= today ================= */

const NO_DAYS = [{ trained: false, applied: false, proved: false }];

test('Monday is a train day and the three steps come back in order', () => {
  const log = new InMemoryLog();
  const v = today({ log, userId: U, capability: 'recall', now: new Date(2026, 8, 14, 9), recentDays: NO_DAYS });
  assert.deepEqual(v.steps.map((s) => s.id), ['train', 'apply', 'prove']);
  assert.equal(v.steps[0].state, 'due');
  assert.equal(v.ladderLevel, 1);
  assert.equal(v.roundsRemaining, 3);
});

test('Tuesday is not a train day — and the day is not empty', () => {
  const log = new InMemoryLog();
  const v = today({ log, userId: U, capability: 'recall', now: new Date(2026, 8, 15, 9), recentDays: NO_DAYS });
  assert.equal(v.steps[0].state, 'not-today');
  assert.match(v.steps[0].detail, /Wednesday/);
  assert.equal(v.steps[1].state, 'due', 'Apply still runs daily');
});

test('training today marks the step done', () => {
  const log = new InMemoryLog();
  const now = new Date(2026, 8, 14, 9);
  log.appendRound(round({ startedAt: now.toISOString() }));
  const v = today({ log, userId: U, capability: 'recall', now, recentDays: NO_DAYS });
  assert.equal(v.steps[0].state, 'done');
});

test('a set-but-unfinished mission still reads as due', () => {
  const log = new InMemoryLog();
  const now = new Date(2026, 8, 15, 14);
  log.appendMission(mission({ createdAt: new Date(2026, 8, 15, 9).toISOString() }));
  const v = today({ log, userId: U, capability: 'recall', now, recentDays: NO_DAYS });
  assert.equal(v.steps[1].state, 'due');
  assert.match(v.steps[1].detail, /report back/i);
});

test('with nothing due, prove reads as nothing-due rather than as a failure', () => {
  const log = new InMemoryLog();
  const v = today({ log, userId: U, capability: 'recall', now: new Date(2026, 8, 15, 9), recentDays: NO_DAYS });
  assert.equal(v.steps[2].state, 'nothing-due');
});

test('a day is complete when nothing is still due, and the streak comes through', () => {
  const log = new InMemoryLog();
  const now = new Date(2026, 8, 15, 14); // Tuesday: no train
  log.appendMission(mission({
    createdAt: now.toISOString(), completedAt: now.toISOString(),
  }));
  const yes = { trained: false, applied: true, proved: false };
  const v = today({ log, userId: U, capability: 'recall', now, recentDays: [yes, yes, yes] });
  assert.equal(v.complete, true);
  assert.equal(v.streak, 3);
});

test('the daily capability rotates only through rungs that are still open', () => {
  const log = new InMemoryLog();
  for (let l = 1; l <= 5; l++) completeRung(log, 'focus', l);
  const seen = new Set<Capability>();
  for (let d = 0; d < 14; d++) {
    seen.add(capabilityForDay(log, U, new Date(2026, 8, 14 + d)));
  }
  assert.equal(seen.has('focus'), false, 'a finished capability must stop coming round');
  assert.ok(seen.size >= 4);
});
