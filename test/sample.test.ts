import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/digest";
import type { Digest, SlackMessage } from "../src/types";
import sampleMessages from "../data/sample-messages.json";
import sampleDigest from "../data/sample-digest.json";

const weekStart = new Date("2026-09-21T00:00:00Z");

describe("buildDigest on the sample", () => {
  it("returns an empty digest for an empty channel", () => {
    expect(buildDigest([], weekStart)).toEqual({ topThreads: [], unanswered: [] });
  });

  it("produces sample-digest.json from sample-messages.json", () => {
    const result = buildDigest(sampleMessages as SlackMessage[], weekStart);
    expect(result).toEqual(sampleDigest as Digest);
  });
});

// weekStart = 1789948800, weekEnd = 1790553600
const START = 1789948800;
const END = START + 7 * 86400;
const at = (seconds: number) => `${seconds}.000100`;
const parent = (ts: string, text: string, user = "U1"): SlackMessage => ({ ts, thread_ts: ts, user, text });
const reply = (ts: string, thread_ts: string, user = "U2"): SlackMessage => ({ ts, thread_ts, user, text: "reply" });
const post = (ts: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({
  ts,
  user: "U1",
  text,
  ...extra,
});

describe("topThreads", () => {
  it("counts this week's replies on a thread started in an earlier week", () => {
    const old = at(START - 86400);
    const result = buildDigest([parent(old, "old thread"), reply(at(START + 10), old), reply(at(START + 20), old)], weekStart);
    expect(result.topThreads).toEqual([{ thread_ts: old, text: "old thread", repliesThisWeek: 2 }]);
  });

  it("ignores replies outside the week and reply_count", () => {
    const p = at(END - 100);
    const msgs = [
      { ...parent(p, "late thread"), reply_count: 10 },
      reply(at(END - 50), p),
      reply(at(END + 50), p),
      reply(at(END + 60), p),
    ];
    expect(buildDigest(msgs, weekStart).topThreads).toEqual([{ thread_ts: p, text: "late thread", repliesThisWeek: 1 }]);
  });

  it("includes a reply exactly at weekStart and excludes one exactly at weekEnd", () => {
    const p = at(START - 100);
    const msgs = [parent(p, "t"), reply(`${START}.000000`, p), reply(`${END}.000000`, p)];
    expect(buildDigest(msgs, weekStart).topThreads[0].repliesThisWeek).toBe(1);
  });

  it("returns at most 3, sorted by count and then by thread_ts", () => {
    const [a, b, c, d] = [1, 2, 3, 4].map((i) => at(START + i));
    const msgs = [
      parent(a, "a"), parent(b, "b"), parent(c, "c"), parent(d, "d"),
      reply(at(START + 100), d), reply(at(START + 101), d),
      reply(at(START + 102), c),
      reply(at(START + 103), b),
      reply(at(START + 104), a),
    ];
    expect(buildDigest(msgs, weekStart).topThreads.map((t) => t.text)).toEqual(["d", "a", "b"]);
  });
});

describe("unanswered", () => {
  it("detects asks without '?' and skips rhetorical questions", () => {
    const msgs = [
      post(at(START + 1), "Anyone have a good onboarding checklist template"),
      post(at(START + 2), "Can you believe it's almost Q4 already?"),
      post(at(START + 3), "Just shipped a new feature"),
      post(at(START + 4), "Is there a dark mode?"),
    ];
    expect(buildDigest(msgs, weekStart).unanswered.map((q) => q.text)).toEqual([
      "Anyone have a good onboarding checklist template",
      "Is there a dark mode?",
    ]);
  });

  it("never treats bot messages or channel joins as questions", () => {
    const msgs = [
      post(at(START + 1), "Got questions? Bring them!", { subtype: "bot_message" }),
      post(at(START + 2), "<@U1> has joined the channel?", { subtype: "channel_join" }),
    ];
    expect(buildDigest(msgs, weekStart).unanswered).toEqual([]);
  });

  it("excludes questions with any reply and questions posted inside threads", () => {
    const q = at(START + 1);
    const msgs = [parent(q, "How do I do X?"), reply(at(START + 2), q), { ...reply(at(START + 3), q), text: "Also, how do I do Y?" }];
    expect(buildDigest(msgs, weekStart).unanswered).toEqual([]);
  });

  const threadWith = (...texts: string[]): SlackMessage[] => {
    const q = at(START + 1);
    return [
      parent(q, "How do I do X?"),
      ...texts.map((text, i) => ({ ...reply(at(START + 10 + i), q), text })),
    ];
  };

  it("treats a thread with only bumps as unanswered", () => {
    const msgs = threadWith("bump", "any ideas?", "anyone? still stuck on this");
    expect(buildDigest(msgs, weekStart).unanswered).toHaveLength(1);
  });

  it("treats a thread with only same-problem replies as unanswered", () => {
    const msgs = threadWith("+1", "Same here", "+1, same question", "I'm having the same issue");
    expect(buildDigest(msgs, weekStart).unanswered).toHaveLength(1);
  });

  it("counts a real reply alongside bumps as answered", () => {
    const msgs = threadWith("bump", "Check the admin settings.");
    expect(buildDigest(msgs, weekStart).unanswered).toEqual([]);
  });

  it.each([
    "We had the same problem. DMing you what we did.",
    "nvm figured it out, TTL hadn't expired",
  ])("counts %j as an answer", (text) => {
    expect(buildDigest(threadWith(text), weekStart).unanswered).toEqual([]);
  });

  it("counts a bot reply as an answer", () => {
    const [q, r] = threadWith("Thanks for your question!");
    expect(buildDigest([q, { ...r, subtype: "bot_message" }], weekStart).unanswered).toEqual([]);
  });

  it("still counts bumps toward topThreads", () => {
    const msgs = threadWith("bump", "bump");
    expect(buildDigest(msgs, weekStart).topThreads[0].repliesThisWeek).toBe(2);
  });

  it("only includes questions posted this week", () => {
    const msgs = [
      post(at(START - 1), "Last week?"),
      post(`${START}.000000`, "At start?"),
      post(`${END}.000000`, "At end?"),
    ];
    expect(buildDigest(msgs, weekStart).unanswered.map((q) => q.text)).toEqual(["At start?"]);
  });
});
