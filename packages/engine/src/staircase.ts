/**
 * Mettle — within-round adaptive engine.
 *
 * Weighted up-down staircase (Kaernbach 1991, Perception & Psychophysics 49(3)).
 * https://link.springer.com/content/pdf/10.3758/BF03214307.pdf
 *
 * Chosen over transformed up-down (Levitt), PEST, QUEST/ZEST and psi because a
 * 60–90s round affords only 30–45 trials. See Build Bible §05.1 for the rejection
 * table. Two properties decide it:
 *   1. it updates on EVERY trial (no waiting for 2–3 correct runs);
 *   2. it is stable across mis-specified step sizes — and we cannot tune step size
 *      per user.
 *
 * CONVENTION, fixed here and nowhere else: `level` is DIFFICULTY. Higher = harder.
 * A correct answer moves the level UP (harder) by `stepHarder`.
 * An error moves it DOWN (easier) by `stepEasier`.
 *
 * Equilibrium (expected upward movement = expected downward movement):
 *     stepHarder · p  =  stepEasier · (1 − p)
 *     stepEasier / stepHarder = p / (1 − p)
 *
 *     target 70.7% → 1 : 2.41
 *     target 75.0% → 1 : 3
 *     target 80.0% → 1 : 4
 *
 * We target 75–80%. That is not only an engagement setting — reliability rises
 * with difficulty (Journal of Vision 2022: UFOV ICCs increase with eccentricity
 * even as accuracy falls; VWM reliability .50/.57/.65/.76 at set sizes 3/4/5/6).
 * Softening the target to lift retention would degrade the measurement. Don't.
 *
 * Hard-code the TARGET PERCENTAGE, never a rule name: the literature uses both
 * "1-up-2-down" and "2-down-1-up" for the same 70.7% rule.
 */

export type Granularity = 'continuous' | 'integer';

/**
 * How the round's threshold is estimated from the trial sequence.
 *
 * 'reversal-mean' is the textbook choice and is correct for the TRANSFORMED
 * up-down rule. It is NOT unbiased here: with asymmetric steps (1 : 3 at a 75%
 * target) the excursions above and below the target are asymmetric, so averaging
 * reversal points under-estimates the threshold. T2 measured this directly —
 * bias ≈ −0.47 × stepHarder, and near zero only at the symmetric-ish 70.7% target.
 *
 * 'level-mean-from-first-reversal' averages the levels actually presented from the
 * first reversal onward. Kaernbach's equilibrium condition says net drift is zero
 * at the target level, so the time-average of the level sits on the target. The
 * first reversal marks the end of the approach phase, so the burn-in adapts to
 * however wrong the seed was instead of being a fixed guess.
 */
export type ThresholdEstimator = 'reversal-mean' | 'level-mean-from-first-reversal' | 'level-mean-tail';

export interface StaircaseConfig {
  /** Target proportion correct the staircase converges on. 0.70–0.85. */
  targetP: number;
  /** Step taken toward HARDER after a correct response, in level units. */
  stepHarder: number;
  /** Lowest (easiest) level this task supports. */
  minLevel: number;
  /** Highest (hardest) level this task supports. */
  maxLevel: number;
  /** Level scale shape. Integer for set-size/n-level tasks; continuous for durations. */
  granularity: Granularity;
  /**
   * Reversals to discard before averaging. Leek (2001) runs to 12 reversals and
   * averages the last 6; at ~35 trials we see ~8–16 and discard the first 2.
   * Only used by the 'reversal-mean' estimator.
   */
  discardReversals: number;
  /** See ThresholdEstimator. Default chosen on T2 evidence, not on convention. */
  estimator: ThresholdEstimator;
  /**
   * Coarse-then-fine. T2 measured a systematic negative bias of roughly
   * −0.5 × stepHarder: with small frequent upward steps and large rare downward
   * ones, the walk's stationary distribution is left-skewed, so its MEAN sits
   * below the zero-drift point even though the drift condition holds exactly.
   *
   * Shrinking the step fixes the bias but slows travel — at step 0.25 with an
   * 8-level seed error only 59% of rounds converged by trial 30. So: travel
   * coarse, measure fine. The first `coarseTrials` use stepHarder ×
   * `coarseStepMultiplier` and are EXCLUDED from the estimate.
   */
  coarseTrials: number;
  coarseStepMultiplier: number;
}

