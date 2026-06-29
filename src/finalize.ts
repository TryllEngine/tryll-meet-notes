import { resolveSeriesFolder } from "./drive";
import { filterDomainRecipients, sendNotesEmail } from "./email";
import { createGeminiDoc } from "./gdocs";
import type { GeminiNotes } from "./notes-gemini";
import { MeetingRecord, saveMeeting, unmarkPending } from "./store";

/**
 * Создаёт Google Doc с заметками 1:1 в стиле «Notes by Gemini» (Docs API).
 * ИДЕМПОТЕНТНО: если документ уже создан (m.noteDocUrl) — повторно не делает.
 * Сохраняет ссылку + английские поля (для письма) в запись.
 */
export async function uploadNotes(m: MeetingRecord, notes: GeminiNotes): Promise<string> {
  if (m.noteDocUrl) return m.noteDocUrl;
  let folderId: string | null = null;
  try {
    folderId = await resolveSeriesFolder(m.seriesName);
  } catch {
    /* папка недоступна — док останется в My Drive */
  }
  const { url } = await createGeminiDoc({
    meeting: m.title,
    dateISO: m.startISO,
    notes,
    attendees: [...new Set(m.attendees ?? [])],
    eventUrl: `https://meet.google.com/${m.nativeId}`,
    folderId,
  });
  m.noteDocUrl = url;
  m.titleEn = m.title; // заметки на английском, заголовок = имя мита
  m.tldrEn = [notes.summary_intro, ...(notes.summary_sections ?? []).map((s) => s.heading)].filter(Boolean).slice(0, 6);
  await saveMeeting(m);
  return url;
}

/**
 * Шлёт письмо-карточку участникам с доменом компании. ИДЕМПОТЕНТНО: m.emailedAt —
 * одно письмо на мит. Использует сохранённые titleEn/tldrEn (перегенерация не нужна).
 */
export async function emailNotes(m: MeetingRecord): Promise<void> {
  if (m.emailedAt || !m.noteDocUrl) return;
  const recipients = filterDomainRecipients(m.attendees ?? []);
  if (recipients.length > 0) {
    await sendNotesEmail(recipients, m.titleEn || m.title, m.startISO, m.noteDocUrl, m.tldrEn ?? []);
  }
  m.emailedAt = new Date().toISOString();
  await saveMeeting(m);
}

/**
 * Полный финал в один заход (используется Vercel-путём /api/pending).
 * Локальный раннер ходит через uploadNotes/emailNotes по отдельности (с ретраями).
 */
export async function finalizeMeeting(m: MeetingRecord, notes: GeminiNotes): Promise<string> {
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
