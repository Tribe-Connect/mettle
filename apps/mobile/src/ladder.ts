/**
 * Mettle — the thirty methods.
 *
 * Ratified decision 1 (13 Sep 2026): the Ladder is a ladder of METHODS, not of
 * capacities. Each rung is a named, transportable technique the user can say out
 * loud, drill to fluency, deploy in a real situation, and be checked on a day later.
 *
 * `method` is what the user calls it. `how` is the technique in one sentence.
 * `mission` is the suggested if–then ACTION — the user still writes their own cue,
 * because a self-generated situational cue is what makes the effect hold.
 */

import type { Capability } from './engine/log';

export interface Rung {
  method: string;
  how: string;
  mission: string;
}

export const LADDER: Record<Capability, Rung[]> = {
  recall: [
    { method: 'Chunk and name',
      how: 'Break a sequence into groups of three or four and give each group a name.',
      mission: 'Memorise one real sequence today — a postcode, a door code, the last four of a card.' },
    { method: 'Elaborative encoding',
      how: 'Connect the new thing to something you already know, in a full sentence.',
      mission: "Encode one person's name out loud today, the moment you hear it." },
    { method: 'The method of loci',
      how: 'Walk a fixed mental route with numbered stations and leave a vivid image at each.',
      mission: "Place tomorrow's agenda on your route, then walk it without looking." },
    { method: 'Space your own review',
      how: 'Decide how long you need to hold it, then review at roughly a fifth of that interval.',
      mission: 'Set one real retention target this week and let the schedule hold you to it.' },
    { method: 'Retrieval under load',
      how: 'Recall deliberately while doing something else — the condition real life imposes.',
      mission: 'Recall your prepared points in a live conversation, with no notes in front of you.' },
  ],
  focus: [
    { method: 'The single-tab rule',
      how: 'One task visible. Everything else closed, not minimised.',
      mission: 'Run one block today with exactly one thing on screen.' },
    { method: 'Cue removal',
      how: 'Take away the trigger rather than resisting it. Willpower loses; distance wins.',
      mission: 'Remove one specific trigger before you start, not during.' },
    { method: 'Drift catching',
      how: 'Notice you have gone, without commentary, and return. The noticing is the skill.',
      mission: 'Catch yourself drifting once today and name it, silently, then carry on.' },
    { method: 'The pre-committed block',
      how: 'Decide the length and the finish line before you start, not while you are in it.',
      mission: 'Commit to one block today with its end stated in advance.' },
    { method: 'Recovery after interruption',
      how: 'Write the next line before you answer the interruption, so re-entry is free.',
      mission: 'Leave yourself a re-entry note the next time you are interrupted.' },
  ],
  speed: [
    { method: 'The wide look',
      how: 'Take the whole field in one glance instead of scanning it piece by piece.',
      mission: 'Read one page or screen with a single wide look before reading it properly.' },
    { method: 'Divided attention',
      how: 'Hold the centre and the edge at once rather than switching between them.',
      mission: 'Track one thing at the edge of your attention while doing something else.' },
    { method: 'The scan pattern',
      how: 'Use a fixed path through a document or a room instead of a random walk.',
      mission: 'Apply one deliberate scan pattern to something you would normally skim.' },
    { method: 'Decision-first reading',
      how: 'Decide what you are looking for before you start, then look only for that.',
      mission: 'State your question before opening the next document.' },
    { method: 'Speed under uncertainty',
      how: 'Commit at eighty per cent rather than waiting for certainty you will not get.',
      mission: 'Make one call today at eighty per cent and note what it cost you.' },
  ],
  reasoning: [
    { method: 'State the rule',
      how: 'Say the pattern out loud before you act on it. Unsaid rules are usually wrong.',
      mission: 'State one rule you are working to today, in a sentence, to someone else.' },
    { method: 'Test one variable',
      how: 'Change one thing at a time, or you learn nothing from the result.',
      mission: 'Change exactly one variable in something you are running.' },
    { method: 'Inductive series',
      how: 'Find the rule from the examples rather than assuming the rule and fitting them.',
      mission: 'Derive one conclusion today purely from what is in front of you.' },
    { method: 'Falsify your first answer',
      how: 'Spend thirty seconds trying to break your answer before you commit to it.',
      mission: 'Attack your own first answer once today, properly, before defending it.' },
    { method: 'Reason from an incomplete set',
      how: 'Name what is missing, then decide anyway — and say which way the gap cuts.',
      mission: 'Name the missing evidence in one decision today, and decide regardless.' },
  ],
  flexibility: [
    { method: 'Name the current task',
      how: 'Say what you are doing now. You cannot switch cleanly from a task you cannot name.',
      mission: 'Name the task out loud each time you change what you are doing.' },
    { method: 'Close before opening',
      how: 'Finish the thought, then start the next. Overlap is where the cost sits.',
      mission: 'Close one thing properly before opening the next, once today.' },
    { method: 'Rule-change tolerance',
      how: 'Expect the rule to move and hold the old one loosely from the start.',
      mission: 'Notice one place today where you are still applying a rule that has changed.' },
    { method: 'Reframe on new evidence',
      how: 'Change the frame, not just the answer, when the evidence moves.',
      mission: 'Change your mind about one thing today and say so out loud.' },
    { method: 'Two live rule-sets',
      how: 'Hold two incompatible frames at once without collapsing to either.',
      mission: 'Argue both sides of one live decision before choosing.' },
  ],
  composure: [
    { method: 'The worry offload',
      how: 'Write down what you are carrying, for ten minutes, before the thing that matters.',
      mission: 'Write before one pressured moment today, not after it.' },
    { method: 'Physiological reset',
      how: 'Lengthen the out-breath before load. The body settles first, then the mind.',
      mission: 'Reset deliberately before one demanding thing today.' },
    { method: 'Stop, state, split, check',
      how: 'Stop. Say the goal. Split it. Check where you actually are against it.',
      mission: 'Run the four steps once today, mid-task, when you notice drift.' },
    { method: 'The pre-mortem',
      how: 'Assume it went badly and say why, before it starts.',
      mission: 'Pre-mortem one high-stakes thing this week, in writing.' },
    { method: 'Performing while watched',
      how: 'Work at your own pace with an audience, not at theirs.',
      mission: 'Hold your own pace once today while someone is watching.' },
  ],
};
