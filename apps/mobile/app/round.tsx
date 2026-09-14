/**
 * Mettle — Train. The Route (ordered span), drilling the method of loci.
 *
 * The staircase is the instrument, not just the difficulty knob: what we store is
 * the converged THRESHOLD in level units, which is expressed in list length and
 * presentation rate rather than milliseconds of reaction time, and therefore
 * inherits almost none of the 50–200 ms touchscreen latency problem.
 *
 * v0.1 runs 14 trials so a round takes about four minutes and you can actually
 * pressure-test it. T2 validated 20 as the floor for the bias and convergence
 * criteria; production uses 20 and three rounds. Flagged rather than quietly done.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { C, S, T, temper } from '../src/theme';
import {
  loadSnapshot, saveRound, saveProve, LOCAL_USER, deviceId, uuid, SnapshotLog,
} from '../src/store';
import { Staircase, coarseTrialsFor } from '../src/engine/staircase';
import { newAbility, updateAbilityFromThreshold, seedLevel } from '../src/engine/elo';
import { taskFor } from '../src/engine/tasks';
import { currentLadderLevel, nextAttempt } from '../src/engine/log';
import { capabilityForDay } from '../src/engine/loop';

const TRIALS = 14;            // v0.1 — see file header. Production: 20.
const GRID = 16;              // 4 × 4, so a 12-item list needs no repeats
const RECALL_GAP_MS = 450;
const FEEDBACK_MS = 1500;

type Phase = 'loading' | 'ready' | 'present' | 'recall' | 'feedback' | 'done';

export default function Round() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [trial, setTrial] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [summary, setSummary] = useState<{ threshold: number; pc: number; offScale: boolean } | null>(null);

  const sc = useRef<Staircase | null>(null);
  const seq = useRef<number[]>([]);
  const started = useRef<number>(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ctx = useRef<{ log: SnapshotLog; capability: ReturnType<typeof capabilityForDay>; level: number } | null>(null);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  /* ---- set up: derive the seed from the log, never from stored state ---- */
  useEffect(() => {
    let live = true;
    (async () => {
      const log = await loadSnapshot(LOCAL_USER);
      if (!live) return;
      const now = new Date();
      const capability = capabilityForDay(log, LOCAL_USER, now);
      const task = taskFor(capability);
      const level = currentLadderLevel(log, LOCAL_USER, capability);
      const past = log.rounds(LOCAL_USER, task.id).filter((r) => !r.offScale);

      const min = task.staircase.minLevel ?? 1;
      const max = task.staircase.maxLevel ?? 30;
      const targetP = task.staircase.targetP ?? 0.75;

      let ability = newAbility((min + max) / 2);
      for (const r of past) ability = updateAbilityFromThreshold(ability, r.threshold, targetP, task.kOptions);
      const seed = Math.min(max, Math.max(min, seedLevel(ability.theta, targetP, task.kOptions)));

      sc.current = new Staircase(seed, {
        ...task.staircase,
        coarseTrials: coarseTrialsFor(past.length),
      });
      ctx.current = { log, capability, level };
      started.current = Date.now();
      setPhase('ready');
    })();
    return () => { live = false; clearTimers(); };
  }, []);

  /* ---- present the sequence ---- */
  const present = useCallback(() => {
    const s = sc.current!;
    const task = taskFor(ctx.current!.capability);
    const p = task.levelToParams(s.currentLevel);
    const n = Math.max(2, Math.round(p.listLength ?? 4));
    const ms = Math.max(350, Math.round(p.presentationMs ?? 1400));

    // sample without replacement so no station repeats within a route
    const pool = Array.from({ length: GRID }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    seq.current = pool.slice(0, Math.min(n, GRID));

    setTaps([]); setFailedAt(null); setLastCorrect(null); setPhase('present');
    seq.current.forEach((cell, i) => {
      after(i * ms, () => setLit(cell));
      after(i * ms + ms * 0.62, () => setLit(null));
    });
    after(seq.current.length * ms + RECALL_GAP_MS, () => setPhase('recall'));
  }, []);

  useEffect(() => { if (phase === 'ready') present(); }, [phase, present]);

  /* ---- the user walks the route back ---- */
  const tap = (cell: number) => {
    if (phase !== 'recall') return;
    const idx = taps.length;
    const next = [...taps, cell];
    setTaps(next);

    if (seq.current[idx] !== cell) return finishTrial(false, idx);
    if (next.length === seq.current.length) return finishTrial(true, null);
  };

  const finishTrial = (correct: boolean, failIdx: number | null) => {
    sc.current!.record(correct);
    setLastCorrect(correct);
    setFailedAt(failIdx);
    setPhase('feedback');
    const n = trial + 1;
    after(FEEDBACK_MS, () => {
      if (n >= TRIALS) return finishRound();
      setTrial(n);
      setPhase('ready');
    });
  };

  /* ---- store the round ---- */
  const finishRound = async () => {
    clearTimers();
    const r = sc.current!.result();
    const { log, capability, level } = ctx.current!;
    const task = taskFor(capability);
    const attempt = nextAttempt(log, LOCAL_USER, task.id);
    const now = new Date();

    await saveRound({
      id: uuid(), userId: LOCAL_USER, taskId: task.id, capability, attempt,
      threshold: r.threshold, offScale: r.offScale, proportionCorrect: r.proportionCorrect,
      trialCount: r.trials.length, ladderLevel: level,
      startedAt: now.toISOString(), durationMs: Date.now() - started.current,
      deviceId: deviceId(), deviceOffsetMs: 0,
      appVersion: '0.1.0', engineVersion: '0.1.0',
    });

    // Schedule the delayed checks. Retrieval at ≥1 day gives g = 0.69 against
    // 0.41 same-day, so the check is never offered immediately.
    const base = now.getTime();
    for (const h of [24, 168]) {
      await saveProve({
        id: uuid(), userId: LOCAL_USER, capability, ladderLevel: level, delayHours: h,
        scheduledFor: new Date(base + h * 3600_000).toISOString(),
      });
    }

    setSummary({ threshold: r.threshold, pc: r.proportionCorrect, offScale: r.offScale });
    setPhase('done');
  };

  /* ---------------- render ---------------- */

  if (phase === 'loading' || !ctx.current) {
    return <SafeAreaView style={st.screen}><ActivityIndicator color={C.accent} style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  const level = ctx.current.level;

  if (phase === 'done' && summary) {
    return (
      <SafeAreaView style={st.screen} edges={['bottom']}>
        <View style={st.pad}>
          <Text style={T.label}>Round complete</Text>
          <Text style={[T.display, { marginTop: S.sm }]}>
            {summary.offScale ? 'Off the scale' : `${summary.threshold.toFixed(1)} items`}
          </Text>
          <Text style={[T.body, { marginTop: S.md }]}>
            {summary.offScale
              ? "You ran past the end of this task's difficulty range, so we're not turning that into a number. The scale, not you, is the problem — it widens in the next build."
              : `You held ${summary.threshold.toFixed(1)} items in order at your working pace, and got ${Math.round(summary.pc * 100)}% of trials right — which is where we aim to keep you.`}
          </Text>
          <View style={st.note}>
            <Text style={st.noteText}>
              This is one round. We will not call anything a change until there are four
              sessions at each end, your first session has been discarded for practice
              effects, and the difference clears our reliable-change threshold.
            </Text>
          </View>
          <Pressable style={st.btn} onPress={() => router.replace('/')}>
            <Text style={st.btnText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const showing = phase === 'present';
  const task = taskFor(ctx.current.capability);
  const p = task.levelToParams(sc.current!.currentLevel);

  return (
    <SafeAreaView style={st.screen} edges={['bottom']}>
      <View style={st.pad}>
        <View style={st.topRow}>
          <Text style={T.label}>Trial {Math.min(trial + 1, TRIALS)} / {TRIALS}</Text>
          <Text style={[T.label, { color: temper(level) }]}>
            {Math.round(p.listLength ?? 0)} stations
          </Text>
        </View>

        <Text style={st.instruction}>
          {showing ? 'Watch the route' : phase === 'recall' ? 'Walk it back, in order' : ' '}
        </Text>

        <View style={st.grid}>
          {Array.from({ length: GRID }, (_, i) => {
            const tapped = taps.indexOf(i);
            const isLit = lit === i;
            return (
              <Pressable
                key={i}
                onPress={() => tap(i)}
                disabled={phase !== 'recall'}
                accessibilityRole="button"
                accessibilityLabel={`Station ${i + 1}`}
                style={[
                  st.cell,
                  isLit && { backgroundColor: temper(level), borderColor: temper(level) },
                  tapped >= 0 && { backgroundColor: C.accentDim, borderColor: C.accent },
                  phase === 'feedback' && lastCorrect === false && tapped === failedAt &&
                    { backgroundColor: C.stopDim, borderColor: C.stop },
                ]}
              >
                {tapped >= 0 && phase !== 'present' ? (
                  <Text style={st.cellNum}>{tapped + 1}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={st.feedback}>
          {phase === 'feedback' ? (
            <Text style={[st.feedbackText, { color: lastCorrect ? C.go : C.straw }]}>
              {lastCorrect
                ? 'Whole route, in order.'
                : `Station ${(failedAt ?? 0) + 1} — you had the place, you took it out of order. Walk the route, don't hunt for it.`}
            </Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { flex: 1, padding: S.lg, gap: S.md },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  instruction: { fontSize: 19, fontWeight: '700', color: C.ink, letterSpacing: -0.3, minHeight: 26 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: S.sm,
    justifyContent: 'center', alignItems: 'center', flex: 1,
  },
  cell: {
    width: '22%', aspectRatio: 1, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  cellNum: { color: C.accent, fontWeight: '700', fontSize: 15 },
  feedback: { minHeight: 64, justifyContent: 'center' },
  feedbackText: { fontSize: 14.5, lineHeight: 20 },
  note: { marginTop: S.xl, padding: S.md, backgroundColor: C.surface, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: C.accent },
  noteText: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  btn: { marginTop: 'auto', backgroundColor: C.accent, borderRadius: 10, padding: S.lg, alignItems: 'center' },
  btnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