export const DEFAULT_STAIRCASE: StaircaseConfig = {
  targetP: 0.75,
  stepHarder: 0.2,
  minLevel: 1,
  maxLevel: 30,
  granularity: 'continuous',
  discardReversals: 2,
  estimator: 'level-mean-from-first-reversal',
  coarseTrials: 0,    // see coarseTrialsFor(): only a cold-start round pays for travel
  coarseStepMultiplier: 5,
};

/** stepEasier implied by the target, per Kaernbach's equilibrium condition. */
export function stepEasierFor(targetP: number, stepHarder: number): number {
  if (targetP <= 0 || targetP >= 1) throw new RangeError(`targetP must be in (0,1), got ${targetP}`);
  return stepHarder * (targetP / (1 - targetP));
}

export interface TrialRecord {
  index: number;
  level: number;
  correct: boolean;
  /** +1 = moved harder, -1 = moved easier, 0 = clamped, no movement. */
  direction: 1 | -1 | 0;
  isReversal: boolean;
  phase: 'coarse' | 'fine';
}

export interface StaircaseResult {
  /** Threshold estimate in LEVEL units. This — not a latency — is what we store. */
  threshold: number;
  /** How the threshold was actually derived, including any fallback. */
  method: ThresholdEstimator | 'tail-mean-fallback';
  reversalLevels: number[];
  trials: TrialRecord[];
  /** Trials spent pinned at minLevel / maxLevel. High counts mean the seed was wrong. */
  floorTrials: number;
  ceilingTrials: number;
  proportionCorrect: number;
  /**
   * True when the user spent most of the measuring phase pinned at a boundary —
   * their true threshold is outside the scale this task can express. The
   * measurement layer must REFUSE an off-scale threshold rather than report the
   * boundary as if it were an estimate. Flagging beats fabricating.
   */
  offScale: boolean;
}

/**
 * A staircase you drive trial by trial. The renderer owns presentation and timing;
 * this object owns nothing but the number.
 */
export class Staircase {
  readonly config: StaircaseConfig;
  readonly stepEasier: number;
  private level: number;
  private lastDirection: 1 | -1 | null = null;
  private readonly trials: TrialRecord[] = [];
  private readonly reversalLevels: number[] = [];
  private floorTrials = 0;
  private ceilingTrials = 0;
  private correctCount = 0;

  constructor(startLevel: number, config: Partial<StaircaseConfig> = {}) {
    this.config = { ...DEFAULT_STAIRCASE, ...config };
    if (this.config.minLevel >= this.config.maxLevel) {
      throw new RangeError('minLevel must be below maxLevel');
    }
    this.stepEasier = stepEasierFor(this.config.targetP, this.config.stepHarder);
    this.level = this.quantise(this.clamp(startLevel));
  }

  /** The level to present on the next trial. */
  get currentLevel(): number {
    return this.level;
  }

  get trialCount(): number {
    return this.trials.length;
  }

  /** Record the outcome of a trial presented at `currentLevel`. */
  record(correct: boolean): void {
    const presentedAt = this.level;
    if (correct) this.correctCount++;
    if (presentedAt <= this.config.minLevel) this.floorTrials++;
    if (presentedAt >= this.config.maxLevel) this.ceilingTrials++;

    const coarse = this.trials.length < this.config.coarseTrials;
    const m = coarse ? this.config.coarseStepMultiplier : 1;
    const raw = correct
      ? presentedAt + this.config.stepHarder * m
      : presentedAt - this.stepEasier * m;
    const next = this.quantise(this.clamp(raw));

    let direction: 1 | -1 | 0 = 0;
    if (next > presentedAt) direction = 1;
    else if (next < presentedAt) direction = -1;

    // A clamped trial produces no movement, so it cannot be a reversal —
    // otherwise a user pinned at the ceiling manufactures phantom reversals
    // and the threshold estimate collapses onto the ceiling.
    let isReversal = false;
    if (direction !== 0) {
      if (this.lastDirection !== null && direction !== this.lastDirection) {
        isReversal = true;
        this.reversalLevels.push(presentedAt);
      }
      this.lastDirection = direction;
    }

