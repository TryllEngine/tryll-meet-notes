import { google, calendar_v3 } from "googleapis";
import { googleAuth } from "./google";

export interface UpcomingMeeting {
  eventId: string;
  title: string;
  startISO: string;
  endISO: string;
  seriesKey: string;
  seriesName: string;
  nativeId: string; // google meet code: abc-defg-hij
}

const MEET_CODE_RE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;

function extractMeetCode(ev: calendar_v3.Schema$Event): string | null {
  const candidates: string[] = [];
  if (ev.hangoutLink) candidates.push(ev.hangoutLink);
  for (const ep of ev.conferenceData?.entryPoints ?? []) {
    if (ep.uri) candidates.push(ep.uri);
  }
  if (ev.location) candidates.push(ev.location);
  if (ev.description) candidates.push(ev.description);
  for (const c of candidates) {
    const m = c.match(MEET_CODE_RE);
    if (m) return m[1];
  }
  return null;
}

/**
 * События с Google Meet, начинающиеся в ближайшие `lookaheadMin` минут
 * (плюс уже начавшиеся не раньше, чем `lookbackMin` минут назад — на случай
 * пропущенного тика).
 */
export async function upcomingMeetings(
  lookbackMin = 10,
  lookaheadMin = 2,
): Promise<UpcomingMeeting[]> {
  const cal = google.calendar({ version: "v3", auth: googleAuth() });
  const now = Date.now();
  const res = await cal.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    timeMin: new Date(now - lookbackMin * 60_000).toISOString(),
    timeMax: new Date(now + lookaheadMin * 60_000).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });

  const out: UpcomingMeeting[] = [];
  for (const ev of res.data.items ?? []) {
    if (!ev.id || !ev.start?.dateTime || !ev.end?.dateTime) continue; // пропускаем all-day
    const title = ev.summary ?? "Без названия";
    if (/\[norec\]/i.test(title)) continue; // опт-аут из записи
    if (ev.status === "cancelled") continue;
    const nativeId = extractMeetCode(ev);
    if (!nativeId) continue; // нет ссылки на Meet — не созвон
    const startMs = Date.parse(ev.start.dateTime);
    // отправляем бота только когда старт уже в пределах одной минуты или встреча идёт
    if (startMs > now + 60_000) continue;
    out.push({
      eventId: ev.id,
      title,
      startISO: ev.start.dateTime,
      endISO: ev.end.dateTime,
      seriesKey: ev.recurringEventId ?? ev.id,
      seriesName: ev.recurringEventId ? title : "Разовые встречи",
      nativeId,
    });
  }
  return out;
}
