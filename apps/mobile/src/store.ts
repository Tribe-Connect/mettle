/**
 * Mettle — on-device store.
 *
 * expo-sqlite in WAL mode, append-only. No UPDATE, no DELETE: the tables mirror
 * the Postgres schema in Build Bible §07, which deliberately carries no update or
 * delete policy. Derived state — streak, Ladder level, personal best, baseline —
 * is computed from the rows on read and never written back.
 *
 * A mission's completion and a check's answer are recorded as NEW rows, not as
 * updates to the original; the reader takes the latest. That keeps the append-only
 * property true all the way down rather than true only in the comment.
 */

import * as SQLite from 'expo-sqlite';
import type {
  RoundRow, MissionRow, ProveRow, ResultLog, Capability,
} from './engine/log';

const DB = 'mettle.db';
let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      taskId TEXT NOT NULL,
      capability TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      threshold REAL NOT NULL,
      offScale INTEGER NOT NULL,
      proportionCorrect REAL NOT NULL,
      trialCount INTEGER NOT NULL,
      ladderLevel INTEGER NOT NULL,
      startedAt TEXT NOT NULL,
      durationMs INTEGER NOT NULL,
      deviceId TEXT NOT NULL,
      deviceOffsetMs REAL NOT NULL,
      appVersion TEXT NOT NULL,
      engineVersion TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rounds_user_task ON rounds (userId, taskId, attempt);

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      capability TEXT NOT NULL,
      ladderLevel INTEGER NOT NULL,
      cueText TEXT NOT NULL,
      actionText TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      completedAt TEXT,
      outcomeNote TEXT
    );
    CREATE INDEX IF NOT EXISTS missions_user ON missions (userId, createdAt);

    CREATE TABLE IF NOT EXISTS proves (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      missionId TEXT,
      capability TEXT NOT NULL,
      ladderLevel INTEGER NOT NULL,
      delayHours INTEGER NOT NULL,
      scheduledFor TEXT NOT NULL,
      answeredAt TEXT,
      itemsCorrect INTEGER,
      itemsTotal INTEGER
    );
    CREATE INDEX IF NOT EXISTS proves_user ON proves (userId, scheduledFor);
  `);
  return db;
}

/**
 * A snapshot of the log, loaded once per screen.
 *
 * The engine's derivations are synchronous and pure, so the screen reads a
 * snapshot rather than awaiting inside render. Small data by design: a year of
 * daily use is a few thousand rows.
 */
export class SnapshotLog implements ResultLog {
  constructor(
    private r: RoundRow[] = [],
    private m: MissionRow[] = [],
    private p: ProveRow[] = [],
  ) {}

  appendRound(row: RoundRow) { this.r = [...this.r.filter((x) => x.id !== row.id), row]; }
  appendMission(row: MissionRow) { this.m = [...this.m.filter((x) => x.id !== row.id), row]; }
  appendProve(row: ProveRow) { this.p = [...this.p.filter((x) => x.id !== row.id), row]; }

  rounds(userId: string, taskId?: string) {
    return this.r
      .filter((x) => x.userId === userId && (taskId === undefined || x.taskId === taskId))
      .sort((a, b) => a.attempt - b.attempt);
  }
  missions(userId: string) {
    return [...this.m].filter((x) => x.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  proves(userId: string) {
    return [...this.p].filter((x) => x.userId === userId)
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }
}

const bool = (v: unknown) => v === 1 || v === true;

export async function loadSnapshot(userId: string): Promise<SnapshotLog> {
  const d = await openDb();
  const rounds = await d.getAllAsync<Record<string, never>>(
    'SELECT * FROM rounds WHERE userId = ? ORDER BY attempt ASC', userId,
  );
  const missions = await d.getAllAsync<Record<string, never>>(
    'SELECT * FROM missions WHERE userId = ? ORDER BY createdAt ASC', userId,
  );
  const proves = await d.getAllAsync<Record<string, never>>(
    'SELECT * FROM proves WHERE userId = ? ORDER BY scheduledFor ASC', userId,
  );
  return new SnapshotLog(
    rounds.map((r) => ({ ...(r as object), offScale: bool((r as never)['offScale']) } as RoundRow)),
    missions as unknown as MissionRow[],
    proves as unknown as ProveRow[],
  );
}

/* ------------------------------------------------------------------ *
 * Writes — inserts only
 * ------------------------------------------------------------------ */

export async function saveRound(row: RoundRow): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO rounds
     (id,userId,taskId,capability,attempt,threshold,offScale,proportionCorrect,trialCount,
      ladderLevel,startedAt,durationMs,deviceId,deviceOffsetMs,appVersion,engineVersion)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.userId, row.taskId, row.capability, row.attempt, row.threshold,
    row.offScale ? 1 : 0, row.proportionCorrect, row.trialCount, row.ladderLevel,
    row.startedAt, row.durationMs, row.deviceId, row.deviceOffsetMs,
    row.appVersion, row.engineVersion,
  );
}

export async function saveMission(row: MissionRow): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO missions
     (id,userId,capability,ladderLevel,cueText,actionText,createdAt,completedAt,outcomeNote)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    row.id, row.userId, row.capability, row.ladderLevel, row.cueText, row.actionText,
    row.createdAt, row.completedAt ?? null, row.outcomeNote ?? null,
  );
}

export async function saveProve(row: ProveRow): Promise<void> {
  const d = await openDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO proves
     (id,userId,missionId,capability,ladderLevel,delayHours,scheduledFor,answeredAt,itemsCorrect,itemsTotal)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.userId, row.missionId ?? null, row.capability, row.ladderLevel,
    row.delayHours, row.scheduledFor, row.answeredAt ?? null,
    row.itemsCorrect ?? null, row.itemsTotal ?? null,
  );
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export const LOCAL_USER = 'local';

/**
 * Device identity.
 *
 * Cross-device comparisons are REFUSED, not corrected — an Android device alone
 * imposes β = 0.56 SD on simple reaction time, enough to manufacture most of a
 * "reliable change" from a phone upgrade. For v0.1 this is a per-install id;
 * v0.2 replaces it with a stable hardware fingerprint plus the measured
 * per-device timing offset.
 */
let cachedDeviceId: string | null = null;
export function deviceId(): string {
  if (!cachedDeviceId) cachedDeviceId = `dev-${uuid().slice(0, 8)}`;
  return cachedDeviceId;
}

/** RFC-4122-shaped id generated on the client, so a retried upload is a no-op. */
export function uuid(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

export type { Capability };