    this.trials.push({
      index: this.trials.length,
      level: presentedAt,
      correct,
      direction,
      isReversal,
      phase: coarse ? 'coarse' : 'fine',
    });
    this.level = next;
  }

  result(): StaircaseResult {
    const { threshold, method } = this.estimate();
    return {
      threshold,
      method,
      reversalLevels: [...this.reversalLevels],
      trials: [...this.trials],
      floorTrials: this.floorTrials,
      ceilingTrials: this.ceilingTrials,
      proportionCorrect: this.trials.length ? this.correctCount / this.trials.length : 0,
      offScale: this.isOffScale(),
    };
  }

  /**
   * The estimator. Public so the simulation harness can compare candidates on the
   * same trial sequences rather than on separate runs — otherwise the comparison
   * is confounded by sampling noise.
   */
  estimate(which: ThresholdEstimator = this.config.estimator): {
    threshold: number;
    method: ThresholdEstimator | 'tail-mean-fallback';
  } {
    // Only the fine phase is measured. The coarse phase exists to travel.
    const fine = this.trials.filter((t) => t.phase === 'fine');
    const measured = fine.length >= 8 ? fine : this.trials;
    const levels = measured.map((t) => t.level);
    if (!levels.length) return { threshold: this.level, method: 'tail-mean-fallback' };

    if (which === 'reversal-mean') {
      const usable = measured.filter((t) => t.isReversal).map((t) => t.level).slice(this.config.discardReversals);
      if (usable.length >= 3) return { threshold: mean(usable), method: 'reversal-mean' };
      return { threshold: this.tailMean(levels), method: 'tail-mean-fallback' };
    }

    if (which === 'level-mean-from-first-reversal') {
      const firstReversal = measured.findIndex((t) => t.isReversal);
      // Need a meaningful post-approach sample; otherwise fall back rather than
      // average a sequence that is still travelling toward the threshold.
      if (firstReversal >= 0 && levels.length - firstReversal >= 8) {
        return { threshold: mean(levels.slice(firstReversal)), method: 'level-mean-from-first-reversal' };
      }
      return { threshold: this.tailMean(levels), method: 'tail-mean-fallback' };
    }

    return { threshold: this.tailMean(levels), method: 'level-mean-tail' };
  }

  /**
   * Pinned at a boundary for a substantial part of the measuring phase ⇒ the scale
   * cannot express this user's threshold, and any number we produced would be
   * compressed toward the boundary rather than estimated.
   *
   * The 0.3 threshold deliberately matches the harness's definition of a locked
   * run, so that every locked run is refused. An earlier 0.5 let ~1 run in 10,000
   * through as a silent boundary estimate. Be conservative about refusing.
   */
  private isOffScale(): boolean {
    const fine = this.trials.filter((t) => t.phase === 'fine');
    const m = fine.length ? fine : this.trials;
    if (!m.length) return false;
    const pinned = m.filter(
      (t) => t.level <= this.config.minLevel || t.level >= this.config.maxLevel,
    ).length;
    return pinned / m.length > 0.3;
  }

  private tailMean(levels: number[]): number {
    const tail = levels.slice(Math.floor(levels.length / 3));
    return tail.length ? mean(tail) : this.level;
  }

  private clamp(v: number): number {
    return Math.min(this.config.maxLevel, Math.max(this.config.minLevel, v));
  }

  private quantise(v: number): number {
    return this.config.granularity === 'integer' ? Math.round(v) : v;
  }
}

export function mean(xs: number[]): number {
  if (!xs.length) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Coarse-phase length as a function of how well we already know this user.
 *
 * T2 rev 2 finding: a coarse phase costs variance (it hands the fine phase a
 * noisy starting point that 23 trials cannot wash out). It is only worth paying
 * when the seed is genuinely uncertain — which, once the cross-session estimate
 * is working, is only the first round or two.
 *
 * And the rounds that DO need it are exactly the rounds the measurement layer
 * throws away anyway: session 1 is discarded for practice effects (Bartels 2010).
 * The noisiest estimate and the discarded estimate are the same estimate.
 */
export function coarseTrialsFor(roundsPlayed: number): number {
  if (roundsPlayed === 0) return 12;
  if (roundsPlayed < 3) return 6;
  return 0;
}
