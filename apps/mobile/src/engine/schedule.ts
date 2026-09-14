/**
 * Mettle — spacing and dose.
 *
 * NOT SM-2. Spacing is parameterised by how long the user says they need to hold
 * the material, because that is what the evidence is indexed on.
 *
 * Cepeda, Vul, Rohrer, Wixted & Pashler (2008), Psychological Science, N = 1,354,
 * gaps 0–105 days, retention intervals 7/35/70/350 days:
 *   "if you want to know the optimal distribution of study time, you need to
 *    decide how long you wish to remember something."
 *   Optimal gap ≈ 20% of the retention interval for retention of a few weeks,
 *   falling to ≈ 5% for one-year retention.
 *   https://files.eric.ed.gov/fulltext/ED505660.pdf
 *
 * HONESTY NOTE: the two anchors below (35d → 0.20, 365d → 0.05) are Cepeda's.
 * The log interpolation BETWEEN them is ours, not theirs. Flagged here so nobody
 * later cites Cepeda for a number he did not publish.
 */

const ANCHOR_SHORT = { retentionDays: 35, fraction: 0.20 };
const ANCHOR_LONG = { retentionDays: 365, fraction: 0.05 };

export function optimalGapFraction(retentionDays: number): number {
  if (retentionDays <= ANCHOR_SHORT.retentionDays) return ANCHOR_SHORT.fraction;
  if (retentionDays >= ANCHOR_LONG.retentionDays) return ANCHOR_LONG.fraction;
  const t =
    (Math.log(retentionDays) - Math.log(ANCHOR_SHORT.retentionDays)) /
    (Math.log(ANCHOR_LONG.retentionDays) - Math.log(ANCHOR_SHORT.retentionDays));
  return ANCHOR_SHORT.fraction + t * (ANCHOR_LONG.fraction - ANCHOR_SHORT.fraction);
}

/** Gap in days before the next review, given the user's own retention target. */
export function optimalGapDays(retentionDays: number): number {
  return Math.max(1, Math.round(retentionDays * optimalGapFraction(retentionDays)));
}

export function nextReviewDate(lastReview: Date, retentionDays: number): Date {
  const d = new Date(lastReview);
  d.setDate(d.getDate() + optimalGapDays(retentionDays));
  return d;
}

/* ------------------------------------------------------------------ *
 * Dose — ratified decision 2
 * ------------------------------------------------------------------ */

/**
 * Train runs three days a week; Apply and Prove run daily.
 *
 * Lampit, Hallock & Valenzuela (2014), PLoS Medicine, 52 datasets, 4,885 participants:
 *   once weekly       g = 0.34
 *   2–3× weekly       g = 0.28
 *   more than 3×      g = 0.07, NOT significant
 *   "training more than three times per week is counterproductive"
 *   https://journals.plos.org/plosmedicine/article?id=10.1371%2Fjournal.pmed.1001756
 *
 * Scope caveat carried in code as well as in marketing: that finding is
 * process-based training in cognitively healthy OLDER ADULTS, and our Train step
 * is method-drill. It remains the best dose evidence that exists.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday = 0
export const DEFAULT_TRAIN_DAYS: Weekday[] = [1, 3, 5]; // Mon / Wed / Fri

export type DayKind = 'train' | 'apply-prove';

export function dayKind(date: Date, trainDays: Weekday[] = DEFAULT_TRAIN_DAYS): DayKind {
  return trainDays.includes(date.getDay() as Weekday) ? 'train' : 'apply-prove';
}

/* ------------------------------------------------------------------ *
 * Streak — low threshold, no punishment
 * ------------------------------------------------------------------ */

/**
 * ANY one of the three daily actions extends the streak.
 *
 * Duolingo decoupled the streak from the daily goal so one lesson extends it:
 * +3.3% D14 retention, +19% streak-holding among new users, and users with
 * HIGHER daily goals were LESS likely to hold a streak.
 * https://blog.duolingo.com/improving-the-streak
 *
 * And there is no penalty for a miss. Lally et al. (2010) found missing a single
 * day changed automaticity by less than half a point, with quick recovery; the
 * one large streak RCT (60,000 students) found "no evidence of discouragement
 * when streaks were broken." A product that punishes a miss is contradicting
 * the evidence it cites.
 */
export interface DayActions {
  trained: boolean;
  applied: boolean;
  proved: boolean;
}

export function dayCounts(a: DayActions): boolean {
  return a.trained || a.applied || a.proved;
}

export function streakLength(days: DayActions[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!dayCounts(days[i])) break;
    n++;
  }
  return n;
}
