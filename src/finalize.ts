import { buildNotesDocx } from "./docx";
import { uploadNotesDocx } from "./drive";
import type { MeetingNotes } from "./notes";
import { MeetingRecord, saveMeeting, unmarkPending } from "./store";

/** Собирает .docx из заметок и кладёт на Drive; помечает встречу done. */
export async function finalizeMeeting(
  m: MeetingRecord,
  notes: MeetingNotes,
): Promise<string> {
  const fileName = `${m.title} — ${m.startISO.slice(0, 10)}`;
  const docx = await buildNotesDocx(m.title, m.startISO, notes, m.transcript ?? "");
  const url = await uploadNotesDocx(m.seriesName, fileName, docx);
  m.status = "done";
  m.noteDocUrl = url;
  m.transcript = undefined; // не храним транскрипт в Redis после выгрузки
  await saveMeeting(m);
  await unmarkPending(m.eventId);
  return url;
}
