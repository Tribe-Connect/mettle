/**
 * Mettle — the six task definitions.
 *
 * One `GameModule` interface, six implementations. The renderer owns pixels and
 * timing; the module owns difficulty, trial generation and scoring. Nothing here
 * imports React.
 *
 * T2 FINDING, now a hard design rule: EVERY TASK CARRIES A CONTINUOUS DIFFICULTY
 * DIMENSION, not only an integer one. On an integer-only scale the staircase step
 * is forced to 1 and threshold bias lands at −0.54 levels; with a continuous
 * dimension and a 0.2 step it is −0.068. So each task below pairs a coarse
 * integer parameter (list length, rule count, active rule sets) with a fine
 * continuous one (presentation rate, display duration, cue-stimulus interval).
 *
 * Reportability follows Build Bible §06 and is a PREDICTION to be tested, not a
 * decision. The pilot (T6) measures each task's ICC and the 0.70 gate decides.
 */

import type { Capability } from './log.ts';
import type { StaircaseConfig } from './staircase.ts';

/** Whether this task may ever produce a user-facing progress number. */
export type Reportability =
  /** Expected to clear ICC 0.70. Subject to the pilot. */
  | 'expected-reportable'
  /** Expected to fail the gate. Ships as a drill with an in-app explanation. */
  | 'expected-drill-only'
  /** Not a psychometric track at all — reported as a within-person delta, or not at all. */
  | 'conditional';

export interface TaskParams {
  /** Coarse integer parameter. */
  [key: string]: number;
}

export interface GameModule {
  id: string;
  capability: Capability;
  name: string;
  /** What the number means, in the words the app uses. Scoped to the task, never to a construct. */
  metricLabel: string;
  /** The coarse integer dimension, named. */
  coarseDimension: string;
  /** The fine continuous dimension, named. Required — see T2 finding above. */
  fineDimension: string;
  reportability: Reportability;
  /** Why, in one line, citing the evidence. Shown in the in-app "why this works" page. */
  rationale: string;
  staircase: Partial<StaircaseConfig>;
  /** Number of response alternatives, for the guess-rate correction. */
  kOptions?: number;
  /** Map a continuous level on 1..30 to concrete presentation parameters. */
  levelToParams(level: number): TaskParams;
}

const clampLevel = (l: number) => Math.min(30, Math.max(1, l));

/* ------------------------------------------------------------------ */

