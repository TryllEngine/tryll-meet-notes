import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();

export type MeetingStatus =
  | "joining" // бот отправлен, созвон идёт
  | "awaiting_notes" // транскрипт получен, ждём заметки (путь B без API-ключа)
  | "done"
  | "failed";

export interface MeetingRecord {
  eventId: string;
  title: string;
  startISO: string;
  endISO: string;
  /** recurringEventId серии или сам eventId для разовых встреч */
  seriesKey: string;
  seriesName: string;
  platform: "google_meet";
  /** код встречи, например "abc-defg-hij" */
  nativeId: string;
  status: MeetingStatus;
  error?: string;
  transcript?: string;
  noteDocUrl?: string;
}

const ACTIVE = "meetings:active";
const PENDING = "meetings:pending";

const key = (eventId: string) => `meeting:${eventId}`;

export async function getMeeting(eventId: string): Promise<MeetingRecord | null> {
  return (await redis.get<MeetingRecord>(key(eventId))) ?? null;
}

export async function saveMeeting(m: MeetingRecord): Promise<void> {
  // храним 14 дней, чтобы dedup по eventId переживал повторные тики
  await redis.set(key(m.eventId), m, { ex: 14 * 24 * 3600 });
}

export async function markActive(eventId: string): Promise<void> {
  await redis.sadd(ACTIVE, eventId);
}

export async function unmarkActive(eventId: string): Promise<void> {
  await redis.srem(ACTIVE, eventId);
}

export async function listActive(): Promise<string[]> {
  return (await redis.smembers(ACTIVE)) as string[];
}

export async function markPending(eventId: string): Promise<void> {
  await redis.sadd(PENDING, eventId);
}

export async function unmarkPending(eventId: string): Promise<void> {
  await redis.srem(PENDING, eventId);
}

export async function listPending(): Promise<string[]> {
  return (await redis.smembers(PENDING)) as string[];
}
