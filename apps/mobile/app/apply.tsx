/**
 * Mettle — Apply. The if–then plan.
 *
 * The user writes BOTH halves. A pick-list of cues would be faster and would also
 * destroy the effect: implementation intentions work through a specific,
 * self-generated situational cue (d = 0.65 across 94 studies), and the conditional
 * if–then structure is itself load-bearing.
 *
 * Expect roughly one user in five to complete a real-world task like this — and
 * the value is concentrated in the FIRST completion, which is why this screen gets
 * more scaffolding than any other.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { C, S, T, temper } from '../src/theme';
import { loadSnapshot, saveMission, LOCAL_USER, uuid } from '../src/store';
import { validateMission, openMission, capabilityForDay } from '../src/engine/loop';
import { currentLadderLevel } from '../src/engine/log';
import type { Capability, MissionRow } from '../src/engine/log';
import { LADDER } from '../src/ladder';

export default function Apply() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [capability, setCapability] = useState<Capability>('recall');
  const [level, setLevel] = useState(1);
  const [existing, setExisting] = useState<MissionRow | null>(null);
  const [cue, setCue] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const log = await loadSnapshot(LOCAL_USER);
      if (!live) return;
      const now = new Date();
      const cap = capabilityForDay(log, LOCAL_USER, now);
      const lvl = currentLadderLevel(log, LOCAL_USER, cap);
      const open = openMission(log, LOCAL_USER, now);
      setCapability(cap); setLevel(lvl); setExisting(open);
      if (!open) setAction(LADDER[cap][lvl - 1].mission);
      setReady(true);
    })();
    return () => { live = false; };
  }, []);

  if (!ready) {
    return <SafeAreaView style={st.screen}><ActivityIndicator color={C.accent} style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  const rung = LADDER[capability][level - 1];

  const commit = async () => {
    const bad = validateMission(cue, action);
    if (bad) return setError(bad);
    await saveMission({
      id: uuid(), userId: LOCAL_USER, capability, ladderLevel: level,
      cueText: cue.trim(), actionText: action.trim(),
      createdAt: new Date().toISOString(),
    });
    router.replace('/');
  };

  const markDone = async () => {
    if (!existing) return;
    await saveMission({ ...existing, completedAt: new Date().toISOString() });
    router.replace('/');
  };

  if (existing) {
    return (
      <SafeAreaView style={st.screen} edges={['bottom']}>
        <ScrollView contentContainerStyle={st.pad}>
          <Text style={[T.label, { color: temper(level) }]}>{rung.method}</Text>
          <Text style={[T.display, { marginTop: S.xs }]}>Your plan is set</Text>

          <View style={st.plan}>
            <Text style={T.label}>If</Text>
            <Text style={st.planText}>{existing.cueText}</Text>
          </View>
          <View style={st.plan}>
            <Text style={T.label}>Then</Text>
            <Text style={st.planText}>{existing.actionText}</Text>
          </View>

          <Text style={[T.body, { marginTop: S.lg }]}>
            Come back when you have actually done it. Not when you have thought about it.
          </Text>

          <Pressable style={st.btn} onPress={markDone}>
            <Text style={st.btnText}>I did it</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={st.screen} edges={['bottom']}>
        <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
          <Text style={[T.label, { color: temper(level) }]}>{rung.method}</Text>
          <Text style={[T.display, { marginTop: S.xs }]}>One plan. One moment.</Text>
          <Text style={[T.body, { marginTop: S.sm }]}>
            Name a moment you will genuinely notice today — not a time of day, a situation.
            The specific cue is what makes this work at all.
          </Text>

          <Text style={[T.label, { marginTop: S.xl }]}>If</Text>
          <TextInput
            style={st.input}
            value={cue}
            onChangeText={(v) => { setCue(v); setError(null); }}
            placeholder="When I sit down at my desk after lunch…"
            placeholderTextColor={C.muted}
            multiline
            accessibilityLabel="The situation that will trigger your plan"
          />

          <Text style={[T.label, { marginTop: S.lg }]}>Then</Text>
          <TextInput
            style={st.input}
            value={action}
            onChangeText={(v) => { setAction(v); setError(null); }}
            placeholderTextColor={C.muted}
            multiline
            accessibilityLabel="What you will do"
          />
          <Text style={st.hint}>Suggested — change it to something real for today.</Text>

          {error ? <Text style={st.error}>{error}</Text> : null}

          <Pressable style={st.btn} onPress={commit}>
            <Text style={st.btnText}>Set the plan</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: S.lg, paddingBottom: S.xxl },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    padding: S.md, color: C.ink, fontSize: 16, minHeight: 74, marginTop: S.xs,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: C.muted, marginTop: S.xs },
  error: { color: C.straw, fontSize: 13.5, marginTop: S.md, lineHeight: 19 },
  plan: {
    backgroundColor: C.surface, borderRadius: 10, padding: S.md, marginTop: S.md,
    borderLeftWidth: 3, borderLeftColor: C.accent,
  },
  planText: { color: C.ink, fontSize: 16, marginTop: S.xs, lineHeight: 22 },
  btn: { marginTop: S.xl, backgroundColor: C.accent, borderRadius: 10, padding: S.lg, alignItems: 'center' },
  btnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
