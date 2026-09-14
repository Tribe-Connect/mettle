/**
 * Mettle — the honesty layer.
 *
 * This module is the product. Everything else is a game engine; this is the part
 * that decides whether we are allowed to tell a user something changed.
 *
 * Ratified rule (Build Bible decision 3, 13 Sep 2026):
 *   any task whose measured test–retest ICC falls below 0.70 gets NO progress
 *   number. It survives as a drill. It never produces a claim.
 *
 * Sources:
 *   Hedge, Powell & Sumner (2018) "The reliability paradox", Behav Res Methods.
 *     https://link.springer.com/article/10.3758/s13428-017-0935-1
 *   Jacobson & Truax (1991) Reliable Change Index.
 *   Minimal Detectable Change. https://casrai.org/guides/minimal-detectable-change
 *   Bartels et al. (2010) practice effects, BMC Neuroscience 11:118.
 *     https://link.springer.com/article/10.1186/1471-2202-11-118
 */

import { mean, sd } from './staircase.ts';

export const RELIABILITY_GATE = 0.70;

/** Two-sided z for the usual confidence levels. Always subscript the level in the UI. */
export const Z = { 90: 1.645, 95: 1.96, 99: 2.576 } as const;
export type Confidence = keyof typeof Z;

/* ------------------------------------------------------------------ *
 * Error of measurement
 * ------------------------------------------------------------------ */

/**
 * SEM from raw test–retest differences: SEM = SD_diff / √2.
 *
 * Preferred over SD·√(1−r) because it makes no assumption about how
 * heterogeneous our user base is — and we will have the raw retest data.
 */
export function semFromDifferences(differences: number[]): number {
  return sd(differences) / Math.SQRT2;
}

/** SEM from a between-person SD and a reliability coefficient. */
export function semFromReliability(betweenPersonSD: number, reliability: number): number {
  return betweenPersonSD * Math.sqrt(1 - reliability);
}

/** MDC = z · √2 · SEM. MDC₉₅ ≈ 2.77 · SEM. */
export function mdc(sem: number, confidence: Confidence = 95): number {
  return Z[confidence] * Math.SQRT2 * sem;
}

/**
 * MDC expressed in between-person SD units: 2.77 · √(1−r) at 95%.
 * This is the table to keep on the wall:
 *   r = .90 → 0.88 SD (50th → 81st percentile)
 *   r = .70 → 1.52 SD (50th → 94th)
 *   r = .40 → 2.15 SD (50th → 98th)
 */
export function mdcInSDUnits(reliability: number, confidence: Confidence = 95): number {
  return Z[confidence] * Math.SQRT2 * Math.sqrt(1 - reliability);
}

/**
 * The lever we actually have: averaging k sessions per timepoint divides the
 * SEM of the mean by √k. At r = .90, four sessions halve the requirement from
 * 0.88 SD to 0.44 SD — a change real training could plausibly produce.
 */
export function mdcForMeanOfK(sem: number, k: number, confidence: Confidence = 95): number {
  if (k < 1) throw new RangeError('k must be at least 1');
  return mdc(sem, confidence) / Math.sqrt(k);
}

/** Reliable Change Index (Jacobson & Truax). |RCI| > 1.96 ⇒ reliable change at 95%. */
export function rci(pre: number, post: number, betweenPersonSD: number, reliability: number): number {
  const sDiff = betweenPersonSD * Math.SQRT2 * Math.sqrt(1 - reliability);
  return (post - pre) / sDiff;
}

/* ------------------------------------------------------------------ *
 * Reliability
 * ------------------------------------------------------------------ */

/**
 * ICC(2,1), absolute agreement, single measurement — two-way random effects.
 * This is the coefficient the pilot (Build Bible §10, T6) reports per task and
 * the coefficient the 0.70 gate is applied to.
 *
 * pairs: [session A, session B] for each participant, same task, ~3-week retest.
 */
export function icc21(pairs: Array<[number, number]>): number {
  const n = pairs.length;
  if (n < 3) return Number.NaN;
  const k = 2;

  const grand = mean(pairs.flatMap(([a, b]) => [a, b]));
  const rowMeans = pairs.map(([a, b]) => (a + b) / 2);
  const colMeans = [mean(pairs.map((p) => p[0])), mean(pairs.map((p) => p[1]))];

  let ssRows = 0;
  for (const rm of rowMeans) ssRows += (rm - grand) ** 2;
  ssRows *= k;

  let ssCols = 0;
  for (const cm of colMeans) ssCols += (cm - grand) ** 2;
  ssCols *= n;

  let ssTotal = 0;
  for (const [a, b] of pairs) ssTotal += (a - grand) ** 2 + (b - grand) ** 2;

  const ssError = ssTotal - ssRows - ssCols;
  const msRows = ssRows / (n - 1);
  const msCols = ssCols / (k - 1);
  const msError = ssError / ((n - 1) * (k - 1));

  const denom = msRows + (k - 1) * msError + (k * (msCols - msError)) / n;
  if (denom === 0) return Number.NaN;
  return (msRows - msError) / denom;
}

/* ------------------------------------------------------------------ *
 * Baselines — the practice-effect rule
 * ------------------------------------------------------------------ */

export interface Session {
  /** Threshold in level units — never a latency. See Build Bible §05.2 rule 1. */
  threshold: number;
  at: Date;
  /** Stable device fingerprint. Cross-device comparisons are refused, not corrected. */
  deviceId: string;
  /** 1-indexed attempt number for this task, used to model the practice curve. */
  attempt: number;
  /**
   * Set by the staircase when the user was pinned at a scale boundary. An
   * off-scale round is refused, never averaged in — the boundary is not an
   * estimate, and including it drags the mean toward the edge of the scale.
   */
  offScale?: boolean;
}

