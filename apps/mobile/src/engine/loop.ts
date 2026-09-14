/**
 * Mettle — the daily loop state machine.
 *
 * Train → Apply → Prove, with the ratified dose split (decision 2, 13 Sep 2026):
 * Train runs three days a week; Apply and Prove run every day. The off-days are
 * not empty days, they are mission-and-recall days.
 *
 * Pure: takes the log and a date, returns what today looks like. No side effects,
 * no storage, no clock of its own — the date is always passed in, so the whole
 * loop is testable at any point in a user's history.
 */

import type { Capability, ResultLog, MissionRow, ProveRow } from './log';
import { currentLadderLevel, rungStatus, ROUNDS_PER_RUNG } from './log';
import { dayKind, streakLength, DEFAULT_TRAIN_DAYS } from './schedule';
import type { Weekday, DayActions } from './schedule';

export type StepId = 'train' | 'apply' | 'prove';
export type StepState = 'due' | 'done' | 'not-today' | 'nothing-due';

export interface Step {
  id: StepId;
  state: StepState;
  /** One line for the card. Written from the user's side of the screen. */
  detail: string;
}

export interface TodayView {
  date: Date;
  capability: Capability;
  ladderLevel: number;
  /** Rounds still to drill before this rung's training requirement is met. */
  roundsRemaining: number;
  steps: Step[];
  streak: number;
  /** True when everything due today is done. */
  complete: boolean;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const HOUR = 3600_000;

/* ------------------------------------------------------------------ *
 * Prove scheduling
 * ------------------------------------------------------------------ */

/**
 * Standard checks at 24 hours and 7 days.
 *
 * Rowland 2014: retrieval practice at a delay of ≥1 day gives g = 0.69 against
 * 0.41 within the same day — the benefit grows with delay. And feedback is not
 * optional: g = 0.73 with, 0.39 without, and retrieval at ≤50% accuracy WITHOUT
 * feedback returns g = 0.03, which is nothing at all.
 */
export const PROVE_DELAYS_HOURS = [24, 168] as const;

export function proveIsDue(p: ProveRow, now: Date): boolean {
  return !p.answeredAt && new Date(p.scheduledFor).getTime() <= now.getTime();
}

/** Missed by more than a day: still worth answering, but it stops counting for the rung. */
export function proveIsStale(p: ProveRow, now: Date): boolean {
  return !p.answeredAt && now.getTime() - new Date(p.scheduledFor).getTime() > 36 * HOUR;
}

export function dueProves(log: ResultLog, userId: string, now: Date): ProveRow[] {
  return log.proves(userId).filter((p) => proveIsDue(p, now));
}

/* ------------------------------------------------------------------ *
 * Mission lifecycle
 * ------------------------------------------------------------------ */

export function openMission(log: ResultLog, userId: string, now: Date): MissionRow | null {
  return (
    log.missions(userId).find(
      (m) => !m.completedAt && now.getTime() - new Date(m.createdAt).getTime() < 36 * HOUR,
    ) ?? null
  );
}

export function missionSetToday(log: ResultLog, userId: string, now: Date): boolean {
  return log.missions(userId).some((m) => sameDay(new Date(m.createdAt), now));
}

/**
 * An if–then plan is only valid if the user wrote both halves themselves.
 *
 * The conditional structure is load-bearing (Oettingen, Hönig & Gollwitzer 2000),
 * and the cue must be a specific, self-generated situation — "when I sit down at
 * my desk after lunch", not "today I'll focus better". So the UI cannot offer a
 * pick-list of cues, and this function is what enforces it.
 */
export function validateMission(cueText: string, actionText: string): string | null {
  const cue = cueText.trim();
  const action = actionText.trim();
  if (cue.length < 8) return 'Say when and where. A vague cue does not fire.';
  if (action.length < 8) return 'Say exactly what you will do.';
  if (/^(i will |i'll )?(try|focus|concentrate|do better|be better)\b/i.test(cue)) {
    return 'That is an intention, not a moment. Name a situation you will actually notice.';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Today
 * ------------------------------------------------------------------ */

export interface TodayInput {
  log: ResultLog;
  userId: string;
  capability: Capability;
  now: Date;
  trainDays?: Weekday[];
  /** Most recent days first is NOT assumed — pass oldest → newest, as stored. */
  recentDays: DayActions[];
}

export function today(input: TodayInput): TodayView {
  const { log, userId, capability, now } = input;
  const trainDays = input.trainDays ?? DEFAULT_TRAIN_DAYS;
  const level = currentLadderLevel(log, userId, capability);
  const rung = rungStatus(log, userId, capability, level);
  const isTrainDay = dayKind(now, trainDays) === 'train';

  const trainedToday = log
    .rounds(userId)
    .filter((r) => r.capability === capability && sameDay(new Date(r.startedAt), now)).length;
  const roundsRemaining = Math.max(0, ROUNDS_PER_RUNG - rung.roundsDone);

  const train: Step = isTrainDay
    ? trainedToday > 0
      ? { id: 'train', state: 'done', detail: `${trainedToday} rounds done` }
      : { id: 'train', state: 'due', detail: `3 rounds · ~14 min` }
    : {
        id: 'train',
        state: 'not-today',
        detail: `Next train day ${nextTrainDayLabel(now, trainDays)}`,
      };

  const open = openMission(log, userId, now);
  const apply: Step = missionSetToday(log, userId, now)
    ? open && !open.completedAt
      ? { id: 'apply', state: 'due', detail: 'Plan set — report back when you have done it' }
      : { id: 'apply', state: 'done', detail: 'Mission done' }
    : { id: 'apply', state: 'due', detail: "Write today's if–then" };

  const due = dueProves(log, userId, now);
  const prove: Step = due.length
    ? { id: 'prove', state: 'due', detail: `${due[0].delayHours}h check · ${due.length} waiting` }
    : { id: 'prove', state: 'nothing-due', detail: 'Nothing due back today' };

  const steps = [train, apply, prove];
  return {
    date: now,
    capability,
    ladderLevel: level,
    roundsRemaining,
    steps,
    streak: streakLength(input.recentDays),
    complete: steps.every((s) => s.state !== 'due'),
  };
}

function nextTrainDayLabel(now: Date, trainDays: Weekday[]): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (let i = 1; i <= 7; i++) {
    const d = (now.getDay() + i) % 7;
    if (trainDays.includes(d as Weekday)) return names[d];
  }
  return 'soon';
}

/**
 * Which single capability today's loop is about.
 *
 * One capability per day, rotating only through capabilities with an incomplete
 * rung — so a user finishing Recall stops being sent back to it. Deliberately NOT
 * interleaved across capabilities: Brunmair & Richter 2019 found interleaving
 * helps inductive learning with complex visual stimuli (g = 0.67) but HURTS
 * paired-associate word material (g = −0.39, blocking wins). Blocking is the
 * safer default for method acquisition; interleaving is applied inside the
 * Reasoning task, where the evidence actually supports it.
 */
export function capabilityForDay(
  log: ResultLog, userId: string, now: Date,
  order: Capability[] = ['focus', 'recall', 'speed', 'reasoning', 'flexibility', 'composure'],
): Capability {
  const open = order.filter((c) => currentLadderLevel(log, userId, c) <= 5 &&
    !rungStatus(log, userId, c, currentLadderLevel(log, userId, c)).complete);
  const pool = open.length ? open : order;
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  return pool[dayIndex % pool.length];
}
