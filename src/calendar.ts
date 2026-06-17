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
  attendees: string[]; // email-адреса приглашённых (для рассылки заметок)
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

/** Календари для трекинга: GOOGLE_CALENDAR_IDS=primary,kollega@firma.com (через запятую) */
function calendarIds(): string[] {
  const multi = process.env.GOOGLE_CALENDAR_IDS;
  if (multi) {
    return multi
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [process.env.GOOGLE_CALENDAR_ID || "primary"];
}

/**
 * События с Google Meet по всем отслеживаемым календарям, начинающиеся
 * в ближайшие `lookaheadMin` минут (плюс уже начавшиеся не раньше, чем
 * `lookbackMin` минут назад — на случай пропущенного тика).
 * Общие миты дедуплицируются по коду Meet-ссылки — бот зайдёт один раз.
 */
export async function upcomingMeetings(
  lookbackMin = 12,
  lookaheadMin = 7,
): Promise<UpcomingMeeting[]> {
  const cal = google.calendar({ version: "v3", auth: googleAuth() });
  const now = Date.now();

  const items: calendar_v3.Schema$Event[] = [];
  for (const calendarId of calendarIds()) {
    try {
      const res = await cal.events.list({
        calendarId,
        timeMin: new Date(now - lookbackMin * 60_000).toISOString(),
        timeMax: new Date(now + lookaheadMin * 60_000).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 20,
      });
      items.push(...(res.data.items ?? []));
    } catch (e) {
      // нет доступа к чужому календарю и т.п. — не валим остальные
      console.error(`calendar ${calendarId} недоступен: ${e}`);
    }
  }

  const seenNative = new Set<string>();
  const out: UpcomingMeeting[] = [];
  for (const ev of items) {
    if (!ev.id || !ev.start?.dateTime || !ev.end?.dateTime) continue; // пропускаем all-day
    const title = ev.summary ?? "Без названия";
    if (/\[norec\]/i.test(title)) continue; // опт-аут из записи
    if (ev.status === "cancelled") continue;
    const nativeId = extractMeetCode(ev);
    if (!nativeId) continue; // нет ссылки на Meet — не созвон
    const startMs = Date.parse(ev.start.dateTime);
    // отправляем бота за 5 минут до старта (Chrome грузится небыстро) — бот
    // встаёт в зал ожидания заранее и ждёт впуска до 15 мин (см. vexa.ts:
    // max_wait_for_admission). Итого окно впуска: 5 мин до старта + 10 мин после.
    if (now < startMs - 5 * 60_000) continue;
    if (seenNative.has(nativeId)) continue; // общий мит двух календарей — один бот
    seenNative.add(nativeId);
    const attendees = (ev.attendees ?? [])
      .map((a) => a.email ?? "")
      .filter((e) => e && !e.endsWith(".calendar.google.com")); // исключаем room-ресурсы
    out.push({
      eventId: ev.id,
      title,
      startISO: ev.start.dateTime,
      endISO: ev.end.dateTime,
      seriesKey: ev.recurringEventId ?? ev.id,
      seriesName: ev.recurringEventId ? title : "Разовые встречи",
      nativeId,
      attendees,
    });
  }
  return out;
}
