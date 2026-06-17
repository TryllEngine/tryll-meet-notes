/**
 * Тест письма-сводки: шлёт ТОЛЬКО тебе (maksim@) пример по последнему миту,
 * чтобы посмотреть вёрстку и подпись. Реальную рассылку участникам не трогает.
 * Запуск: npx tsx scripts/send-test-email.ts
 */
import "dotenv/config";
import { sendNotesEmail } from "../src/email";

const TO = process.env.NOTES_EMAIL_FROM || "maksim.makevich@tryllengine.com";
const title = "test";
const dateISO = "2026-06-17";
const docUrl = "https://drive.google.com/file/d/1rdBT_RQ_HWer8s6COLmWmL-cku7FoAQ9/view";

sendNotesEmail([TO], title, dateISO, docUrl)
  .then(() => console.log(`тестовое письмо отправлено на ${TO}`))
  .catch((e) => {
    console.error("FAIL:", e.message ?? e);
    process.exit(1);
  });
