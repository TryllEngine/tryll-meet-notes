import { spawn } from "child_process";
import { teamContextForNotes } from "./context";

/**
 * Заметки в стиле «Notes by Gemini» — ВСЕГДА на английском, структура 1:1:
 * Summary (вступление + тематические под-секции), Decisions (Aligned / Needs
 * further discussion), Next steps ([Owner] Title: task), Details (Topic: text).
 * Генерится через Claude Code CLI (по подписке).
 */
export interface GeminiNotes {
  summary_intro: string;
  summary_sections: { heading: string; text: string }[];
  decisions_aligned: { title: string; desc: string }[];
  decisions_open: { title: string; desc: string }[];
  next_steps: { owner: string; title: string; task: string }[];
  details: { topic: string; text: string }[];
}

const INSTRUCTION = `You are a meeting-notes assistant for Tryll Engine. You receive an auto-transcript of a call (speaker-attributed, may contain ASR errors — recover meaning from context, never invent facts).

Write notes in ENGLISH ALWAYS, even if the meeting was in another language (translate). Match the style of Google "Notes by Gemini": concise, neutral, third-person, well-organized.

Return ONLY valid JSON (no markdown, no commentary), exactly this shape:
{
  "summary_intro": "1-2 sentence high-level overview of what the session covered",
  "summary_sections": [
    {"heading": "Short thematic heading (3-6 words)", "text": "1-3 sentence paragraph"}
  ],
  "decisions_aligned": [
    {"title": "Short decision title", "desc": "One sentence: what was agreed"}
  ],
  "decisions_open": [
    {"title": "Short topic title", "desc": "One sentence: what still needs discussion / is undecided"}
  ],
  "next_steps": [
    {"owner": "Exact transcript speaker label, 'The group', or 'Unassigned'", "title": "Short action title (1-3 words)", "task": "One sentence: the concrete task"}
  ],
  "details": [
    {"topic": "Short topic title", "text": "A detailed paragraph (2-5 sentences) on this discussion point, who said what"}
  ]
}

Rules:
- 2-4 summary_sections, each a real theme from the call.
- decisions_aligned = things the team agreed on; decisions_open = things left undecided / to discuss. Either may be empty [].
- next_steps: include concrete action items only. Copy an owner exactly from a speaker label only when the transcript explicitly assigns that task. Otherwise use "Unassigned". Never infer an owner from role, topic, calendar attendees, or company context.
- details: one bullet per distinct discussion topic, in chronological-ish order, like Gemini's "Details" section. Do not claim that a named person said something unless that exact name labels the source transcript line.
- Everything in English. Keep proper names/brands as-is.
- Speaker labels are immutable evidence supplied by the transcription pipeline. NEVER rename, merge, reconcile, expand, or replace a speaker label. "Sasha" must stay "Sasha"; do not turn it into a surname. "Unknown" must stay unattributed.
- A CONTEXT block is provided only for company terminology and spelling. It is NEVER identity evidence and must not be used to decide who spoke or owns an action. Base ALL notes strictly on the transcript. A participant literally named "Tryll Engine" is the recording bot, not a person — ignore it.
- A PARTICIPANTS list is reference metadata only. It is not evidence that someone spoke and must never be used to relabel a speaker or infer an action owner.`;

const TRANSCRIPT_LINE = /^(?:\[[^\]]+\]\s*)?([^:]{1,80}):\s*(.*)$/;

export function transcriptSpeakerLabels(transcript: string): string[] {
  const labels = new Map<string, string>();
  for (const raw of transcript.split(/\r?\n/)) {
    const match = raw.trim().match(TRANSCRIPT_LINE);
    if (!match) continue;
    const label = match[1].trim();
    const key = label.toLocaleLowerCase();
    if (!label || key === "unknown" || key === "tryll engine") continue;
    if (!labels.has(key)) labels.set(key, label);
  }
  return [...labels.values()];
}

/** Enforce the identity boundary even if the model ignores the prompt. */
export function enforceNoteIdentity(notes: GeminiNotes, transcript: string): GeminiNotes {
  const exactLabels = new Map(
    transcriptSpeakerLabels(transcript).map((label) => [label.toLocaleLowerCase(), label]),
  );
  const next_steps = (notes.next_steps ?? []).map((step) => {
    const owner = (step.owner ?? "").trim();
    const key = owner.toLocaleLowerCase();
    if (key === "the group") return { ...step, owner: "The group" };
    if (key === "unassigned" || !exactLabels.has(key)) return { ...step, owner: "Unassigned" };
    return { ...step, owner: exactLabels.get(key)! };
  });
  return { ...notes, next_steps };
}

export function buildNotesPrompt(
  title: string,
  dateISO: string,
  transcript: string,
  attendees: string[] = [],
): string {
  const people = attendees.length ? attendees.join(", ") : "(not provided)";
  const transcriptForNotes = transcript.replace(/^\[[^\]]+\]\s*/gm, "");
  return `${INSTRUCTION}\n\n=== CONTEXT (terminology only; NEVER identity evidence) ===\n${teamContextForNotes()}\n\n=== PARTICIPANTS (reference metadata only) ===\n${people}\n\n=== MEETING ===\nMeeting: «${title}», date: ${dateISO.slice(0, 10)}.\n\nTranscript (speaker labels are immutable):\n\n${transcriptForNotes}`;
}

function runClaude(stdinText: string, timeoutMs: number): Promise<string> {
  const model = process.env.NOTES_CLI_MODEL || "sonnet";
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timeout ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude CLI exit ${code}: ${err || out}`));
    });
    child.stdin.write(stdinText, "utf-8");
    child.stdin.end();
  });
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const s = body.indexOf("{");
  const e = body.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error(`нет JSON: ${text.slice(0, 300)}`);
  return body.slice(s, e + 1);
}

export async function generateGeminiNotesViaCli(
  title: string,
  dateISO: string,
  transcript: string,
  attendees: string[] = [],
): Promise<GeminiNotes> {
  const prompt = buildNotesPrompt(title, dateISO, transcript, attendees);
  const raw = await runClaude(prompt, 10 * 60_000);
  const idx = raw.indexOf('{"type":"result"');
  const jsonStart = idx >= 0 ? idx : raw.indexOf("{");
  if (jsonStart < 0) throw new Error(`claude CLI non-JSON: ${raw.slice(0, 300)}`);
  const env = JSON.parse(raw.slice(jsonStart)) as { is_error?: boolean; result?: string };
  if (env.is_error || !env.result) throw new Error(`claude CLI error: ${env.result ?? raw.slice(0, 300)}`);
  return enforceNoteIdentity(JSON.parse(extractJson(env.result)) as GeminiNotes, transcript);
}
