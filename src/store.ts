import { Redis } from "@upstash/redis";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

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

// Файловый стор для локального/докер-запуска без Redis. КРИТИЧНО: переживает
// рестарт контейнера — иначе раннер забывает, какие миты уже обработаны, и
// шлёт ботов повторно (бот возвращается на мит после кика). Путь задаётся
// STORE_FILE (в docker-compose смонтирован volume на /data).
const STORE_FILE = process.env.STORE_FILE || "/data/store.json";
const memMeetings = new Map<string, MeetingRecord>();
const memSets = new Map<string, Set<string>>();
let fileBroken = false; // если диск недоступен — деградируем в чистую память

function loadFromDisk(): void {
  if (redis) return;
  try {
    if (!existsSync(STORE_FILE)) return;
    const raw = JSON.parse(readFileSync(STORE_FILE, "utf-8")) as {
      meetings?: Record<string, MeetingRecord>;
      sets?: Record<string, string[]>;
    };
    for (const [k, v] of Object.entries(raw.meetings ?? {})) memMeetings.set(k, v);
    for (const [k, arr] of Object.entries(raw.sets ?? {})) memSets.set(k, new Set(arr));
    console.log(
      `store: загружено ${memMeetings.size} митов из ${STORE_FILE}`,
    );
  } catch (e) {
    console.error(`store: не смог прочитать ${STORE_FILE}: ${e}`);
  }
}

function persistToDisk(): void {
  if (redis || fileBroken) return;
  try {
    const dir = dirname(STORE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const dump = {
      meetings: Object.fromEntries(memMeetings),
      sets: Object.fromEntries(
        [...memSets].map(([k, s]) => [k, [...s]]),
      ),
    };
    writeFileSync(STORE_FILE, JSON.stringify(dump), "utf-8");
  } catch (e) {
    fileBroken = true;
    console.error(`store: не смог записать ${STORE_FILE}, работаю в памяти: ${e}`);
  }
}

const memSet = (name: string) => {
  let s = memSets.get(name);
  if (!s) {
    s = new Set();
    memSets.set(name, s);
  }
  return s;
};

const key = (eventId: string) => `meeting:${eventId}`;

loadFromDisk(); // поднимаем сохранённое состояние при старте процесса

export async function getMeeting(eventId: string): Promise<MeetingRecord | null> {
  if (!redis) return memMeetings.get(eventId) ?? null;
  return (await redis.get<MeetingRecord>(key(eventId))) ?? null;
}

export async function saveMeeting(m: MeetingRecord): Promise<void> {
  if (!redis) {
    memMeetings.set(m.eventId, m);
    persistToDisk();
    return;
  }
  // храним 14 дней, чтобы dedup по eventId переживал повторные тики
  await redis.set(key(m.eventId), m, { ex: 14 * 24 * 3600 });
}

async function sadd(set: string, member: string): Promise<void> {
  if (!redis) {
    memSet(set).add(member);
    persistToDisk();
    return;
  }
  await redis.sadd(set, member);
}

async function srem(set: string, member: string): Promise<void> {
  if (!redis) {
    memSet(set).delete(member);
    persistToDisk();
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
