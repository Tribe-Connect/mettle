import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';

import { C, S, T, temper, CAPABILITY_LABEL } from '../src/theme';
import { loadSnapshot, LOCAL_USER, SnapshotLog } from '../src/store';
import { today, capabilityForDay } from '../src/engine/loop';
import type { Step } from '../src/engine/loop';
import { currentLadderLevel } from '../src/engine/log';
import type { Capability } from '../src/engine/log';
import type { DayActions } from '../src/engine/schedule';
import { taskFor } from '../src/engine/tasks';
import { LADDER } from '../src/ladder';

const DAY = 86_400_000;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Streak input, derived from the log — never stored. */
function recentDays(log: SnapshotLog, now: Date, back = 30): DayActions[] {
  const out: DayActions[] = [];
  for (let i = back - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    out.push({
      trained: log.rounds(LOCAL_USER).some((r) => sameDay(new Date(r.startedAt), d)),
      applied: log.missions(LOCAL_USER).some((m) => sameDay(new Date(m.createdAt), d)),
      proved: log.proves(LOCAL_USER).some((p) => !!p.answeredAt && sameDay(new Date(p.answeredAt), d)),
    });
  }
  return out;
}

export default function Today() {
  const router = useRouter();
  const [log, setLog] = useState<SnapshotLog | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadSnapshot(LOCAL_USER).then((l) => { if (live) setLog(l); });
      return () => { live = false; };
    }, []),
  );

  if (!log) {
    return (
      <SafeAreaView style={st.screen}>
        <ActivityIndicator color={C.accent} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const now = new Date();
  const capability: Capability = capabilityForDay(log, LOCAL_USER, now);
  const view = today({ log, userId: LOCAL_USER, capability, now, recentDays: recentDays(log, now) });
  const level = currentLadderLevel(log, LOCAL_USER, capability);
  const rung = LADDER[capability][level - 1];
  const task = taskFor(capability);

  const go = (id: Step['id']) => {
    if (id === 'train') router.push('/round');
    else if (id === 'apply') router.push('/apply');
  };

  return (
    <SafeAreaView style={st.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={st.scroll}>
        <View style={st.head}>
          <Text style={T.label}>
            {view.steps[0].state === 'not-today' ? 'Today · mission day' : 'Today · train day'}
          </Text>
          <Pressable onPress={() => router.push('/progress')} hitSlop={10}>
            <Text style={[T.label, { color: C.accent }]}>Progress</Text>
          </Pressable>
        </View>

        <View style={[st.rung, { borderLeftColor: temper(level) }]}>
          <Text style={[T.label, { color: temper(level), marginBottom: 4 }]}>
            {CAPABILITY_LABEL[capability]} · level {level}
          </Text>
          <Text style={T.display}>{rung.method}</Text>
          <Text style={[T.body, { marginTop: S.sm }]}>{rung.how}</Text>
        </View>

        {view.steps.map((s) => (
          <StepCard key={s.id} step={s} onPress={() => go(s.id)} />
        ))}

        <Text style={st.foot}>
          {view.streak > 0 ? `${view.streak} day streak · ` : ''}
          any one of the three keeps it. Missing a day costs you nothing.
        </Text>
        <Text style={[st.foot, { color: C.muted, marginTop: S.sm }]}>
          {task.name} · measured in {task.metricLabel}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function StepCard({ step, onPress }: { step: Step; onPress: () => void }) {
  const due = step.state === 'due';
  const label = step.id === 'train' ? 'Train' : step.id === 'apply' ? 'Apply' : 'Prove';
  const disabled = !due;
  return (
    <Pressable
      onPress={due ? onPress : undefined}
      disabled={disabled}
      style={({ pressed }) => [
        st.card,
        due && st.cardDue,
        pressed && due && { opacity: 0.75 },
        !due && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${step.detail}`}
      accessibilityState={{ disabled }}
    >
      <View style={st.cardRow}>
        <View style={[st.dot, due && st.dotDue, step.state === 'done' && st.dotDone]} />
        <Text style={st.cardTitle}>{label}</Text>
      </View>
      <Text style={st.cardDetail}>{step.detail}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: S.lg, paddingBottom: S.xxl, gap: S.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.xs },
  rung: {
    backgroundColor: C.surface, borderRadius: 10, padding: S.lg,
    borderLeftWidth: 4, marginBottom: S.sm,
  },
  card: {
    backgroundColor: C.surface, borderRadius: 10, padding: S.lg,
    borderWidth: 1, borderColor: C.line, gap: S.xs,
  },
  cardDue: { borderColor: C.accent, backgroundColor: C.surfaceHi },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  cardTitle: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  cardDetail: { fontSize: 13.5, color: C.muted, marginLeft: 22 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: C.muted },
  dotDue: { borderColor: C.accent, borderWidth: 3 },
  dotDone: { backgroundColor: C.go, borderColor: C.go },
  foot: { fontSize: 12.5, color: C.ink2, marginTop: S.lg, lineHeight: 18 },
});
