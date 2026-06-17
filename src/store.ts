import { Redis } from "@upstash/redis";

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
  /** когда заметили, что бот вышел из звонка (грейс перед сбором транскрипта) */
  botGoneAtISO?: string;
  /** email-адреса приглашённых (для рассылки заметок участникам домена) */
  attendees?: string[];
}

const ACTIVE = "meetings:active";
const PENDING = "meetings:pending";

const hasRedis = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = hasRedis ? Redis.fromEnv() : null;

// In-memory fallback для локального запуска (scripts/local.ts):
// живёт, пока жив процесс — для прод-деплоя на Vercel нужен Upstash.
const memMeetings = new Map<string, MeetingRecord>();
const memSets = new Map<string, Set<string>>();
const memSet = (name: string) => {
  let s = memSets.get(name);
  if (!s) {
    s = new Set();
    memSets.set(name, s);
  }
  return s;
};

const key = (eventId: string) => `meeting:${eventId}`;

export async function getMeeting(eventId: string): Promise<MeetingRecord | null> {
  if (!redis) return memMeetings.get(eventId) ?? null;
  return (await redis.get<MeetingRecord>(key(eventId))) ?? null;
}

export async function saveMeeting(m: MeetingRecord): Promise<void> {
  if (!redis) {
    memMeetings.set(m.eventId, m);
    return;
  }
  // храним 14 дней, чтобы dedup по eventId переживал повторные тики
  await redis.set(key(m.eventId), m, { ex: 14 * 24 * 3600 });
}

async function sadd(set: string, member: string): Promise<void> {
  if (!redis) {
    memSet(set).add(member);
    return;
  }
  await redis.sadd(set, member);
}

async function srem(set: string, member: string): Promise<void> {
  if (!redis) {
    memSet(set).delete(member);
    return;
  }
  await redis.srem(set, member);
}

async function smembers(set: string): Promise<string[]> {
  if (!redis) return [...memSet(set)];
  return (await redis.smembers(set)) as string[];
}

export const markActive = (id: string) => sadd(ACTIVE, id);
export const unmarkActive = (id: string) => srem(ACTIVE, id);
export const listActive = () => smembers(ACTIVE);
export const markPending = (id: string) => sadd(PENDING, id);
export const unmarkPending = (id: string) => srem(PENDING, id);
export const listPending = () => smembers(PENDING);
