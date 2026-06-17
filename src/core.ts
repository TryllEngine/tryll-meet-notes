import { upcomingMeetings } from "./calendar";
import { finalizeMeeting } from "./finalize";
import { generateNotes, MeetingNotes } from "./notes";
import { generateNotesViaCli } from "./notes-cli";
import {
  getMeeting,
  listActive,
  markActive,
  markPending,
  MeetingRecord,
  saveMeeting,
  unmarkActive,
} from "./store";
import { getTranscript, requestBot, runningBots, stopBot } from "./vexa";

/** Шаг 1: новые созвоны из календаря → отправить бота. */
async function dispatchBots(log: string[]): Promise<void> {
  const meetings = await upcomingMeetings();
  if (meetings.length === 0) return;

  // nativeId уже активных митов — общий мит из чужого календаря не дублируем
  const activeNative = new Set<string>();
  for (const id of await listActive()) {
    const rec = await getMeeting(id);
    if (rec) activeNative.add(rec.nativeId);
  }

  for (const m of meetings) {
    const existing = await getMeeting(m.eventId);
    if (existing) continue; // уже обработан/обрабатывается
    if (activeNative.has(m.nativeId)) continue; // бот уже в этом звонке
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
    const botRunning = running.has(m.nativeId);

    // Пока участники на месте — бот сам в звонке (выйдет по своей логике:
    // 1 мин в одиночестве / no_one_joined / 2ч max_bot_time). Принудительно
    // по расписанию НЕ выгоняем: мит может идти дольше запланированного времени.
    if (botRunning) {
      if (m.botGoneAtISO) {
        m.botGoneAtISO = undefined; // бот вернулся/мигнул статус — сброс грейса
        await saveMeeting(m);
      }
      continue; // созвон ещё идёт
    }
    if (now < Date.parse(m.startISO) + 2 * 60_000) continue; // бот мог ещё не успеть зайти

    // бот вышел: даём транскрипции 60 сек дообработать хвост аудио
    if (!m.botGoneAtISO) {
      m.botGoneAtISO = new Date(now).toISOString();
      await saveMeeting(m);
      continue;
    }
    if (now < Date.parse(m.botGoneAtISO) + 60_000) continue;

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

    // Режим заметок: cli (локальный Claude Code по подписке) | api (ANTHROPIC_API_KEY) | queue
    const mode =
      process.env.NOTES_MODE ?? (process.env.ANTHROPIC_API_KEY ? "api" : "queue");

    if (mode === "cli" || mode === "api") {
      try {
        const notes: MeetingNotes =
          mode === "cli"
            ? await generateNotesViaCli(m.title, m.startISO, transcript)
            : await generateNotes(m.title, m.startISO, transcript);
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

/** Один тик оркестратора: отправить ботов + собрать завершённые созвоны. */
export async function runTick(log: string[]): Promise<void> {
  await dispatchBots(log);
  await collectFinished(log);
}
