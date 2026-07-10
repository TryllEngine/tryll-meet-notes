import assert from "node:assert/strict";
import { buildNotesPrompt, enforceNoteIdentity, transcriptSpeakerLabels } from "../src/notes-gemini";
import { getTranscript } from "../src/vexa";

const transcript = [
  "[12:00:01–12:00:05] Sasha: I will send the deck.",
  "[12:00:03–12:00:06] Vova: I will review it.",
  "[12:00:07–12:00:08] Unknown: Yes.",
].join("\n");

assert.deepEqual(transcriptSpeakerLabels(transcript), ["Sasha", "Vova"]);

const prompt = buildNotesPrompt("Identity test", "2026-07-10T10:00:00Z", transcript, ["team@example.com"]);
assert.match(prompt, /speaker labels are immutable/i);
assert.doesNotMatch(prompt, /reconcile every speaker/i);
assert.doesNotMatch(prompt, /NAME DISAMBIGUATION/i);

const guarded = enforceNoteIdentity({
  summary_intro: "Test",
  summary_sections: [],
  decisions_aligned: [],
  decisions_open: [],
  next_steps: [
    { owner: "Sasha", title: "Send", task: "Send the deck" },
    { owner: "Sasha Glotov", title: "Guess", task: "Guessed surname" },
    { owner: "Artem", title: "Invent", task: "Not a transcript speaker" },
    { owner: "The group", title: "Group", task: "Review together" },
  ],
  details: [],
}, transcript);

assert.deepEqual(guarded.next_steps.map((step) => step.owner), [
  "Sasha",
  "Unassigned",
  "Unassigned",
  "The group",
]);

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    segments: [
      {
        speaker: "Sasha",
        text: "First turn",
        absolute_start_time: "2026-07-10T10:00:01Z",
        absolute_end_time: "2026-07-10T10:00:05Z",
      },
      {
        speaker: "Sasha",
        text: "Independent adjacent turn",
        absolute_start_time: "2026-07-10T10:00:03Z",
        absolute_end_time: "2026-07-10T10:00:06Z",
      },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const formatted = await getTranscript("test-meeting");
    assert.equal(formatted?.split("\n").length, 2, "adjacent equal labels must remain separate turns");
    assert.match(formatted ?? "", /12:00:01–12:00:05/);
    assert.match(formatted ?? "", /12:00:03–12:00:06/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("identity-preserving notes + transcript boundaries: PASS");
}

void main();
