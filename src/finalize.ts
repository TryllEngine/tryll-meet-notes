import { buildNotesDocx } from "./docx";
import { uploadNotesDocx } from "./drive";
import { filterDomainRecipients, sendNotesEmail } from "./email";
import type { MeetingNotes } from "./notes";
import { MeetingRecord, saveMeeting, unmarkPending } from "./store";

/** Собирает .docx из заметок и кладёт на Drive; помечает встречу done; шлёт письмо. */
export async function finalizeMeeting(
  m: MeetingRecord,
  notes: MeetingNotes,
): Promise<string> {
  // Имя файла ВСЕГДА на английском (title_en от Claude), тире обычное
  const titleEn = (notes.title_en || m.title).trim();
  const date = m.startISO.slice(0, 10);
  const fileName = `${titleEn} - ${date}`;
  const docx = await buildNotesDocx(titleEn, m.startISO, notes, m.transcript ?? "");
  const url = await uploadNotesDocx(m.seriesName, fileName, docx);
  m.status = "done";
  m.noteDocUrl = url;

  // Авто-рассылка заметок участникам с доменом компании (внешним — нет).
  // Включается NOTES_EMAIL=true. Письмо не критично: если упадёт — заметки уже на Drive.
  if (process.env.NOTES_EMAIL === "true") {
    try {
      const recipients = filterDomainRecipients(m.attendees ?? []);
      if (recipients.length > 0) {
        await sendNotesEmail(recipients, titleEn, m.startISO, url);
      }
    } catch (e) {
      console.error(`notes email failed (non-fatal): ${e}`);
    }
  }

  m.transcript = undefined; // не храним транскрипт в Redis после выгрузки
  await saveMeeting(m);
  await unmarkPending(m.eventId);
  return url;
}
