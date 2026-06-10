import type { VercelRequest, VercelResponse } from "@vercel/node";
import { upcomingMeetings } from "../src/calendar";
import { finalizeMeeting } from "../src/finalize";
import { generateNotes } from "../src/notes";
import {
  getMeeting,
  listActive,
  markActive,
  markPending,
  MeetingRecord,
  saveMeeting,
  unmarkActive,
} from "../src/store";
import { getTranscript, requestBot, runningBots, stopBot } from "../src/vexa";

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.authorization === `Bearer ${secret}`) return true; // Vercel Cron
  if (req.query.secret === secret) return true; // внешний пингер
  return false;
}

/** Шаг 1: новые созвоны из календаря → отправить бота. */
async function dispatchBots(log: string[]): Promise<void> {
  const meetings = await upcomingMeetings();
  for (const m of meetings) {
    const existing = await getMeeting(m.eventId);
    if (existing) continue; // уже обработан/обрабатывается
    const record: MeetingRecord = {
      ...m,
      platform: "google_meet",
      status: "joining",
    };
    try {
      await requestBot(m.nativeId);
      await saveMeeting(record);
      await markActive(m.eventId);
      log.push(`bot sent: ${m.title} (${m.nativeId})`);
    } catch (e) {
      record.status = "failed";
      record.error = String(e);
      await saveMeeting(record);
      log.push(`bot FAILED: ${m.title}: ${e}`);
    }
  }
}

/** Шаг 2: активные созвоны → если закончились, забрать транскрипт и сделать заметки. */
async function collectFinished(log: string[]): Promise<void> {
  const active = await listActive();
  if (active.length === 0) return;
  const running = await runningBots();

  for (const eventId of active) {
    const m = await getMeeting(eventId);
    if (!m) {
      await unmarkActive(eventId);
      continue;
    }
    const now = Date.now();
    const endMs = Date.parse(m.endISO);
    const botRunning = running.has(m.nativeId);

    // страховка: встреча затянулась на 30+ минут сверх плана — останавливаем бота
    if (botRunning && now > endMs + 30 * 60_000) {
      await stopBot(m.nativeId);
      log.push(`bot force-stopped (overtime): ${m.title}`);
      continue; // транскрипт заберём на следующем тике
    }
    if (botRunning) continue; // созвон ещё идёт
    if (now < Date.parse(m.startISO) + 2 * 60_000) continue; // бот мог ещё не успеть зайти

    // бот вышел — созвон закончился (или бота не пустили)
    const transcript = await getTranscript(m.nativeId);
    if (!transcript) {
      m.status = "failed";
      m.error = "Транскрипт пуст: бота не впустили в звонок или никто не говорил";
      await saveMeeting(m);
      await unmarkActive(eventId);
      log.push(`no transcript: ${m.title}`);
      continue;
    }

    m.transcript = transcript;
    await unmarkActive(eventId);

    if (process.env.ANTHROPIC_API_KEY) {
      // Путь A: заметки прямо здесь через Claude Sonnet
      try {
        const notes = await generateNotes(m.title, m.startISO, transcript);
        const url = await finalizeMeeting(m, notes);
        log.push(`done: ${m.title} → ${url}`);
      } catch (e) {
        m.status = "awaiting_notes";
        m.error = `notes failed, queued for agent: ${e}`;
        await saveMeeting(m);
        await markPending(eventId);
        log.push(`notes failed, queued: ${m.title}: ${e}`);
      }
    } else {
      // Путь B: в очередь для scheduled-агента Claude Code (подписка)
      m.status = "awaiting_notes";
      await saveMeeting(m);
      await markPending(eventId);
      log.push(`queued for agent: ${m.title}`);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const log: string[] = [];
  try {
    await dispatchBots(log);
    await collectFinished(log);
    return res.status(200).json({ ok: true, log });
  } catch (e) {
    log.push(`tick error: ${e}`);
    return res.status(500).json({ ok: false, log, error: String(e) });
  }
}
