/**
 * Mettle — cross-session ability estimate.
 *
 * Elo with an uncertainty-decaying K factor, after Pelánek (2016),
 * "Applications of the Elo Rating System in Adaptive Educational Systems",
 * Computers & Education. https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
 *
 * Why Elo and not IRT/CAT — the three blockers, from the Build Bible §05.1:
 *   1. a precision-based CAT needs ~29 items to reach SE < 0.3. That is an entire
 *      round spent on one estimate.
 *   2. IRT needs a pre-calibrated item bank. We generate trials, we don't pick items.
 *   3. IRT "typically assumes that a student's skill is constant" — exactly wrong
 *      for a training app, where changing ability is the whole point.
 *
 * Elo shares the Rasch/1PL functional form and differs only in estimation. With
 * adaptive selection it reaches "nearly the same estimates as joint maximum
 * likelihood", and ~10 answers already give r ≈ 0.8 with ground truth.
 *
 * The architecture: the staircase handles today's state; theta handles the trait
 * and seeds tomorrow's staircase. Both are stored; only theta is used for progress.
 */

/** Published values: a = 1, b = 0.05 (Papoušek et al.; Nižnan et al.). */
export const K_A = 1;
export const K_B = 0.05;

export interface AbilityEstimate {
  /** Latent ability, same scale as item difficulty. Starts at 0. */
  theta: number;
  /** Number of trials contributing. Drives the K decay. */
  n: number;
}

export interface DifficultyEstimate {
  d: number;
  n: number;
}

/**
 * A new user starts at the population prior for the task, NOT at zero.
 *
 * T2 caught this: starting theta at 0 on a 1..30 level scale means a new user
 * begins ~15 units below their true ability, and the decaying K never fully
 * closes that gap. The prior is the mid-scale value until the pilot (§10, T6)
 * gives us the real population mean per task.
 */
export function newAbility(populationPrior = 0): AbilityEstimate {
  return { theta: populationPrior, n: 0 };
}

/** Uncertainty-decaying K: U(n) = a / (1 + b·n). */
export function kFactor(n: number): number {
  return K_A / (1 + K_B * n);
}

/**
 * P(correct) for ability theta against difficulty d.
 * With k alternatives, the floor is the guess rate 1/k.
 */
export function pCorrect(theta: number, d: number, kOptions?: number): number {
  const base = 1 / (1 + Math.exp(-(theta - d)));
  if (!kOptions || kOptions <= 1) return base;
  const g = 1 / kOptions;
  return g + (1 - g) * base;
}

export interface EloUpdate {
  ability: AbilityEstimate;
  difficulty: DifficultyEstimate;
  expected: number;
}

/** One trial's update of both the user's ability and the level's difficulty. */
export function updateElo(
  ability: AbilityEstimate,
  difficulty: DifficultyEstimate,
  correct: boolean,
  kOptions?: number,
): EloUpdate {
  const expected = pCorrect(ability.theta, difficulty.d, kOptions);
  const outcome = correct ? 1 : 0;
  const kU = kFactor(ability.n);
  const kI = kFactor(difficulty.n);
  return {
    ability: { theta: ability.theta + kU * (outcome - expected), n: ability.n + 1 },
    difficulty: { d: difficulty.d + kI * (expected - outcome), n: difficulty.n + 1 },
    expected,
  };
}

/**
 * The difficulty level at which this user should hit `targetP` — i.e. where the
 * next round's staircase starts. Seeding from theta rather than from a fixed
 * start is what lets a 35-trial round spend its budget measuring instead of
 * travelling.
 *
 * Solving pCorrect(theta, d) = targetP for d:
 *   without guessing:  d = theta − ln(p / (1−p))
 *   with k options:    d = theta − ln(q / (1−q)),  q = (p − 1/k) / (1 − 1/k)
 */
/* ------------------------------------------------------------------ *
 * The seeding path — round thresholds, not trial outcomes
 * ------------------------------------------------------------------ *
 *
 * T2 finding, 13 Sep 2026, and it is architectural rather than a bug:
 *
 *   An adaptive staircase holds P(correct) AT THE TARGET regardless of ability.
 *   So (correct − expected) is near zero on almost every trial, whoever is
 *   playing — the per-trial Elo signal is close to noise, and theta crawls.
 *   In the first harness run the seed error plateaued at 2.10 levels and never
 *   improved across twelve rounds.
 *
 *   The round's converged THRESHOLD is the measurement. It is a direct estimate
 *   of ability in level units. Drive the cross-session estimate from that.
 *
 * updateElo below is retained for the one case it is right for — learning the
 * difficulty of hand-authored content where difficulty is genuinely unknown
 * (e.g. Reasoning items). It is NOT on the seeding path and must not be put back
 * on it without re-running T2.
 */

/** Invert seedLevel: the ability implied by a threshold measured at targetP. */
export function abilityFromThreshold(threshold: number, targetP: number, kOptions?: number): number {
  return threshold + (0 - seedLevel(0, targetP, kOptions));
}

/**
 * Gain for the cross-session filter, indexed by ROUNDS not trials.
 *
 * a = 1 so a brand-new user's first round is taken at face value.
 * b = 0.35 is OURS, tuned here, not a published value — it holds the estimate
 * responsive enough for a training app where ability genuinely changes
 * (K ≈ 0.19 by round 12) rather than freezing it as a trait.
 */
export const ROUND_K_A = 1;
export const ROUND_K_B = 0.35;

export function roundGain(rounds: number): number {
  return ROUND_K_A / (1 + ROUND_K_B * rounds);
}

/** Exponentially-weighted update of ability from one round's threshold. */
export function updateAbilityFromThreshold(
  ability: AbilityEstimate,
  threshold: number,
  targetP: number,
  kOptions?: number,
): AbilityEstimate {
  const observed = abilityFromThreshold(threshold, targetP, kOptions);
  const k = roundGain(ability.n);
  return { theta: ability.theta + k * (observed - ability.theta), n: ability.n + 1 };
}

export function seedLevel(theta: number, targetP: number, kOptions?: number): number {
  let q = targetP;
  if (kOptions && kOptions > 1) {
    const g = 1 / kOptions;
    if (targetP <= g) {
      throw new RangeError(`targetP ${targetP} is at or below the guess rate ${g}; unreachable`);
    }
    q = (targetP - g) / (1 - g);
  }
  if (q <= 0 || q >= 1) throw new RangeError(`derived target ${q} out of range`);
  return theta - Math.log(q / (1 - q));
}
