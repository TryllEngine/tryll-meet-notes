import { upcomingMeetings } from "./calendar";
import { emailNotes, uploadNotes } from "./finalize";
import { generateGeminiNotesViaCli } from "./notes-gemini";
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
// Анти-призрак по ПРИСУТСТВИЮ, а не по тишине: пока бот пишет аудио-чанки (даже
// в полной тишине) — мит живой, не трогаем. Если чанки застыли на столько — бот
// реально вышел/завис (Vexa врёт running) → добиваем и собираем заметки.
const GHOST_NO_AUDIO_MS = Number(process.env.GHOST_NO_AUDIO_MIN || 3) * 60_000;
// Дальний предохранитель: бот живёт дольше любого реального мита (> его же лимита
// max_bot_time ~2ч) → точно зависший призрак, добиваем.
const HARD_MAX_MS = Number(process.env.HARD_MAX_MIN || 150) * 60_000;
// Бот упал на старте (Chrome/Xvfb гонка) и ни разу не зашёл → переотправляем
// столько раз, пока мит не кончился. Гонка при повторе почти всегда проходит.
const MAX_LAUNCH_RETRIES = Number(process.env.LAUNCH_RETRIES || 2);

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
async function usedSlots(running: Map<string, number>): Promise<Set<string>> {
  const used = new Set<string>(running.keys());
  for (const id of await listActive()) {
    const rec = await getMeeting(id);
    if (rec) used.add(rec.nativeId);
  }
  return used;
}

/** Шаг 1: новые созвоны из календаря → отправить бота (не больше MAX_CONCURRENT). */
async function dispatchBots(log: string[], running: Map<string, number>): Promise<void> {
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
async function collectFinished(log: string[], running: Map<string, number>): Promise<void> {
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
      // Транскрипт читаем только для адаптивного грейса (ниже). Решение «мит
      // живой или нет» принимаем по ПРИСУТСТВИЮ: пока бот пишет аудио-чанки —
      // люди в мите (даже если молчат), не трогаем. ТИШИНА НЕ ПОВОД ВЫХОДИТЬ.
      const tr = await safeTranscript(m.nativeId);
      const len = tr ? tr.length : 0;
      let changed = false;
      if (len !== (m.lastTranscriptLen ?? -1)) {
        m.lastTranscriptLen = len;
        m.lastProgressAtISO = nowISO();
        changed = true;
      }
      if (m.botGoneAtISO) {
        m.botGoneAtISO = undefined;
        changed = true;
      }
      if (!m.botSeenRunning) {
        m.botSeenRunning = true; // бот реально зашёл — это не «упал на старте»
        changed = true;
      }

      const lastAudioMs = running.get(m.nativeId) ?? 0;
      if (lastAudioMs > 0 && !m.everHadAudio) {
        m.everHadAudio = true; // бот реально писал аудио → не «упал на старте»
        changed = true;
      }
      const audioStale = lastAudioMs > 0 && now - lastAudioMs > GHOST_NO_AUDIO_MS; // бот-призрак
      const hardCap = now > startMs + HARD_MAX_MS; // дальний предохранитель
      if (audioStale || hardCap) {
        try {
          await stopBot(m.nativeId);
        } catch {
          /* уже мёртв — ок */
        }
        log.push(`force-stop (${audioStale ? "no audio — ghost" : "hard cap"}): ${m.title}`);
        botRunning = false; // → собираем транскрипт ниже
      } else {
        if (changed) await saveMeeting(m);
        continue; // бот пишет аудио → мит живой (даже в тишине), ждём
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
      // Бот ни разу не дал аудио и транскрипта нет → почти наверняка упал на
      // старте (гонка Chrome/Xvfb). Переотправляем, пока мит не кончился.
      // (Аудио — надёжнее «running»: упавший контейнер Vexa на миг метит running,
      // а аудио-чанков у него нет; живой бот пишет аудио даже в тишине.)
      if (!m.everHadAudio && (m.launchRetries ?? 0) < MAX_LAUNCH_RETRIES && now < endMs) {
        try {
          await requestBot(m.nativeId);
          m.launchRetries = (m.launchRetries ?? 0) + 1;
          m.botGoneAtISO = undefined;
          m.lastTranscriptLen = undefined;
          await saveMeeting(m); // статус остаётся joining, мит остаётся active
          log.push(`launch retry #${m.launchRetries} (бот упал на старте): ${m.title}`);
        } catch (e) {
          log.push(`launch retry failed: ${m.title}: ${e}`);
        }
        continue;
      }
      m.status = "failed";
      m.error = "Транскрипт пуст: бота не впустили / упал на старте / никто не говорил";
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
  for (const eventId of await listPending()) {
    const m = await getMeeting(eventId);
    if (!m || m.status === "done") {
      await unmarkPending(eventId);
      continue;
    }
    if (m.status !== "awaiting_notes" || !m.transcript) continue;
    try {
      if (!m.noteDocUrl) {
        // англ. заметки 1:1 в стиле Gemini → нативный Google Doc (Docs API)
        const notes = await generateGeminiNotesViaCli(m.title, m.startISO, m.transcript);
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
