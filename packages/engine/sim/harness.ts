/**
 * Mettle — T2, the adaptive-engine simulation harness.
 *
 * Build Bible §10: "10,000 synthetic users with known true thresholds driven
 * through the staircase; sweep step size, starting level and lapse rate."
 *
 * Exit criteria, which this run must be able to FAIL:
 *   recovered-threshold bias   < 0.1 level units
 *   converged by trial 30      ≥ 95%
 *   oscillation lock           0
 *   floor / ceiling traps      0
 *
 * Synthetic observer (logistic psychometric function with guess floor and lapse):
 *   P(correct | d) = γ + (1 − γ − λ) · σ(β · (A − d))
 * True threshold d* is the level where P(correct) = targetP.
 */

import { Staircase, mean, sd } from '../src/staircase.ts';
import type { StaircaseConfig, ThresholdEstimator } from '../src/staircase.ts';
import { newAbility, updateAbilityFromThreshold, seedLevel } from '../src/elo.ts';
import type { AbilityEstimate } from '../src/elo.ts';

/* ---------- deterministic RNG so results are reproducible in CI ---------- */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mu: number, sigma: number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface Observer {
  ability: number;
  slope: number;
  guess: number;
  lapse: number;
}

const pCorrectObserver = (o: Observer, level: number) =>
  o.guess + (1 - o.guess - o.lapse) * sigmoid(o.slope * (o.ability - level));

function trueThreshold(o: Observer, targetP: number): number {
  const q = (targetP - o.guess) / (1 - o.guess - o.lapse);
  return o.ability - Math.log(q / (1 - q)) / o.slope;
}

const K_OPTIONS = 4;
const TRIALS = 35;

/* ---------- shipping configurations ---------- */

/**
 * The continuous config is the default, and that is itself a T2 finding:
 * a task with only an integer difficulty dimension (list length, n-level) forces
 * stepHarder ≥ 1 and loses precision. Every Mettle task therefore gets a
 * continuous secondary dimension — presentation rate, ISI, eccentricity, duration —
 * so the staircase can move in fractions of a level.
 */
const SHIPPING: StaircaseConfig = {
  targetP: 0.75,
  stepHarder: 0.2,
  minLevel: 1,
  maxLevel: 30,
  granularity: 'continuous',
  discardReversals: 2,
  estimator: 'level-mean-from-first-reversal',
  coarseTrials: 0,          // steady state: the Elo seed is accurate, no travel needed
  coarseStepMultiplier: 5,
};

/** Round 1 of a brand-new user: no prior at all, so pay for the coarse phase. */
const COLD_START: StaircaseConfig = { ...SHIPPING, coarseTrials: 12 };

const INTEGER_ONLY: StaircaseConfig = {
  ...SHIPPING, stepHarder: 1, granularity: 'integer', coarseTrials: 8, coarseStepMultiplier: 3,
};

const ABILITY_MU = 15;
const ABILITY_SD = 4;
const SLOPE = 1.0;

/* ---------- one round ---------- */

interface RunOutcome {
  errorByEstimator: Record<ThresholdEstimator, number>;
  converged30: boolean;
  reversals: number;
  fellBack: boolean;
  locked: boolean;
  offScale: boolean;
  proportionCorrect: number;
  threshold: number;
}

const ESTIMATORS: ThresholdEstimator[] = [
  'reversal-mean',
  'level-mean-from-first-reversal',
  'level-mean-tail',
];

