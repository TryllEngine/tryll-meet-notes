import { upcomingMeetings } from "./calendar";
import { emailNotes, uploadNotes } from "./finalize";
import { generateNotes, MeetingNotes } from "./notes";
import { generateNotesViaCli } from "./notes-cli";
import {
  getMeeting,
  listActive,
  listPending,
  markActive,
  markPending,
  saveMeeting,
  unmarkActive,
  unmarkPending,
} from "./store";
import { getTranscript, requestBot, runningBots, stopBot } from "./vexa";

// Максимум одновременных ботов (слотов). По расчёту больше 3 митов разом не бывает.
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_BOTS || 3);
// Бот вышел: ждём, пока транскрипт перестанет расти (Whisper дообрабатывает хвост
// аудио), но не дольше этого потолка. Справится раньше — соберём раньше.
const WHISPER_MAX_GRACE_MS = Number(process.env.WHISPER_MAX_GRACE_MIN || 5) * 60_000;
// Анти-призрак №1: говорили, потом транскрипт замер на столько → мит кончился/бот
// завис. 10 мин полной тишины — это уже конец, а не пауза (живой мит растит
// транскрипт и идёт по ветке «растёт» выше, его это не трогает).
const STALL_MS = Number(process.env.STALL_MIN || 10) * 60_000;
// Анти-призрак №2: мит давно кончился по расписанию, а Vexa всё ещё держит бота
// «running» (реально вышел/завис) → раннер сам добивает бота и собирает заметки.
const FORCE_LEAVE_AFTER_END_MS = Number(process.env.FORCE_LEAVE_AFTER_END_MIN || 10) * 60_000;

// Момент запуска (пробуждения) раннера. У нас нет 24/7 сервера: включил ПК →
// поднял Docker → раннер ожил. Если в этот момент уже идёт мит, начавшийся ДО
// пробуждения и идущий дольше STARTUP_SKIP — бота не шлём (иначе он зайдёт под
// конец). На обычный поток не влияет: миты, начавшиеся ПОСЛЕ старта раннера,
// под это правило не попадают (startMs < RUNNER_STARTED_AT там ложно).
const RUNNER_STARTED_AT = Date.now();
const STARTUP_SKIP_MS = Number(process.env.STARTUP_SKIP_MIN || 5) * 60_000;
console.log(`runner проснулся: ${new Date(RUNNER_STARTED_AT).toISOString()} (пропуск митов, идущих >${STARTUP_SKIP_MS / 60_000} мин на момент старта)`);

const nowISO = () => new Date().toISOString();

/** Транскрипт без падения тика: Vexa моргнула → null, попробуем в следующий раз. */
async function safeTranscript(nativeId: string): Promise<string | null> {
  try {
    return await getTranscript(nativeId);
  } catch {
    return null;
  }
}

/** Занятые слоты: реально бегущие боты + миты, помеченные активными. */
async function usedSlots(running: Set<string>): Promise<Set<string>> {
  const used = new Set(running);
  for (const id of await listActive()) {
    const rec = await getMeeting(id);
    if (rec) used.add(rec.nativeId);
  }
  return used;
}

/** Шаг 1: новые созвоны из календаря → отправить бота (не больше MAX_CONCURRENT). */
async function dispatchBots(log: string[], running: Set<string>): Promise<void> {
  const meetings = await upcomingMeetings();
  if (meetings.length === 0) return;
  const used = await usedSlots(running);

  for (const m of meetings) {
    if (await getMeeting(m.eventId)) continue; // уже обработан/обрабатывается
    // Пробуждение раннера: мит уже шёл ДО старта раннера и идёт дольше порога →
    // не заходим (бот пришёл бы под конец). Помечаем skipped, чтобы не дёргать
    // повторно. Нормальные миты (начались после старта раннера) сюда не попадают.
    const startMs = Date.parse(m.startISO);
    if (startMs < RUNNER_STARTED_AT && Date.now() > startMs + STARTUP_SKIP_MS) {
      const ageMin = Math.round((Date.now() - startMs) / 60_000);
      await saveMeeting({
        ...m,
        platform: "google_meet",
        status: "skipped",
        error: `пропущен при пробуждении раннера: мит уже шёл ${ageMin} мин`,
      });
      log.push(`startup-skip (${ageMin} мин в мите): ${m.title}`);
      continue;
    }
    if (used.has(m.nativeId)) continue; // бот уже в этом звонке (общий мит)
    if (used.size >= MAX_CONCURRENT) {
      log.push(`slot full (${used.size}/${MAX_CONCURRENT}), отложен: ${m.title}`);
      continue; // лимит занят — повторим в следующий тик (мит ещё в окне календаря)
    }
    try {
      await requestBot(m.nativeId);
      // Запись сохраняем ТОЛЬКО после успешного запроса. Транзиентная ошибка
      // (сеть / Vexa перезапускается) НЕ маркируется навсегда — ретрай в след. тик.
      await saveMeeting({ ...m, platform: "google_meet", status: "joining" });
      await markActive(m.eventId);
      used.add(m.nativeId);
      log.push(`bot sent: ${m.title} (${m.nativeId})`);
    } catch (e) {
      log.push(`bot dispatch failed (retry next tick): ${m.title}: ${e}`);
    }
  }
}

