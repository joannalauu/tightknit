import type { Digest, SlackMessage } from "./types";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const TOP_THREAD_COUNT = 3;

// Openers that look like questions but aren't asking for help.
const RHETORICAL_OPENERS = ["can you believe", "how cool", "isn't it", "who else is"];

// Openers that ask for help even without a "?".
const ASK_OPENERS = [
  "does anyone",
  "anyone have",
  "anyone know",
  "looking for",
  "wondering",
  "curious",
  "would love to hear",
  "any tips",
  "any recommendations",
];

// Replies that nudge the thread without answering it.
const BUMP_PATTERNS = [/\bbump(ing)?\b/, /\bany ideas\b/, /\bstill stuck\b/, /^anyone\s*\?/, /\bany updates?\b/];

// Replies from someone with the same problem. Kept narrow so "We had the same
// problem. DMing you what we did." still counts as an answer.
const SAME_PROBLEM_PATTERNS = [
  /^\+1\b/,
  /^same here\b/,
  /^me too\b/,
  /\bsame question\b/,
  /\b(i have|i'm having|having|getting) the same (problem|issue)\b/,
];

function isReply(m: SlackMessage): boolean {
  return m.thread_ts !== undefined && m.thread_ts !== m.ts;
}

function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (RHETORICAL_OPENERS.some((p) => t.startsWith(p))) return false;
  return t.includes("?") || ASK_OPENERS.some((p) => t.startsWith(p));
}

function isAnswer(reply: SlackMessage): boolean {
  const t = reply.text.trim().toLowerCase();
  return ![...BUMP_PATTERNS, ...SAME_PROBLEM_PATTERNS].some((p) => p.test(t));
}

/**
 * Build the weekly digest for one Slack channel.
 *
 * The week starts at `weekStart` and runs for 7 days.
 *
 * Returns:
 *  - topThreads: the 3 most active threads this week
 *  - unanswered: questions posted this week that nobody has answered
 */
export function buildDigest(messages: SlackMessage[], weekStart: Date): Digest {
  const start = weekStart.getTime() / 1000;
  const end = start + WEEK_SECONDS;
  const inWeek = (ts: string) => {
    const t = Number(ts);
    return t >= start && t < end;
  };

  const topLevel = new Map<string, SlackMessage>();
  const answeredThreads = new Set<string>();
  const weeklyReplies = new Map<string, number>();

  for (const m of messages) {
    if (!isReply(m)) {
      topLevel.set(m.ts, m);
      continue;
    }
    const thread = m.thread_ts!;
    if (isAnswer(m)) answeredThreads.add(thread);
    // Count by reply timestamp, not reply_count: the parent may be from an
    // earlier week, and reply_count includes replies outside this week.
    if (inWeek(m.ts)) {
      weeklyReplies.set(thread, (weeklyReplies.get(thread) ?? 0) + 1);
    }
  }

  const topThreads = [...weeklyReplies]
    .filter(([thread]) => topLevel.has(thread))
    .sort(([a, countA], [b, countB]) => countB - countA || Number(a) - Number(b))
    .slice(0, TOP_THREAD_COUNT)
    .map(([thread_ts, repliesThisWeek]) => ({
      thread_ts,
      text: topLevel.get(thread_ts)!.text,
      repliesThisWeek,
    }));

  const unanswered = [...topLevel.values()]
    .filter(
      (m) =>
        m.subtype === undefined &&
        inWeek(m.ts) &&
        isQuestion(m.text) &&
        !answeredThreads.has(m.ts),
    )
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .map(({ ts, user, text }) => ({ ts, user, text }));

  return { topThreads, unanswered };
}