function runRound(
  o: Observer,
  cfg: StaircaseConfig,
  startLevel: number,
  nTrials: number,
  rng: () => number,
  tolerance = 1.0,
): RunOutcome {
  const dStar = trueThreshold(o, cfg.targetP);
  const sc = new Staircase(startLevel, cfg);
  let convergedAt: number | null = null;

  for (let t = 0; t < nTrials; t++) {
    sc.record(rng() < pCorrectObserver(o, sc.currentLevel));
    if (convergedAt === null && t >= 9) {
      const partial = sc.estimate();
      if (partial.method === cfg.estimator && Math.abs(partial.threshold - dStar) <= tolerance) {
        convergedAt = t + 1;
      }
    }
  }

  const r = sc.result();
  const errorByEstimator = {} as Record<ThresholdEstimator, number>;
  for (const e of ESTIMATORS) errorByEstimator[e] = sc.estimate(e).threshold - dStar;

  return {
    errorByEstimator,
    converged30: convergedAt !== null && convergedAt <= 30,
    reversals: r.reversalLevels.length,
    fellBack: r.method === 'tail-mean-fallback',
    locked: r.floorTrials > nTrials * 0.3 || r.ceilingTrials > nTrials * 0.3,
    offScale: r.offScale,
    proportionCorrect: r.proportionCorrect,
    threshold: r.threshold,
  };
}

/* ---------- a swept cell ---------- */

interface CellSpec {
  label: string;
  n: number;
  cfg: StaircaseConfig;
  lapse: number;
  seedOffset: number;
  rngSeed: number;
  nTrials?: number;
  slope?: number;
}

interface CellResult {
  label: string;
  bias: number;
  sdError: number;
  rmse: number;
  converged30: number;
  meanReversals: number;
  fallbackRate: number;
  offScaleRate: number;
  silentLock: number;
  meanPC: number;
  byEstimator: Record<ThresholdEstimator, { bias: number; rmse: number }>;
}

function runCell(spec: CellSpec): CellResult {
  const rng = mulberry32(spec.rngSeed);
  const nTrials = spec.nTrials ?? TRIALS;
  const errs: Record<ThresholdEstimator, number[]> = {
    'reversal-mean': [],
    'level-mean-from-first-reversal': [],
    'level-mean-tail': [],
  };
  let conv = 0, rev = 0, fb = 0, off = 0, silent = 0, pc = 0;

  for (let i = 0; i < spec.n; i++) {
    const o: Observer = {
      ability: gaussian(rng, ABILITY_MU, ABILITY_SD),
      slope: spec.slope ?? SLOPE,
      guess: 1 / K_OPTIONS,
      lapse: spec.lapse,
    };
    const start = trueThreshold(o, spec.cfg.targetP) + spec.seedOffset;
    const out = runRound(o, spec.cfg, start, nTrials, rng);
    for (const e of ESTIMATORS) errs[e].push(out.errorByEstimator[e]);
    if (out.converged30) conv++;
    rev += out.reversals;
    if (out.fellBack) fb++;
    if (out.offScale) off++;
    if (out.locked && !out.offScale) silent++;   // the real failure: pinned but reported as a number
    pc += out.proportionCorrect;
  }

  const primary = errs[spec.cfg.estimator];
  const byEstimator = {} as Record<ThresholdEstimator, { bias: number; rmse: number }>;
  for (const e of ESTIMATORS) {
    byEstimator[e] = { bias: mean(errs[e]), rmse: Math.sqrt(mean(errs[e].map((x) => x * x))) };
  }

  return {
    label: spec.label,
    bias: mean(primary),
    sdError: sd(primary),
    rmse: Math.sqrt(mean(primary.map((x) => x * x))),
    converged30: conv / spec.n,
    meanReversals: rev / spec.n,
    fallbackRate: fb / spec.n,
    offScaleRate: off / spec.n,
    silentLock: silent / spec.n,
    meanPC: pc / spec.n,
    byEstimator,
  };
}

/* ---------- the seeding arc, now driven by round thresholds ---------- */

function runSeedingArc(o: Observer, cfg: StaircaseConfig, rounds: number, rng: () => number): number[] {
  let ability: AbilityEstimate = newAbility((cfg.minLevel + cfg.maxLevel) / 2);
  const dStar = trueThreshold(o, cfg.targetP);
  const seedErrors: number[] = [];
  let start = seedLevel(ability.theta, cfg.targetP, K_OPTIONS);

  for (let r = 0; r < rounds; r++) {
    start = Math.min(cfg.maxLevel, Math.max(cfg.minLevel, start));
    seedErrors.push(start - dStar);
    const sc = new Staircase(start, cfg);
    for (let t = 0; t < TRIALS; t++) sc.record(rng() < pCorrectObserver(o, sc.currentLevel));
    ability = updateAbilityFromThreshold(ability, sc.result().threshold, cfg.targetP, K_OPTIONS);
    start = seedLevel(ability.theta, cfg.targetP, K_OPTIONS);
  }
  return seedErrors;
}

