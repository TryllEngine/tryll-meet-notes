/**
 * Наблюдатель одного мита (для ручных запусков бота, без календаря):
 * ждёт, пока бот выйдет из звонка → транскрипт → заметки (Claude CLI) → .docx.
 * Запуск: npx tsx scripts/watch-meeting.ts <native_meeting_id> <title>
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { buildNotesDocx } from "../src/docx";
import { generateNotesViaCli } from "../src/notes-cli";
import { getTranscript, runningBots } from "../src/vexa";

const [nativeId, title] = process.argv.slice(2);
if (!nativeId || !title) {
  console.error("usage: tsx scripts/watch-meeting.ts <native_meeting_id> <title>");
  process.exit(1);
}

const POLL_MS = 30_000;
let seenRunning = false;
let processing = false;

async function poll(): Promise<void> {
  if (processing) return;
  const running = await runningBots();
  const inCall = running.has(nativeId);
  const ts = new Date().toLocaleTimeString();

  if (inCall) {
    if (!seenRunning) console.log(`[${ts}] бот в звонке ${nativeId}, жду окончания...`);
    seenRunning = true;
    return;
  }
  if (!seenRunning) {
    console.log(`[${ts}] бот ещё не в звонке (ждёт входа?), продолжаю ждать...`);
    return;
  }

  // бот был в звонке и вышел — мит окончен
  processing = true;
  console.log(`[${ts}] мит окончен, собираю транскрипт...`);
  const transcript = await getTranscript(nativeId);
  if (!transcript) {
    console.error("транскрипт пуст — нечего обрабатывать");
    process.exit(2);
  }
  const dateISO = new Date().toISOString();
  const name = `${title} — ${dateISO.slice(0, 10)}`;
  // в recordings/ — только готовые заметки; всё техническое — в recordings/tech/
  mkdirSync("recordings/tech", { recursive: true });
  writeFileSync(`recordings/tech/${name}.txt`, transcript, "utf-8");
  console.log(`транскрипт: recordings/tech/${name}.txt (${transcript.length} символов)`);

  console.log("генерирую заметки через claude CLI (подписка)...");
  const notes = await generateNotesViaCli(title, dateISO, transcript);
  writeFileSync(`recordings/tech/${name}.json`, JSON.stringify(notes, null, 2), "utf-8");

  const docx = await buildNotesDocx(title, dateISO, notes, transcript);
  writeFileSync(`recordings/${name}.docx`, docx);
  console.log(`ГОТОВО: recordings/${name}.docx`);
  process.exit(0);
}

console.log(`наблюдаю за митом ${nativeId} («${title}»), опрос каждые 30 сек`);
void poll();
setInterval(() => void poll().catch((e) => console.error("poll error:", e)), POLL_MS);
