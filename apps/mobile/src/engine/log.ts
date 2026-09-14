/**
 * Mettle — the append-only result log.
 *
 * Cognitive-training data is a log of immutable facts: "user U produced threshold
 * T on task G at time S on device D." Append-only records have no conflicts BY
 * CONSTRUCTION — two devices inserting concurrently both simply insert. That is
 * why the sync design in Build Bible §07 is a queue of idempotent inserts rather
 * than a CRDT, and why the Postgres table carries no UPDATE or DELETE policy.
 *
 * The discipline that makes it work: DERIVED AGGREGATES ARE COMPUTED FROM THE LOG
 * AND NEVER STORED AS MUTABLE STATE. Streak, Ladder level, personal best and
 * baseline are all functions of the rows. Nothing in this file writes them back.
 *
 * Every row carries its own client-generated UUID, so a retried upload is a
 * no-op rather than a duplicate.
 */

import { mean } from './staircase';
import type { Session } from './measurement';

export type Capability = 'focus' | 'recall' | 'speed' | 'reasoning' | 'flexibility' | 'composure';

/** One completed round. The unit of measurement and the unit of sync. */
export interface RoundRow {
  id: string;                 // client-generated UUID; idempotency key
  userId: string;
  taskId: string;
  capability: Capability;
  /** 1-indexed attempt number for this user × task. Drives the practice curve. */
  attempt: number;
  /** Converged threshold in level units. Never a latency. */
  threshold: number;
  /** True when the user was pinned at a scale boundary; refused downstream. */
  offScale: boolean;
  proportionCorrect: number;
  trialCount: number;
  /** Ladder level being drilled, i.e. which METHOD this round was practising. */
  ladderLevel: number;
  startedAt: string;          // ISO 8601, device clock
  durationMs: number;
  deviceId: string;
  /** Per-device timing calibration offset in ms, measured at first run. */
  deviceOffsetMs: number;
  appVersion: string;
  engineVersion: string;
}

/** One if–then plan the user wrote, and what became of it. */
export interface MissionRow {
  id: string;
  userId: string;
  capability: Capability;
  ladderLevel: number;
  /** The situational cue, in the user's own words. Self-generated is load-bearing. */
  cueText: string;
  /** The action, in the user's own words. */
  actionText: string;
  createdAt: string;
  /** Set when the user reports back. Absent = not yet, never = missed. */
  completedAt?: string;
  outcomeNote?: string;
}

/** One delayed retrieval check. Always carries feedback — see Rowland 2014. */
export interface ProveRow {
  id: string;
  userId: string;
  missionId?: string;
  capability: Capability;
  ladderLevel: number;
  /** Hours since the material was learned. 24 and 168 are the standard checks. */
  delayHours: number;
  scheduledFor: string;
  answeredAt?: string;
  itemsCorrect?: number;
  itemsTotal?: number;
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * Append-only by interface, not merely by convention: there is no update and no
 * delete. A SQLite implementation backs the app; an in-memory one backs the tests.
 */
export interface ResultLog {
  appendRound(row: RoundRow): void;
  appendMission(row: MissionRow): void;
  appendProve(row: ProveRow): void;
  rounds(userId: string, taskId?: string): RoundRow[];
  missions(userId: string): MissionRow[];
  proves(userId: string): ProveRow[];
}

export class InMemoryLog implements ResultLog {
  private readonly r = new Map<string, RoundRow>();
  private readonly m = new Map<string, MissionRow>();
  private readonly p = new Map<string, ProveRow>();

  // Keyed by id, so a retried upload overwrites itself with itself.
  appendRound(row: RoundRow) { this.r.set(row.id, row); }
  appendMission(row: MissionRow) { this.m.set(row.id, row); }
  appendProve(row: ProveRow) { this.p.set(row.id, row); }

  rounds(userId: string, taskId?: string) {
    return [...this.r.values()]
      .filter((x) => x.userId === userId && (taskId === undefined || x.taskId === taskId))
      .sort((a, b) => a.attempt - b.attempt);
  }
  missions(userId: string) {
    return [...this.m.values()].filter((x) => x.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  proves(userId: string) {
    return [...this.p.values()].filter((x) => x.userId === userId)
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }
}

/* ------------------------------------------------------------------ *
 * Derivations — all pure functions of the rows
 * ------------------------------------------------------------------ */

/** Adapt rows into the shape the measurement layer consumes. */
export function toSessions(rows: RoundRow[]): Session[] {
  return rows.map((r) => ({
    threshold: r.threshold,
    at: new Date(r.startedAt),
    deviceId: r.deviceId,
    attempt: r.attempt,
    offScale: r.offScale,
  }));
}

/** Next attempt number for a user × task. Derived, never stored. */
export function nextAttempt(log: ResultLog, userId: string, taskId: string): number {
  const rows = log.rounds(userId, taskId);
  return rows.length ? Math.max(...rows.map((r) => r.attempt)) + 1 : 1;
}

/** Rounds already played on this task — drives the coarse-phase taper. */
export function roundsPlayed(log: ResultLog, userId: string, taskId: string): number {
  return log.rounds(userId, taskId).length;
}

/**
 * Ladder level for a capability.
 *
 * A rung requires all three: the method drilled to fluency (3 rounds at that
 * level), the mission deployed at least once, and the delayed check passed. That
 * is what makes the Ladder a record of capability owned rather than reps served.
 */
export const ROUNDS_PER_RUNG = 3;
export const MAX_LADDER_LEVEL = 5;

export interface RungStatus {
  level: number;
  roundsDone: number;
  missionDone: boolean;
  proveDone: boolean;
  complete: boolean;
}

export function rungStatus(
  log: ResultLog, userId: string, capability: Capability, level: number,
): RungStatus {
  const roundsDone = log.rounds(userId)
    .filter((r) => r.capability === capability && r.ladderLevel === level && !r.offScale).length;
  const missionDone = log.missions(userId)
    .some((m) => m.capability === capability && m.ladderLevel === level && !!m.completedAt);
  const proveDone = log.proves(userId).some(
    (p) => p.capability === capability && p.ladderLevel === level &&
      !!p.answeredAt && (p.itemsTotal ?? 0) > 0 &&
      (p.itemsCorrect ?? 0) / (p.itemsTotal ?? 1) >= 0.6,
  );
  return {
    level, roundsDone, missionDone, proveDone,
    complete: roundsDone >= ROUNDS_PER_RUNG && missionDone && proveDone,
  };
}

/** The level the user is currently working on: first incomplete rung. */
export function currentLadderLevel(log: ResultLog, userId: string, capability: Capability): number {
  for (let l = 1; l <= MAX_LADDER_LEVEL; l++) {
    if (!rungStatus(log, userId, capability, l).complete) return l;
  }
  return MAX_LADDER_LEVEL;
}

/** Personal best threshold on a task, ignoring off-scale and first-attempt rounds. */
export function personalBest(log: ResultLog, userId: string, taskId: string): number | null {
  const usable = log.rounds(userId, taskId).filter((r) => !r.offScale && r.attempt > 1);
  return usable.length ? Math.max(...usable.map((r) => r.threshold)) : null;
}

/** Mean threshold over the most recent k usable rounds. */
export function recentMean(log: ResultLog, userId: string, taskId: string, k = 4): number | null {
  const usable = log.rounds(userId, taskId).filter((r) => !r.offScale && r.attempt > 1);
  if (usable.length < k) return null;
  return mean(usable.slice(-k).map((r) => r.threshold));
}
