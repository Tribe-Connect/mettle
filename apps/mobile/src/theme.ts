/**
 * Mettle — visual tokens.
 *
 * Steel and tempering colours: the sequence steel actually passes through as it
 * hardens — straw, bronze, purple, blue, grey-blue. That is where the name comes
 * from and it gives the Ladder a logic that isn't a progress bar.
 *
 * Single dark scheme, deliberately. A training app is used early and late; a
 * committed dark surface reads as an instrument rather than a wellness product.
 */

export const C = {
  bg: '#10151A',
  surface: '#192027',
  surfaceHi: '#212A33',
  line: '#2A333C',
  ink: '#E6EBEF',
  ink2: '#B4C0CA',
  muted: '#8C99A4',

  accent: '#7FA8DC',
  accentDim: '#1C2937',
  straw: '#DCB05C',

  go: '#6FBF9B',
  goDim: '#16271F',
  warn: '#D3A44C',
  stop: '#D98383',
  stopDim: '#2B1A1A',
} as const;

/** The tempering sequence — Ladder levels 1..5. */
export const TEMPER = ['#D9B458', '#C4784A', '#9A6E93', '#87ABDA', '#89A6B8'] as const;

export const temper = (level: number) => TEMPER[Math.min(TEMPER.length, Math.max(1, level)) - 1];

export const S = {
  xs: 4, sm: 8, md: 12, lg: 18, xl: 26, xxl: 38,
} as const;

export const T = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.8, color: C.ink },
  title: { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.4, color: C.ink },
  body: { fontSize: 15.5, lineHeight: 22, color: C.ink2 },
  label: {
    fontSize: 10.5, fontWeight: '700' as const, letterSpacing: 1.6,
    textTransform: 'uppercase' as const, color: C.muted,
  },
  mono: {
    fontSize: 13,
    fontFamily: undefined as string | undefined, // system; a real mono face lands in v0.2
    fontVariant: ['tabular-nums'] as const,
    color: C.ink2,
  },
};

export const CAPABILITY_LABEL: Record<string, string> = {
  focus: 'Focus',
  recall: 'Recall',
  speed: 'Speed',
  reasoning: 'Reasoning',
  flexibility: 'Flexibility',
  composure: 'Composure',
};
