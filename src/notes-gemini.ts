import { spawn } from "child_process";
import { TEAM_CONTEXT } from "./context";

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
    {"owner": "Person name (or 'The group')", "title": "Short action title (1-3 words)", "task": "One sentence: the concrete task"}
  ],
  "details": [
    {"topic": "Short topic title", "text": "A detailed paragraph (2-5 sentences) on this discussion point, who said what"}
  ]
}

Rules:
- 2-4 summary_sections, each a real theme from the call.
- decisions_aligned = things the team agreed on; decisions_open = things left undecided / to discuss. Either may be empty [].
- next_steps: concrete action items with an owner. Owner is a person's name from the transcript (or "The group").
- details: one bullet per distinct discussion topic, in chronological-ish order, like Gemini's "Details" section.
- Everything in English. Keep proper names/brands as-is.
- A CONTEXT block (company & team) is provided below ONLY to spell names/roles correctly and understand terms. Base ALL notes strictly on the transcript — never add facts that weren't said. Note: a participant literally named "Tryll Engine" is the recording bot, not a person — ignore it / never treat it as a speaker.`;

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
): Promise<GeminiNotes> {
  const prompt = `${INSTRUCTION}\n\n=== CONTEXT (reference only) ===\n${TEAM_CONTEXT}\n\n=== MEETING ===\nMeeting: «${title}», date: ${dateISO.slice(0, 10)}.\n\nTranscript (format "Name: line"):\n\n${transcript}`;
  const raw = await runClaude(prompt, 10 * 60_000);
  const idx = raw.indexOf('{"type":"result"');
  const jsonStart = idx >= 0 ? idx : raw.indexOf("{");
  if (jsonStart < 0) throw new Error(`claude CLI non-JSON: ${raw.slice(0, 300)}`);
  const env = JSON.parse(raw.slice(jsonStart)) as { is_error?: boolean; result?: string };
  if (env.is_error || !env.result) throw new Error(`claude CLI error: ${env.result ?? raw.slice(0, 300)}`);
  return JSON.parse(extractJson(env.result)) as GeminiNotes;
}
