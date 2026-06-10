/**
 * Сборка .docx из готовых заметок (JSON) + транскрипта — тем же кодом, что в проде.
 * Запуск: npx tsx scripts/make-docx.ts <notes.json> <transcript.txt> <title> <dateISO> <out.docx>
 */
import { readFileSync, writeFileSync } from "fs";
import { buildNotesDocx } from "../src/docx";
import type { MeetingNotes } from "../src/notes";

const [notesPath, transcriptPath, title, dateISO, outPath] = process.argv.slice(2);
const notes = JSON.parse(readFileSync(notesPath, "utf-8")) as MeetingNotes;
const transcript = readFileSync(transcriptPath, "utf-8");

buildNotesDocx(title, dateISO, notes, transcript).then((buf) => {
  writeFileSync(outPath, buf);
  console.log(`written: ${outPath} (${buf.length} bytes)`);
});
