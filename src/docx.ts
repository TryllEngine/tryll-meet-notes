import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { MeetingNotes } from "./notes";

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 } });
}

// Заголовки разделов на языке заметок (тело документа — на языке мита).
const LABELS = {
  ru: {
    decisions: "Решения",
    actionItems: "Action items",
    openQuestions: "Открытые вопросы",
    discussion: "Ход обсуждения",
    transcript: "Полный транскрипт",
    due: "срок",
  },
  en: {
    decisions: "Decisions",
    actionItems: "Action items",
    openQuestions: "Open questions",
    discussion: "Discussion",
    transcript: "Full transcript",
    due: "due",
  },
} as const;

export async function buildNotesDocx(
  title: string,
  dateISO: string,
  notes: MeetingNotes,
  transcript: string,
): Promise<Buffer> {
  const L = (notes.language ?? "").toLowerCase().startsWith("ru") ? LABELS.ru : LABELS.en;
  const children: Paragraph[] = [
    new Paragraph({ text: `${title} - ${dateISO.slice(0, 10)}`, heading: HeadingLevel.HEADING_1 }),
  ];

  children.push(heading("TL;DR"));
  for (const t of notes.tldr) children.push(bullet(t));

  if (notes.decisions.length > 0) {
    children.push(heading(L.decisions));
    for (const d of notes.decisions) children.push(bullet(d));
  }

  if (notes.action_items.length > 0) {
    children.push(heading(L.actionItems));
    for (const a of notes.action_items) {
      children.push(bullet(`${a.owner} → ${a.task}${a.due && a.due !== "—" ? ` (${L.due}: ${a.due})` : ""}`));
    }
  }

  if (notes.open_questions.length > 0) {
    children.push(heading(L.openQuestions));
    for (const q of notes.open_questions) children.push(bullet(q));
  }

  children.push(heading(L.discussion));
  for (const para of notes.summary.split(/\n{2,}/)) {
    children.push(new Paragraph({ text: para.trim() }));
  }

  children.push(heading(L.transcript));
  for (const line of transcript.split("\n")) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: line, size: 18, color: "555555" })],
      }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
