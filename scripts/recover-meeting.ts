/**
 * Разовое восстановление заметки по миту, у которого транскрипт есть в БД Vexa,
 * но заметка не сгенерилась (стор завис на старом статусе — напр. failed из-за
 * прошлой пустой сессии того же native_id).
 *
 * Транскрипт заранее выгружен из БД в JSON [{s,t}] и лежит по TRANSCRIPT_FILE.
 * Запуск (без письма):
 *   TRANSCRIPT_FILE=/tmp/x.json STORE_KEY=<eventId> NATIVE=<native> \
 *     docker exec -w /app tryll-runner npx tsx scripts/recover-meeting.ts
 * С письмом — добавить аргумент 'send'.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { generateGeminiNotesViaCli } from "../src/notes-gemini";
import { createGeminiDoc } from "../src/gdocs";
import { sendNotesEmail, filterDomainRecipients } from "../src/email";
import { chooseNoteFolder } from "../src/folder-router";

const TRANSCRIPT_FILE = process.env.TRANSCRIPT_FILE!;
const STORE_KEY = process.env.STORE_KEY!;
const NATIVE = process.env.NATIVE!;
const STORE = process.env.STORE_FILE || "/data/store.json";

async function main() {
  // 1) транскрипт из выгрузки БД → "Спикер: реплика" (склейка подряд одного спикера)
  const segs = JSON.parse(readFileSync(TRANSCRIPT_FILE, "utf8")) as { s: string; t: string }[];
  const lines: string[] = []; let prev = "";
  for (const seg of segs) {
    const text = (seg.t || "").trim(); if (!text) continue;
    const sp = (seg.s || "Unknown").trim();
    if (sp === prev && lines.length) lines[lines.length - 1] += " " + text;
    else { lines.push(`${sp}: ${text}`); prev = sp; }
  }
  const transcript = lines.join("\n");
  console.log(`транскрипт: ${lines.length} реплик, ${transcript.length} символов`);

  // 2) запись из стора
  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const rec = store.meetings?.[STORE_KEY];
  if (!rec) throw new Error(`нет записи ${STORE_KEY} в сторе`);
  const title = rec.title, dateISO = rec.startISO;
  const attendees = [...new Set((rec.attendees || []) as string[])];
  console.log(`мит: ${title} | ${dateISO} | участников: ${attendees.length} | статус был: ${rec.status}`);

  // 3) генерим заметку (Sonnet 5)
  console.log("генерю заметку (Sonnet 5)…");
  const notes = await generateGeminiNotesViaCli(title, dateISO, transcript, attendees);
  console.log(`заметка: summary ${notes.summary_sections?.length}, decisions ${(notes.decisions_aligned?.length || 0) + (notes.decisions_open?.length || 0)}, next ${notes.next_steps?.length}, details ${notes.details?.length}`);

  // 4) док на Drive (с полным транскриптом; при сбое batchUpdate — без него)
  let folderId: string | null = null;
  try {
    const hint = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).join("; ");
    const c = await chooseNoteFolder(title, hint);
    folderId = c.folderId; console.log("папка (умный роутер):", c.reason);
  } catch {}
  let url: string;
  try {
    ({ url } = await createGeminiDoc({ meeting: title, dateISO, notes, attendees, eventUrl: `https://meet.google.com/${NATIVE}`, folderId, transcript }));
    console.log("ДОК (с транскриптом):", url);
  } catch (e: any) {
    console.log("док с транскриптом не собрался (", e?.message, ") → без транскрипта");
    ({ url } = await createGeminiDoc({ meeting: title, dateISO, notes, attendees, eventUrl: `https://meet.google.com/${NATIVE}`, folderId, transcript: null }));
    console.log("ДОК (без транскрипта):", url);
  }

  // 5) чиним стор: статус done, ссылка на док, снимаем ошибку (атомарно)
  rec.noteDocUrl = url;
  rec.status = "done";
  delete rec.error;
  rec.tldrEn = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).slice(0, 6);
  writeFileSync(STORE + ".tmp", JSON.stringify(store)); renameSync(STORE + ".tmp", STORE);
  console.log("стор обновлён (status→done, noteDocUrl→новый, error снят)");

  // 6) письмо — ТОЛЬКО с флагом 'send'
  const recipients = filterDomainRecipients(attendees);
  if (process.argv.includes("send")) {
    console.log("шлю письмо:", recipients.join(", "));
    await sendNotesEmail(recipients, title, dateISO, url, rec.tldrEn);
    console.log("ПИСЬМО ОТПРАВЛЕНО ✓");
  } else {
    console.log("ПИСЬМО НЕ ОТПРАВЛЕНО — сначала посмотри док ^^^");
    console.log("когда одобришь, отправлю сюда:", recipients.join(", "));
  }
}
main().catch(e => { console.error("ОШИБКА:", e?.message || e); process.exit(1); });