/* ---------- report ---------- */

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const f = (x: number, n = 3) => (x >= 0 ? ' ' : '') + x.toFixed(n);

const HEADER = [
  'cell'.padEnd(32), 'bias'.padStart(8), 'sd'.padStart(6), 'rmse'.padStart(6),
  'conv≤30'.padStart(9), 'revs'.padStart(6), 'fallbk'.padStart(7),
  'offscl'.padStart(7), 'silent'.padStart(7), '%corr'.padStart(7),
].join(' ');

const row = (r: CellResult) => [
  r.label.padEnd(32), f(r.bias).padStart(8), r.sdError.toFixed(2).padStart(6),
  r.rmse.toFixed(2).padStart(6), pct(r.converged30).padStart(9),
  r.meanReversals.toFixed(1).padStart(6), pct(r.fallbackRate).padStart(7),
  pct(r.offScaleRate).padStart(7), pct(r.silentLock).padStart(7), pct(r.meanPC).padStart(7),
].join(' ');

console.log('\nMETTLE — T2 ADAPTIVE ENGINE SIMULATION  (rev 2, after first-run failures)');
console.log('Kaernbach weighted up-down · 35 trials/round · 4AFC · deterministic RNG');
console.log('='.repeat(108));

/* --- estimator bake-off, on IDENTICAL trial sequences --- */
console.log('\nA. ESTIMATOR BAKE-OFF — same runs, three estimators. This is why the default changed.\n');
{
  const cell = runCell({ label: 'bake-off', n: 10000, cfg: SHIPPING, lapse: 0.02, seedOffset: 0, rngSeed: 20260913 });
  console.log('  estimator'.padEnd(40) + 'bias'.padStart(9) + 'rmse'.padStart(9));
  console.log('  ' + '-'.repeat(56));
  for (const e of ESTIMATORS) {
    const v = cell.byEstimator[e];
    const flag = e === SHIPPING.estimator ? '  ← default' : '';
    console.log('  ' + e.padEnd(38) + f(v.bias).padStart(9) + v.rmse.toFixed(2).padStart(9) + flag);
  }
}

/* --- headline --- */
console.log('\nB. SHIPPING CONFIG — 10,000 users, continuous 1..30, fine step 0.2, target 75%, warm seed\n');
console.log(HEADER);
console.log('-'.repeat(108));
const headline = runCell({ label: '10,000 users, lapse 2%', n: 10000, cfg: SHIPPING, lapse: 0.02, seedOffset: 0, rngSeed: 20260913 });
console.log(row(headline));

console.log('\n   …and the same population on an INTEGER-ONLY difficulty scale (step forced to 1):\n');
console.log(row(runCell({ label: 'integer-only scale', n: 10000, cfg: INTEGER_ONLY, lapse: 0.02, seedOffset: 0, rngSeed: 20260913 })));

/* --- sweeps --- */
console.log('\nB2. COLD START — round 1, no prior, seed 8 levels out. Coarse phase on.\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const off of [-8, 0, 8]) {
  console.log(row(runCell({ label: `cold start, seed ${off >= 0 ? '+' : ''}${off}`, n: 3000, cfg: COLD_START, lapse: 0.02, seedOffset: off, rngSeed: 700 + off })));
}
console.log('   (session 1 is discarded by the measurement layer anyway — Bartels practice effect)');

console.log('\nC. SEED-OFFSET SWEEP — warm seed, how much does a wrong starting level cost?\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const off of [-2, -1, 0, 1, 2]) {
  console.log(row(runCell({ label: `seed offset ${off >= 0 ? '+' : ''}${off}`, n: 2000, cfg: SHIPPING, lapse: 0.02, seedOffset: off, rngSeed: 1000 + off })));
}

