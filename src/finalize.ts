import { buildNotesDocx } from "./docx";
import { uploadNotesDocx } from "./drive";
import { filterDomainRecipients, sendNotesEmail } from "./email";
import type { MeetingNotes } from "./notes";
import { MeetingRecord, saveMeeting, unmarkPending } from "./store";

/**
 * Собирает .docx из заметок и кладёт на Drive как нативный Google Doc.
 * ИДЕМПОТЕНТНО: если документ уже залит (m.noteDocUrl) — повторно ничего не
 * делает. Сохраняет ссылку и английские поля (для письма) в запись.
 */
export async function uploadNotes(m: MeetingRecord, notes: MeetingNotes): Promise<string> {
  if (m.noteDocUrl) return m.noteDocUrl;
  const titleEn = (notes.title_en || m.title).trim();
  const date = m.startISO.slice(0, 10);
  const fileName = `${titleEn} - ${date}`;
  const docx = await buildNotesDocx(titleEn, m.startISO, notes, m.transcript ?? "");
  const url = await uploadNotesDocx(m.seriesName, fileName, docx);
  m.noteDocUrl = url;
  m.titleEn = titleEn;
  m.tldrEn = notes.tldr_en ?? [];
  await saveMeeting(m);
  return url;
}

/**
 * Шлёт письмо-карточку участникам с доменом компании. ИДЕМПОТЕНТНО: помечает
 * m.emailedAt, чтобы письмо ушло ровно один раз (даже если ретраим заметки).
 * Использует сохранённые titleEn/tldrEn — перегенерация заметок не нужна.
 */
export async function emailNotes(m: MeetingRecord): Promise<void> {
  if (m.emailedAt || !m.noteDocUrl) return;
  const recipients = filterDomainRecipients(m.attendees ?? []);
  if (recipients.length > 0) {
    await sendNotesEmail(recipients, m.titleEn || m.title, m.startISO, m.noteDocUrl, m.tldrEn ?? []);
  }
  m.emailedAt = new Date().toISOString(); // даже если получателей нет — шаг выполнен
  await saveMeeting(m);
}

/**
 * Полный финал в один заход (используется Vercel-путём /api/pending).
 * Локальный раннер ходит через uploadNotes/emailNotes по отдельности (с ретраями).
 */
export async function finalizeMeeting(m: MeetingRecord, notes: MeetingNotes): Promise<string> {
  const url = await uploadNotes(m, notes);
  if (process.env.NOTES_EMAIL === "true") {
    try {
      await emailNotes(m);
    } catch (e) {
      console.error(`notes email failed (non-fatal): ${e}`);
    }
  }
  m.status = "done";
  m.transcript = undefined;
  await saveMeeting(m);
  await unmarkPending(m.eventId);
  return url;
}