export const MIN_SESSIONS_PER_TIMEPOINT = 4;

/**
 * Baseline = mean of sessions 2..(1+k). Session 1 is DISCARDED, not averaged in.
 *
 * Bartels et al. (2010): improvement from baseline to the second testing accounts
 * for the largest proportion of change in every cognitive domain (d = 0.30–0.55),
 * and performance plateaus after month 3. An app that reports the session-1 →
 * session-2 delta as improvement is reporting a pure practice effect. The authors
 * recommend a dual baseline; this is it.
 */
export function baselineFrom(sessions: Session[], k = MIN_SESSIONS_PER_TIMEPOINT): number | null {
  const ordered = [...sessions].sort((a, b) => a.attempt - b.attempt);
  const afterFirst = ordered.filter((s) => s.attempt > 1);
  if (afterFirst.length < k) return null;
  return mean(afterFirst.slice(0, k).map((s) => s.threshold));
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

export type Verdict =
  | 'off-scale'
  | 'improved'
  | 'declined'
  | 'no-detectable-change'
  | 'insufficient-data'
  | 'device-changed'
  | 'not-reportable';

export interface ChangeInput {
  baseline: Session[];
  recent: Session[];
  /** Measured in OUR pilot, per task. Not a literature value. */
  taskReliability: number;
  /** SD of test–retest differences from OUR cohort. Not a literature value. */
  cohortSDdiff: number;
  confidence?: Confidence;
  minSessions?: number;
}

export interface ChangeReport {
  verdict: Verdict;
  /** Observed change in level units, or null when no claim is permitted. */
  delta: number | null;
  /** The bar the change had to clear. */
  threshold: number | null;
  /** Plain-English line shown to the user. Never a bare number. */
  copy: string;
}

/**
 * The only function in the codebase permitted to produce change language.
 *
 * Order of checks matters and is deliberate:
 *   1. reliability gate (ratified decision 3)
 *   2. device continuity — an Android switch alone imposes β = 0.56 SD on simple
 *      RT, enough to manufacture most of a "reliable change" (BRM 2021)
 *   3. sufficiency — ≥4 sessions per timepoint, session 1 excluded
 *   4. MDC
 *
 * Note "no detectable change" is not "no change", and the copy says so. Creyos
 * makes the same distinction and it is the difference between honesty and
 * a false negative dressed as a finding.
 */
export function assessChange(input: ChangeInput): ChangeReport {
  const conf = input.confidence ?? 95;
  const k = input.minSessions ?? MIN_SESSIONS_PER_TIMEPOINT;

  if (!(input.taskReliability >= RELIABILITY_GATE)) {
    return {
      verdict: 'not-reportable',
      delta: null,
      threshold: null,
      copy:
        "We train this one but we don't score it. Our own testing puts this task's " +
        `reliability at ${input.taskReliability.toFixed(2)}, below the 0.70 bar we set ` +
        'ourselves. A number here would move more on noise than on you.',
    };
  }

  const usableBaseline = input.baseline.filter((s) => !s.offScale);
  const usableRecent = input.recent.filter((s) => !s.offScale);
  const refused =
    input.baseline.length + input.recent.length - usableBaseline.length - usableRecent.length;
  if (refused > 0 && usableBaseline.length + usableRecent.length < 2 * k) {
    return {
      verdict: 'off-scale',
      delta: null,
      threshold: null,
      copy:
        `${refused} of your sessions ran off the end of this task's difficulty scale, ` +
        'so we have set them aside rather than score the edge of the scale as if it were you.',
    };
  }

  const devices = new Set([...usableBaseline, ...usableRecent].map((s) => s.deviceId));
  if (devices.size > 1) {
    return {
      verdict: 'device-changed',
      delta: null,
      threshold: null,
      copy:
        'These sessions span more than one device, so we will not compare them. ' +
        'Touchscreen timing differs enough between handsets to fake a real change.',
    };
  }

  const base = baselineFrom(usableBaseline, k);
  const recentUsable = [...usableRecent].sort((a, b) => b.attempt - a.attempt).slice(0, k);
  if (base === null || recentUsable.length < k) {
    return {
      verdict: 'insufficient-data',
      delta: null,
      threshold: null,
      copy: `Not enough yet — we need ${k} sessions at each end before we'll call anything a change.`,
    };
  }

  const now = mean(recentUsable.map((s) => s.threshold));
  const delta = now - base;
  const sem = input.cohortSDdiff / Math.SQRT2;
  const bar = mdcForMeanOfK(sem, k, conf);

  if (Math.abs(delta) < bar) {
    return {
      verdict: 'no-detectable-change',
      delta,
      threshold: bar,
      copy:
        'No change we can detect yet. That is not the same as no change — it means ' +
        'any movement is still inside our measurement error.',
    };
  }

  return {
    verdict: delta > 0 ? 'improved' : 'declined',
    delta,
    threshold: bar,
    copy:
      delta > 0
        ? `Real movement: ${delta.toFixed(1)} levels, past the ${bar.toFixed(1)} we require before calling it.`
        : `Down ${Math.abs(delta).toFixed(1)} levels, past the ${bar.toFixed(1)} we require before calling it. Worth checking sleep.`,
  };
}

/* ------------------------------------------------------------------ *
 * Reporting — bands, never points
 * ------------------------------------------------------------------ */

export interface Band {
  lower: number;
  point: number;
  upper: number;
}

/**
 * Every score the user sees is an interval whose width comes from that task's
 * measured SEM. A user should never see a bare number, and we never ship a
 * composite across tasks — that is the affordance that makes "brain age" possible.
 */
export function scoreBand(point: number, sem: number, confidence: Confidence = 95): Band {
  const half = Z[confidence] * sem;
  return { lower: point - half, point, upper: point + half };
}