export const ORDERED_SPAN: GameModule = {
  id: 'recall.ordered-span',
  capability: 'recall',
  name: 'The Route',
  metricLabel: 'items held in order',
  coarseDimension: 'list length',
  fineDimension: 'presentation rate',
  reportability: 'expected-reportable',
  rationale:
    'Drills the method of loci. Dresler 2017: loci training took recall from 26–30 to 62 items ' +
    'with +22 still held at four months, while process-based short-term-memory training reached ' +
    '41 and did not maintain.',
  staircase: { targetP: 0.75, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  levelToParams(level) {
    const l = clampLevel(level);
    const band = Math.floor((l - 1) / 3);          // 0..9
    const frac = ((l - 1) % 3) / 3;                // 0..0.67, the fine dimension
    return {
      listLength: 3 + band,                        // 3..12 items
      presentationMs: Math.round(2000 - 900 * frac), // 2000 → 1100 within each band
    };
  },
};

export const PERIPHERAL_GLANCE: GameModule = {
  id: 'speed.ufov',
  capability: 'speed',
  name: 'Wide Look',
  metricLabel: 'milliseconds of display you need',
  coarseDimension: 'distractor count',
  fineDimension: 'display duration',
  reportability: 'expected-reportable',
  rationale:
    'Useful Field of View — divided and selective attention with distractors, the ACTIVE speed ' +
    'paradigm. The most durable finding in the field: ES 0.76 at five years, 0.66 at ten. ' +
    'Peripheral variants only: UFOV outer ICC .74 vs inner .30.',
  staircase: { targetP: 0.75, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  kOptions: 8,
  levelToParams(level) {
    const l = clampLevel(level);
    return {
      // Log-spaced duration: ~355 ms at level 1 down to ~11 ms at level 30.
      displayMs: Math.max(8, Math.round(400 * Math.exp(-0.12 * l))),
      distractors: Math.floor(l / 6),              // 0..5
      eccentricityDeg: 10,                         // peripheral, fixed — see rationale
    };
  },
};

export const DRIFT_CATCH: GameModule = {
  id: 'focus.sustained',
  capability: 'focus',
  name: 'The Long Lane',
  metricLabel: 'pace you can hold without slipping',
  coarseDimension: 'concurrent load',
  fineDimension: 'inter-stimulus interval',
  reportability: 'expected-reportable',
  rationale:
    'SART-derived sustained attention under load. Scored on commission errors (ICC .76), never ' +
    'on an interference difference score — flanker cost runs ICC .40, where a user would need to ' +
    'move from the 50th to the 98th percentile before a change were real.',
  staircase: { targetP: 0.80, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  kOptions: 2,
  levelToParams(level) {
    const l = clampLevel(level);
    return {
      isiMs: Math.round(1400 - 35 * l),            // 1365 → 350 ms
      loadItems: 1 + Math.floor(l / 8),            // 1..4
      targetRate: 0.11,                            // rare targets: the SART signature
    };
  },
};

export const RULE_FINDER: GameModule = {
  id: 'reasoning.induction',
  capability: 'reasoning',
  name: 'State the Rule',
  metricLabel: 'rule complexity you can unpick',
  coarseDimension: 'interacting rules',
  fineDimension: 'time available per item',
  reportability: 'expected-reportable',
  rationale:
    'Inductive-series reasoning with explicit strategy instruction — the ACTIVE reasoning arm ' +
    '(0.26 at 5y, 0.23 at 10y, the only arm with a significant 5-year everyday-function effect). ' +
    'NOT matrix drilling for fluid intelligence: that runs g = 0.05–0.09, not significant, and ' +
    'the words "IQ" and "fluid intelligence" never appear in this product.',
  staircase: { targetP: 0.75, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  kOptions: 4,
  levelToParams(level) {
    const l = clampLevel(level);
    return {
      ruleCount: 1 + Math.floor((l - 1) / 10),     // 1..3 interacting rules
      sequenceLength: 4 + Math.floor(((l - 1) % 10) / 3),
      timeLimitMs: Math.max(6000, Math.round(30000 - 700 * l)),
    };
  },
};

export const CLEAN_SWITCH: GameModule = {
  id: 'flexibility.mixed-blocks',
  capability: 'flexibility',
  name: 'Clean Switch',
  metricLabel: 'accuracy in mixed blocks',
  coarseDimension: 'active rule sets',
  fineDimension: 'cue–stimulus interval',
  reportability: 'expected-drill-only',
  rationale:
    'Mixed-task blocks, scored on raw accuracy and RT WITHIN the block — never on switch cost. ' +
    'Switch cost runs ICC .40–.66 and Navon global RT cost is literally 0. On the ratified 0.70 ' +
    'gate this capability most likely ships as a drill with no progress number, and the app will ' +
    'say so.',
  staircase: { targetP: 0.75, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  kOptions: 2,
  levelToParams(level) {
    const l = clampLevel(level);
    return {
      ruleSets: 2 + Math.floor(l / 15),            // 2..4
      cueStimulusMs: Math.max(60, Math.round(900 - 28 * l)),
      switchProbability: Math.min(0.6, 0.3 + 0.01 * l),
    };
  },
};

export const UNDER_PRESSURE: GameModule = {
  id: 'composure.load-delta',
  capability: 'composure',
  name: 'Hold Your Nerve',
  metricLabel: 'how much you lose under pressure',
  coarseDimension: 'pressure manipulation',
  fineDimension: 'the host task’s own fine dimension',
  reportability: 'conditional',
  rationale:
    'Not a psychometric track. Runs a task the user already has a calm baseline on, under an ' +
    'added pressure manipulation, and reports the DELTA against that baseline. Ramirez & Beilock: ' +
    'controls fell 12%, the writing group rose 5%, and high-anxiety students went B− to B+. The ' +
    'benefit is concentrated in those carrying the load, so this is surfaced only for users whose ' +
    'own baseline shows the effect — capacity recovered, never capacity added.',
  staircase: { targetP: 0.75, stepHarder: 0.2, minLevel: 1, maxLevel: 30, granularity: 'continuous' },
  levelToParams(level) {
    const l = clampLevel(level);
    return {
      visibleTimer: l >= 6 ? 1 : 0,
      publicScore: l >= 14 ? 1 : 0,
      interruptionRate: Math.min(0.35, 0.02 * l),
      hostLevel: l,
    };
  },
};

export const ALL_TASKS: GameModule[] = [
  DRIFT_CATCH, ORDERED_SPAN, PERIPHERAL_GLANCE, RULE_FINDER, CLEAN_SWITCH, UNDER_PRESSURE,
];

export function taskFor(capability: Capability): GameModule {
  const t = ALL_TASKS.find((x) => x.capability === capability);
  if (!t) throw new Error(`no task registered for capability ${capability}`);
  return t;
}

/**
 * NO AUDITORY OR AUDIOVISUAL-ONSET TASKS. Audio–visual synchrony error spans
 * −30 ms to +198 ms across packages, operating systems and browsers, and the
 * field's own timing mega-study concluded every tested package is struggling
 * there. This rules out auditory dual n-back, which is notable given its
 * prominence in the literature. Enforced by a lint rule, not just by this comment.
 */
export const AUDITORY_TASKS_PERMITTED = false;
