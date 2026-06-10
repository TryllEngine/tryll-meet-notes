/**
 * Демо пути C: заметки по транскрипту через локальный Claude Code CLI (подписка).
 * Запуск: npx tsx scripts/gen-notes-cli.ts <transcript.txt> <title> <dateISO> <out.json>
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { generateNotesViaCli } from "../src/notes-cli";

const [transcriptPath, title, dateISO, outPath] = process.argv.slice(2);
const transcript = readFileSync(transcriptPath, "utf-8");

console.log(`генерирую заметки через claude CLI (${transcript.length} символов транскрипта)...`);
generateNotesViaCli(title, dateISO, transcript).then((notes) => {
  writeFileSync(outPath, JSON.stringify(notes, null, 2), "utf-8");
  console.log(`written: ${outPath}`);
  console.log(`tldr: ${notes.tldr.length} | decisions: ${notes.decisions.length} | actions: ${notes.action_items.length}`);
});
