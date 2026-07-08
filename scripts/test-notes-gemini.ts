/**
 * ТЕСТ нового вида заметок (1:1 Gemini, Docs API). Изолирован — раннер не трогает.
 * Берёт транскрипт реального мита из Vexa → генерит англ. заметки → создаёт
 * Google Doc → шлёт письмо ТОЛЬКО maksim@. Запуск (в контейнере раннера):
 *   docker exec tryll-runner npx tsx scripts/test-notes-gemini.ts [nativeId]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { getTranscript } from "../src/vexa";
import { generateGeminiNotesViaCli } from "../src/notes-gemini";
import { createGeminiDoc } from "../src/gdocs";
import { sendNotesEmail } from "../src/email";

const ONLY = "maksim.makevich@tryllengine.com";

function findRecord(nativeId: string): any {
  try {
    const d = JSON.parse(readFileSync(process.env.STORE_FILE || "/data/store.json", "utf-8"));
    return Object.values(d.meetings || {}).find((m: any) => m.nativeId === nativeId) || null;
  } catch {
    return null;
  }
}

async function main() {
  const nativeId = process.argv[2] || "yrx-wyav-avq";
  console.log(`тест: мит ${nativeId}`);
  const transcript = await getTranscript(nativeId);
  if (!transcript) {
    console.error("транскрипт пуст/недоступен в Vexa — укажи другой nativeId аргументом");
    process.exit(1);
  }
  console.log(`транскрипт: ${transcript.length} символов`);

  const rec = await findRecord(nativeId);
  const title = rec?.title || "Tryll Meeting";
  const dateISO = rec?.startISO || new Date().toISOString();
  const attendees = [...new Set(rec?.attendees || [])];

  console.log("генерю заметки (англ, gemini-структура)…");
  const notes = await generateGeminiNotesViaCli(title, dateISO, transcript, attendees);
  console.log(`секций summary: ${notes.summary_sections?.length}, decisions: ${(notes.decisions_aligned?.length||0)+(notes.decisions_open?.length||0)}, next: ${notes.next_steps?.length}, details: ${notes.details?.length}`);

  console.log("создаю Google Doc…");
  const { url } = await createGeminiDoc({
    meeting: title,
    dateISO,
    notes,
    attendees,
    eventUrl: `https://meet.google.com/${nativeId}`,
    folderId: process.env.DRIVE_ROOT_FOLDER_ID || null,
    transcript,
  });
  console.log("DOC:", url);

  const tldr = [notes.summary_intro, ...(notes.summary_sections || []).map((s) => s.heading)].filter(Boolean).slice(0, 6);
  console.log(`шлю письмо ТОЛЬКО ${ONLY}…`);
  await sendNotesEmail([ONLY], title, dateISO, url, tldr);
  console.log("письмо отправлено ✓");
}

main().catch((e) => {
  console.error("ОШИБКА:", e?.message || e);
  process.exit(1);
});
