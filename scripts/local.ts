/**
 * Локальный раннер для теста без Vercel: крутит тик оркестратора каждые 30 секунд.
 * Запуск: npm run local (читает .env из корня проекта).
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname } from "path";
import { runTick } from "../src/core";

// Пульс: каждый ЗАВЕРШЁННЫЙ тик обновляет файл. По нему watchdog и meet-check
// понимают, жив ли раннер. Раньше судили по росту лога — оказалось ненадёжно:
// точки пишутся без перевода строки, Docker отдаёт их рывками (полка ~минуту,
// потом скачок), и короткое окно замера ловит ложное «не тикает». Ложный вердикт
// опасен: watchdog перезапустил бы раннер посреди мита.
const HEARTBEAT_FILE =
  process.env.HEARTBEAT_FILE ||
  `${dirname(process.env.STORE_FILE || "/data/store.json")}/heartbeat`;

// Пишем ИМЕННО epoch-секунды: возраст пульса тогда считается вычитанием в любом
// shell, без парсинга дат внутри контейнера.
function beat() {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Math.floor(Date.now() / 1000)), "utf-8");
  } catch {
    /* нет диска — не повод ронять тик */
  }
}

const INTERVAL_MS = 30_000;
// Сколько тик может законно длиться. Дольше — считаем, что заклинило: busy
// сбрасывается только в finally, до которого подвисший await не доходит, и тогда
// раннер молча умирает при живом контейнере (10.09.2026: встал на 2 часа и
// пропустил мит). Таймауты на запросы к Vexa это лечат в корне, а тут — сигнал.
const STUCK_MS = Number(process.env.TICK_STUCK_MIN || 5) * 60_000;
let busy = false;
let busySince = 0;
let stuckReported = false;

async function tick() {
  if (busy) {
    // Сообщаем РОВНО ОДИН раз: watchdog ловит зависший раннер по тому, что лог
    // перестал расти, — если сыпать это сообщение каждую минуту, лог будет расти
    // и уборщик решит, что раннер жив.
    if (!stuckReported && busySince && Date.now() - busySince > STUCK_MS) {
      stuckReported = true;
      const mins = Math.round((Date.now() - busySince) / 60_000);
      console.error(
        `\n[${new Date().toLocaleTimeString()}] ТИК ЗАВИС: выполняется ${mins} мин, ` +
          `новые тики не идут. Дальше лог не растёт — tryll-watchdog перезапустит раннер.`,
      );
    }
    return;
  }
  busy = true;
  busySince = Date.now();
  stuckReported = false;
  const log: string[] = [];
  const ts = new Date().toLocaleTimeString();
  try {
    await runTick(log);
    if (log.length > 0) {
      for (const line of log) console.log(`[${ts}] ${line}`);
    } else {
      process.stdout.write(".");
    }
  } catch (e) {
    console.error(`\n[${ts}] tick error:`, e);
  } finally {
    busy = false;
    busySince = 0;
    beat(); // тик дошёл до конца — значит раннер жив
  }
}

console.log("tryll-meet-notes local runner — тик каждые 30 сек, Ctrl+C для выхода");
console.log(`календарь: ${process.env.GOOGLE_CALENDAR_ID || "primary"}, Vexa: ${process.env.VEXA_BASE_URL}`);
void tick();
setInterval(tick, INTERVAL_MS);
