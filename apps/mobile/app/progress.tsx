/**
 * Mettle — Progress. The honesty layer, made visible.
 *
 * No composite. No brain age. No single Mettle score. Bands, never points, and a
 * change is only called a change when it clears a reliable-change threshold.
 *
 * Note the three refusals this screen is capable of, all of which competitors
 * simply do not have: not enough sessions yet, the task's reliability is below our
 * own 0.70 bar, and these sessions span more than one device.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, S, T, temper, CAPABILITY_LABEL } from '../src/theme';
import { loadSnapshot, LOCAL_USER, SnapshotLog } from '../src/store';
import { ALL_TASKS } from '../src/engine/tasks';
import type { GameModule } from '../src/engine/tasks';
import { toSessions, currentLadderLevel } from '../src/engine/log';
import { assessChange } from '../src/engine/measurement';
import type { ChangeReport } from '../src/engine/measurement';

/**
 * Placeholder reliabilities, clearly labelled as such.
 *
 * These are LITERATURE values standing in until the October pilot measures our own
 * per-task ICC on n ≈ 60. The app must never present a literature coefficient as
 * if it were ours, so the screen says so in as many words.
 */
const PROVISIONAL_ICC: Record<string, number> = {
  'recall.ordered-span': 0.77,
  'speed.ufov': 0.74,
  'focus.sustained': 0.76,
  'reasoning.induction': 0.72,
  'flexibility.mixed-blocks': 0.45,
  'composure.load-delta': 0.50,
};
const PROVISIONAL_SD_DIFF = 2.0;

export default function Progress() {
  const [log, setLog] = useState<SnapshotLog | null>(null);

  useEffect(() => {
    let live = true;
    loadSnapshot(LOCAL_USER).then((l) => { if (live) setLog(l); });
    return () => { live = false; };
  }, []);

  if (!log) {
    return <SafeAreaView style={st.screen}><ActivityIndicator color={C.accent} style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={st.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={st.pad}>
        {ALL_TASKS.map((task) => (
          <TaskRow key={task.id} task={task} log={log} />
        ))}

        <View style={st.footer}>
          <Text style={st.footerTitle}>Why some of these have no number</Text>
          <Text style={st.footerText}>
            We only score a task if its test–retest reliability reaches 0.70. Below that,
            the number moves more on measurement noise than on you, so we train the task
            and say nothing about it. The coefficients above are published figures standing
            in until our own October pilot measures them on sixty people — at which point
            these become our numbers, and we will print them here.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskRow({ task, log }: { task: GameModule; log: SnapshotLog }) {
  const rows = log.rounds(LOCAL_USER, task.id);
  const level = currentLadderLevel(log, LOCAL_USER, task.capability);
  const sessions = toSessions(rows);
  const icc = PROVISIONAL_ICC[task.id] ?? 0.5;

  const report: ChangeReport = assessChange({
    baseline: sessions.slice(0, 5),
    recent: sessions.slice(-4),
    taskReliability: icc,
    cohortSDdiff: PROVISIONAL_SD_DIFF,
  });

  const usable = rows.filter((r) => !r.offScale && r.attempt > 1);
  const latest = usable.length ? usable[usable.length - 1].threshold : null;

  const tone =
    report.verdict === 'improved' ? C.go
      : report.verdict === 'declined' ? C.stop
        : report.verdict === 'not-reportable' ? C.muted
          : C.ink2;

  return (
    <View style={[st.card, { borderLeftColor: temper(level) }]}>
      <View style={st.cardHead}>
        <Text style={st.capability}>{CAPABILITY_LABEL[task.capability]}</Text>
        <Text style={T.label}>{rows.length} {rows.length === 1 ? 'round' : 'rounds'}</Text>
      </View>
      <Text style={st.taskName}>{task.name}</Text>

      {report.verdict === 'not-reportable' ? null : latest !== null ? (
        <Text style={st.value}>
          {latest.toFixed(1)}
          <Text style={st.unit}>  {task.metricLabel}</Text>
        </Text>
      ) : (
        <Text style={[st.value, { color: C.muted }]}>—</Text>
      )}

      <View style={st.verdictRow}>
        <View style={[st.pill, { borderColor: tone }]}>
          <Text style={[st.pillText, { color: tone }]}>
            {report.verdict.replace(/-/g, ' ')}
          </Text>
        </View>
        <Text style={st.icc}>ICC {icc.toFixed(2)} · provisional</Text>
      </View>

      <Text style={st.copy}>{report.copy}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: S.lg, paddingBottom: S.xxl, gap: S.md },
  card: {
    backgroundColor: C.surface, borderRadius: 10, padding: S.lg,
    borderLeftWidth: 4, gap: S.xs,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  capability: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  taskName: { fontSize: 13, color: C.muted },
  value: { fontSize: 30, fontWeight: '700', color: C.ink, marginTop: S.sm, letterSpacing: -1 },
  unit: { fontSize: 13, fontWeight: '400', color: C.muted, letterSpacing: 0 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm, flexWrap: 'wrap' },
  pill: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  icc: { fontSize: 11, color: C.muted, letterSpacing: 0.3 },
  copy: { fontSize: 13, color: C.ink2, lineHeight: 19, marginTop: S.xs },
  footer: {
    marginTop: S.lg, padding: S.lg, borderRadius: 10,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.bg,
  },
  footerTitle: { fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: S.sm },
  footerText: { fontSize: 12.5, color: C.muted, lineHeight: 19 },
});
