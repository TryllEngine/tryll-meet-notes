import Anthropic from "@anthropic-ai/sdk";

export interface MeetingNotes {
  language: string;
  tldr: string[];
  decisions: string[];
  action_items: Array<{ owner: string; task: string; due: string }>;
  open_questions: string[];
  summary: string;
}

export const NOTES_SYSTEM = `Ты — ассистент компании Tryll Engine, который пишет заметки по транскриптам созвонов.
Транскрипт получен автоматической транскрибацией: в нём бывают ошибки распознавания — аккуратно восстанавливай смысл по контексту, не выдумывая фактов.
Пиши заметки на том языке, на котором шёл созвон (если смешанный — на преобладающем).
Стиль: кратко, по делу, без воды. Action items формулируй как "кто → что → срок" (срок "—", если не назван).`;

export const NOTES_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", description: "Язык заметок, например ru или en" },
    tldr: { type: "array", items: { type: "string" }, description: "3-6 главных пунктов" },
    decisions: { type: "array", items: { type: "string" }, description: "Принятые решения" },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          owner: { type: "string" },
          task: { type: "string" },
          due: { type: "string" },
        },
        required: ["owner", "task", "due"],
        additionalProperties: false,
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
    summary: {
      type: "string",
      description: "Связный пересказ хода обсуждения на 2-5 абзацев с указанием, кто что предлагал",
    },
  },
  required: ["language", "tldr", "decisions", "action_items", "open_questions", "summary"],
  additionalProperties: false,
} as const;

export function notesUserPrompt(title: string, dateISO: string, transcript: string): string {
  return `Созвон: «${title}», дата: ${dateISO.slice(0, 10)}.\n\nТранскрипт (формат "Имя: реплика"):\n\n${transcript}`;
}

/** Путь A: прямой вызов Claude Sonnet через API. */
export async function generateNotes(
  title: string,
  dateISO: string,
  transcript: string,
): Promise<MeetingNotes> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: NOTES_SYSTEM,
    messages: [{ role: "user", content: notesUserPrompt(title, dateISO, transcript) }],
    output_config: { format: { type: "json_schema", schema: NOTES_SCHEMA } },
  });
  const msg = await stream.finalMessage();
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude вернул ответ без текста");
  return JSON.parse(text.text) as MeetingNotes;
}