/**
 * Шаг 2: следим за активными ботами. Пока транскрипт растёт — мит живой.
 * Замер/конец/кик/призрак → добиваем бота (если надо) и забираем транскрипт.
 * Гарантия отсутствия ботов-призраков: слот всегда освобождается.
 */
async function collectFinished(log: string[], running: Set<string>): Promise<void> {
  for (const eventId of await listActive()) {
    const m = await getMeeting(eventId);
    if (!m) {
      await unmarkActive(eventId);
      continue;
    }
    const now = Date.now();
    const startMs = Date.parse(m.startISO);
    const endMs = Date.parse(m.endISO);
    let botRunning = running.has(m.nativeId);

    if (botRunning) {
      const tr = await safeTranscript(m.nativeId);
      const len = tr ? tr.length : 0;
      if (len !== (m.lastTranscriptLen ?? -1)) {
        // транскрипт растёт → мит реально идёт (даже если дольше расписания)
        m.lastTranscriptLen = len;
        m.lastProgressAtISO = nowISO();
        if (m.botGoneAtISO) m.botGoneAtISO = undefined;
        await saveMeeting(m);
        continue;
      }
      // транскрипт не меняется — это пауза, конец мита или зависший бот-призрак
      const hadContent = len > 0;
      const stalledMs = now - Date.parse(m.lastProgressAtISO ?? nowISO());
      const ghostByStall = hadContent && stalledMs > STALL_MS; // поговорили → тишина → конец
      const ghostByEnd = now > endMs + FORCE_LEAVE_AFTER_END_MS; // расписание прошло, бот висит
      if (ghostByStall || ghostByEnd) {
        try {
          await stopBot(m.nativeId);
        } catch {
          /* уже мёртв — ок */
        }
        log.push(`force-stop (${ghostByStall ? "stalled" : "overrun"}): ${m.title}`);
        botRunning = false; // → собираем транскрипт ниже
      } else {
        continue; // короткая пауза в речи / мит ещё в расписании — ждём
      }
    }

    // бот не в звонке (вышел сам по таймауту / кикнули / форс-стоп выше)
    if (now < startMs + 2 * 60_000) continue; // мог ещё не успеть зайти

    if (!m.botGoneAtISO) {
      m.botGoneAtISO = nowISO();
      await saveMeeting(m);
      continue; // запускаем адаптивный грейс на дообработку Whisper
    }
    const elapsed = now - Date.parse(m.botGoneAtISO);
    const tr = await safeTranscript(m.nativeId);
    const len = tr ? tr.length : 0;
    if (elapsed < WHISPER_MAX_GRACE_MS && len !== (m.lastTranscriptLen ?? -1)) {
      m.lastTranscriptLen = len; // транскрипт ещё растёт — ждём (потолок 5 мин)
      await saveMeeting(m);
      continue;
    }

    // транскрипт стабилен (Whisper доделал) либо вышел потолок грейса — собираем
    if (!tr) {
      m.status = "failed";
      m.error = "Транскрипт пуст: бота не впустили или никто не говорил";
      await saveMeeting(m);
      await unmarkActive(eventId);
      log.push(`no transcript: ${m.title}`);
      continue;
    }
    m.transcript = tr;
    m.status = "awaiting_notes";
    await saveMeeting(m);
    await unmarkActive(eventId);
    await markPending(eventId); // заметки сделает processPending (с ретраями до успеха)
    log.push(`transcript captured → notes pending: ${m.title}`);
  }
}

/**
 * Шаг 3: для каждого мита с транскриптом — заметки → Drive → письмо.
 * Гарантия «1 мит = 1 заметка = 1 письмо»: ретраит до успеха, идемпотентно
 * (загрузка по m.noteDocUrl, письмо по m.emailedAt — повторно не делает).
 */
async function processPending(log: string[]): Promise<void> {
  const mode = process.env.NOTES_MODE ?? (process.env.ANTHROPIC_API_KEY ? "api" : "cli");
  for (const eventId of await listPending()) {
    const m = await getMeeting(eventId);
    if (!m || m.status === "done") {
      await unmarkPending(eventId);
      continue;
    }
    if (m.status !== "awaiting_notes" || !m.transcript) continue;
    try {
      if (!m.noteDocUrl) {
        const notes: MeetingNotes =
          mode === "api"
            ? await generateNotes(m.title, m.startISO, m.transcript)
            : await generateNotesViaCli(m.title, m.startISO, m.transcript);
        await uploadNotes(m, notes); // ставит noteDocUrl/titleEn/tldrEn, сохраняет
      }
      if (process.env.NOTES_EMAIL === "true" && !m.emailedAt) {
        await emailNotes(m); // ставит emailedAt, сохраняет
      }
      m.status = "done";
      m.transcript = undefined; // транскрипт после выгрузки не держим
      await saveMeeting(m);
      await unmarkPending(eventId);
      log.push(`done: ${m.title} → ${m.noteDocUrl}`);
    } catch (e) {
      // оставляем awaiting_notes + pending → следующий тик повторит (до успеха)
      log.push(`notes retry (will try again): ${m.title}: ${e}`);
    }
  }
}

/** Один тик оркестратора: отправить ботов + собрать завершённые + дожать заметки. */
export async function runTick(log: string[]): Promise<void> {
  const running = await runningBots();
  await dispatchBots(log, running);
  await collectFinished(log, running);
  await processPending(log);
}