console.log('\nD. LAPSE-RATE SWEEP — the user who taps through\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const lapse of [0, 0.02, 0.05, 0.1]) {
  console.log(row(runCell({ label: `lapse ${pct(lapse)}`, n: 2000, cfg: SHIPPING, lapse, seedOffset: 0, rngSeed: 2000 + Math.round(lapse * 1000) })));
}

console.log('\nE. STEP-SIZE SWEEP — fine-phase step. Bias scales with it; that is the mechanism, not noise\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const step of [0.1, 0.15, 0.2, 0.3, 0.5]) {
  console.log(row(runCell({ label: `stepHarder ${step}`, n: 2000, cfg: { ...SHIPPING, stepHarder: step }, lapse: 0.02, seedOffset: 0, rngSeed: 3000 + Math.round(step * 100) })));
}

console.log('\nF. TARGET SWEEP — 70.7% vs 75% vs 80%\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const targetP of [0.707, 0.75, 0.8]) {
  console.log(row(runCell({ label: `target ${pct(targetP)}`, n: 2000, cfg: { ...SHIPPING, targetP }, lapse: 0.02, seedOffset: 0, rngSeed: 4000 + Math.round(targetP * 1000) })));
}

console.log('\nG. ROUND-LENGTH SWEEP — what does a shorter or longer round buy?\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const n of [20, 30, 35, 45, 60]) {
  console.log(row(runCell({ label: `${n} trials/round`, n: 2000, cfg: SHIPPING, lapse: 0.02, seedOffset: 0, rngSeed: 5000 + n, nTrials: n })));
}

console.log('\nG2. SLOPE SWEEP — does the residual bias move with the USER\'s psychometric slope?');
console.log('    (it must not: a slope that sharpens with practice would fake a change)\n');
console.log(HEADER);
console.log('-'.repeat(108));
for (const slope of [0.5, 0.75, 1.0, 1.5, 2.0]) {
  console.log(row(runCell({ label: `observer slope ${slope}`, n: 3000, cfg: SHIPPING, lapse: 0.02, seedOffset: 0, rngSeed: 6000 + Math.round(slope * 100), slope })));
}

/* --- seeding arc --- */
console.log('\nH. SEEDING ARC — brand-new user, no prior, 12 rounds. Does the seed find them?\n');
{
  const rng = mulberry32(90210);
  const arcs: number[][] = [];
  for (let i = 0; i < 2000; i++) {
    const o: Observer = { ability: gaussian(rng, ABILITY_MU, ABILITY_SD), slope: SLOPE, guess: 1 / K_OPTIONS, lapse: 0.02 };
    arcs.push(runSeedingArc(o, SHIPPING, 12, rng));
  }
  console.log('  round   mean |seed − true threshold|, level units');
  console.log('  ' + '-'.repeat(52));
  for (let r = 0; r < 12; r++) {
    const e = mean(arcs.map((a) => Math.abs(a[r])));
    console.log(`  ${String(r + 1).padStart(5)}   ${e.toFixed(2).padStart(5)}   ${'█'.repeat(Math.max(0, Math.round(e * 6)))}`);
  }
}

/* --- exit criteria --- */
console.log('\n' + '='.repeat(108));
console.log('EXIT CRITERIA (Build Bible §10, T2)\n');
const checks: Array<[string, boolean, string]> = [
  ['bias < 0.1 level units', Math.abs(headline.bias) < 0.1, f(headline.bias)],
  ['≥95% converge by trial 30', headline.converged30 >= 0.95, pct(headline.converged30)],
  ['zero oscillation lock (fallback)', headline.fallbackRate === 0, pct(headline.fallbackRate)],
  ['no silent boundary lock', headline.silentLock === 0, pct(headline.silentLock)],
];
let allPass = true;
for (const [name, pass, val] of checks) {
  if (!pass) allPass = false;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${val}`);
}
console.log(`\n  T2: ${allPass ? 'PASS' : 'FAIL'}\n`);
if (!allPass) process.exitCode = 1;
