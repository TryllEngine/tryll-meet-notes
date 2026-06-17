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

export async function buildNotesDocx(
  title: string,
  dateISO: string,
  notes: MeetingNotes,
  transcript: string,
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: `${title} - ${dateISO.slice(0, 10)}`, heading: HeadingLevel.HEADING_1 }),
  ];

  children.push(heading("TL;DR"));
  for (const t of notes.tldr) children.push(bullet(t));

  if (notes.decisions.length > 0) {
    children.push(heading("Решения"));
    for (const d of notes.decisions) children.push(bullet(d));
  }

  if (notes.action_items.length > 0) {
    children.push(heading("Action items"));
    for (const a of notes.action_items) {
      children.push(bullet(`${a.owner} → ${a.task}${a.due && a.due !== "—" ? ` (срок: ${a.due})` : ""}`));
    }
  }

  if (notes.open_questions.length > 0) {
    children.push(heading("Открытые вопросы"));
    for (const q of notes.open_questions) children.push(bullet(q));
  }

  children.push(heading("Ход обсуждения"));
  for (const para of notes.summary.split(/\n{2,}/)) {
    children.push(new Paragraph({ text: para.trim() }));
  }

  children.push(heading("Полный транскрипт"));
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
