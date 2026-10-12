/**
 * Заметка по ОДНОЙ сессии бота Vexa — для случаев, когда раннер её сам не
 * сделает: бота переотправляли руками на мит, который раннер уже закрыл
 * («часть 2»), или бот заходил в обход раннера.
 *
 * Мит (название, участники, дата) берётся из стора раннера по коду Meet,
 * транскрипт — из базы Vexa по номеру сессии. Письмо — участникам домена,
 * как у обычной заметки.
 *
 *   docker exec -w /app \
 *     -e NATIVE=nez-hgne-cfm -e SESSION=940 -e SUFFIX="часть 2" -e DATE=2026-10-12 \
 *     tryll-runner npx tsx scripts/note-from-session.ts
 *
 * Транскрипт сессии должен лежать в /tmp/session.json — выгрузка из vexa-postgres:
 *   copy (select json_agg(row_to_json(x)) from (select speaker as s, text as t
 *     from transcriptions where meeting_id=<SESSION> order by created_at, start_time) x)
 *   to '/tmp/session.json'
 * (раннер не имеет доступа к базе Vexa, поэтому файл подкладывается снаружи)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { generateGeminiNotesViaCli } from "../src/notes-gemini";
import { createGeminiDoc } from "../src/gdocs";
import { sendNotesEmail, filterDomainRecipients } from "../src/email";
import { chooseNoteFolder } from "../src/folder-router";

const NATIVE = process.env.NATIVE!;
const SESSION = process.env.SESSION || "?";
const SUFFIX = process.env.SUFFIX || "";
const DATE = process.env.DATE!; // YYYY-MM-DD — какой из митов серии брать
const STORE = process.env.STORE_FILE || "/data/store.json";
const NO_EMAIL = process.env.NO_EMAIL === "true";

async function main() {
  if (!NATIVE || !DATE) throw new Error("нужны NATIVE и DATE");

  const segs = JSON.parse(readFileSync("/tmp/session.json", "utf8")) as { s: string; t: string }[];
  const lines: string[] = [];
  let prev = "";
  for (const seg of segs ?? []) {
    const text = (seg.t || "").trim();
    if (!text) continue;
    const sp = (seg.s || "Unknown").trim();
    if (sp === prev && lines.length) lines[lines.length - 1] += " " + text;
    else { lines.push(`${sp}: ${text}`); prev = sp; }
  }
  if (!lines.length) throw new Error(`в сессии ${SESSION} нет реплик`);
  const transcript = lines.join("\n");
  console.log(`сессия ${SESSION}: ${segs.length} сегментов → ${lines.length} реплик, ${transcript.length} символов`);

  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const rec = (Object.values(store.meetings || {}) as any[])
    .find((m) => m.nativeId === NATIVE && (m.startISO || "").startsWith(DATE));
  if (!rec) throw new Error(`в сторе нет мита ${NATIVE} за ${DATE}`);
  const title = SUFFIX ? `${rec.title} — ${SUFFIX}` : rec.title;
  const dateISO = rec.startISO;
  const attendees = [...new Set((rec.attendees || []) as string[])];
  const recipients = filterDomainRecipients(attendees);
  console.log(`мит: ${title} | ${dateISO} | получателей: ${recipients.length}`);

  console.log("генерю заметку…");
  const notes = await generateGeminiNotesViaCli(title, dateISO, transcript, attendees);
  console.log(`заметка: summary ${notes.summary_sections?.length}, decisions ${(notes.decisions_aligned?.length || 0) + (notes.decisions_open?.length || 0)}, next ${notes.next_steps?.length}`);

  let folderId: string | null = null;
  try {
    const hint = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).join("; ");
    const c = await chooseNoteFolder(rec.title, hint);
    folderId = c.folderId; console.log("папка:", c.reason);
  } catch (e: any) { console.log("роутер папок не сработал:", e?.message); }

  const { url } = await createGeminiDoc({
    meeting: title, dateISO, notes, attendees,
    eventUrl: `https://meet.google.com/${NATIVE}`, folderId, transcript,
  });
  console.log("ДОК:", url);

  const tldr = [notes.summary_intro, ...(notes.summary_sections || []).map((s: any) => s.heading)].filter(Boolean).slice(0, 6);
  if (NO_EMAIL) console.log("NO_EMAIL=true — письмо не отправляю");
  else if (recipients.length) {
    await sendNotesEmail(recipients, title, dateISO, url, tldr);
    console.log(`письмо отправлено: ${recipients.join(", ")}`);
  } else console.log("получателей нет — письмо не отправлено");
  console.log("\nГОТОВО ✓  →  " + url);
}
main().catch((e) => { console.error("ОШИБКА:", e?.message || e); process.exit(1); });
