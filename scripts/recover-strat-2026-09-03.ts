/**
 * Разовое восстановление заметки Strat Sync (2026-09-03).
 * Бот был выбит сторожем на 2-м часу (аудио встало), заметка ушла по неполному
 * транскрипту; после переотправки писала вторая сессия. Тут: склеиваем обе
 * сессии (683 + 686) в один транскрипт, отправляем старый куцый док в корзину,
 * собираем полную заметку и шлём письмо участникам домена.
 * Запуск: docker exec -w /app tryll-runner npx tsx scripts/recover-strat-2026-09-03.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { google } from "googleapis";
import { googleAuth } from "../src/google";
import { generateGeminiNotesViaCli } from "../src/notes-gemini";
import { createGeminiDoc } from "../src/gdocs";
import { sendNotesEmail, filterDomainRecipients } from "../src/email";
import { chooseNoteFolder } from "../src/folder-router";

const NATIVE = "fft-qtxv-bnw";
const STORE = process.env.STORE_FILE || "/data/store.json";
const GAP_NOTE = "[перерыв в записи ~12:55–13:15 CEST: бот был выбит и переотправлен]";

async function main() {
  // 1) склейка сегментов обеих сессий в «Спикер: реплика»
  const segs = JSON.parse(readFileSync("/tmp/strat2.json", "utf8")) as
    { meeting_id: number; s: string; t: string }[];
  const lines: string[] = [];
  let prev = "", prevMeeting = 0;
  for (const seg of segs) {
    const text = (seg.t || "").trim();
    if (!text) continue;
    if (prevMeeting && seg.meeting_id !== prevMeeting) { lines.push(GAP_NOTE); prev = ""; }
    prevMeeting = seg.meeting_id;
    const sp = (seg.s || "Unknown").trim();
    if (sp === prev && lines.length) lines[lines.length - 1] += " " + text;
    else { lines.push(`${sp}: ${text}`); prev = sp; }
  }
  const transcript = lines.join("\n");
  const bySession = segs.reduce((a: Record<number, number>, s) => (a[s.meeting_id] = (a[s.meeting_id] || 0) + 1, a), {});
  console.log(`сегментов по сессиям: ${JSON.stringify(bySession)}`);
  console.log(`транскрипт: ${lines.length} реплик, ${transcript.length} символов`);

  // 2) запись мита
  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const rec = (Object.values(store.meetings || {}) as any[])
    .find(m => m.nativeId === NATIVE && (m.startISO || "").startsWith("2026-09-03"));
  if (!rec) throw new Error("нет записи Strat Sync за 2026-09-03");
  const title = rec.title, dateISO = rec.startISO;
  const attendees = [...new Set((rec.attendees || []) as string[])];
  const recipients = filterDomainRecipients(attendees);
  console.log(`мит: ${title} | ${dateISO} | участников: ${attendees.length} | получателей: ${recipients.length}`);
  console.log(`получатели: ${recipients.join(", ")}`);
  console.log(`старый док: ${rec.noteDocUrl}`);

  const auth = googleAuth();
  const drive = google.drive({ version: "v3", auth });

  // 3) старый куцый док — В КОРЗИНУ (обратимо), чтобы имя освободилось
  if (rec.noteDocUrl) {
    const m = rec.noteDocUrl.match(/\/document\/d\/([^/]+)/);
    if (m) {
      try {
        await drive.files.update({ fileId: m[1], requestBody: { trashed: true }, supportsAllDrives: true, fields: "id" });
        console.log("старый док отправлен в корзину:", m[1]);
      } catch (e: any) { console.log("не смог убрать старый док (не критично):", e?.message); }
    }
  }

  // 4) полная заметка
  console.log("генерю заметку по полному транскрипту…");
  const notes = await generateGeminiNotesViaCli(title, dateISO, transcript, attendees);
  console.log(`заметка: summary ${notes.summary_sections?.length}, decisions ${(notes.decisions_aligned?.length || 0) + (notes.decisions_open?.length || 0)}, next ${notes.next_steps?.length}, details ${notes.details?.length}`);

  let folderId: string | null = null;
  try {
    const hint = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).join("; ");
    const c = await chooseNoteFolder(title, hint);
    folderId = c.folderId; console.log("папка:", c.reason);
  } catch (e: any) { console.log("роутер папок не сработал:", e?.message); }

  const { url } = await createGeminiDoc({
    meeting: title, dateISO, notes, attendees,
    eventUrl: `https://meet.google.com/${NATIVE}`, folderId, transcript,
  });
  console.log("НОВЫЙ ДОК:", url);

  // 5) письмо участникам домена
  const tldr = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).slice(0, 6);
  if (recipients.length > 0) {
    await sendNotesEmail(recipients, title, dateISO, url, tldr);
    console.log(`письмо отправлено: ${recipients.length} получателей`);
  } else {
    console.log("получателей нет — письмо не отправлено");
  }
  console.log("\nГОТОВО ✓  →  " + url);
}
main().catch(e => { console.error("ОШИБКА:", e?.message || e); process.exit(1); });
