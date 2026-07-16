/**
 * Отправка письма по УЖЕ созданной заметке (без регенерации дока).
 * Берёт noteDocUrl/tldrEn/attendees из стора по STORE_KEY.
 * Запуск: STORE_KEY=<eventId> docker exec -w /app tryll-runner npx tsx scripts/send-note-email.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { sendNotesEmail, filterDomainRecipients } from "../src/email";

const STORE_KEY = process.env.STORE_KEY!;
const STORE = process.env.STORE_FILE || "/data/store.json";

async function main() {
  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const rec = store.meetings?.[STORE_KEY];
  if (!rec) throw new Error(`нет записи ${STORE_KEY}`);
  if (!rec.noteDocUrl) throw new Error("нет noteDocUrl — заметка не создана");
  const attendees = [...new Set((rec.attendees || []) as string[])];
  const recipients = filterDomainRecipients(attendees);
  console.log(`мит: ${rec.title} | док: ${rec.noteDocUrl}`);
  console.log(`шлю: ${recipients.join(", ")}`);
  await sendNotesEmail(recipients, rec.title, rec.startISO, rec.noteDocUrl, rec.tldrEn || []);
  console.log("ПИСЬМО ОТПРАВЛЕНО ✓");
}
main().catch(e => { console.error("ОШИБКА:", e?.message || e); process.exit(1); });
