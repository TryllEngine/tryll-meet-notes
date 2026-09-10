/**
 * Локальный раннер для теста без Vercel: крутит тик оркестратора каждые 30 секунд.
 * Запуск: npm run local (читает .env из корня проекта).
 */
import "dotenv/config";
import { runTick } from "../src/core";

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
  }
}

console.log("tryll-meet-notes local runner — тик каждые 30 сек, Ctrl+C для выхода");
console.log(`календарь: ${process.env.GOOGLE_CALENDAR_ID || "primary"}, Vexa: ${process.env.VEXA_BASE_URL}`);
void tick();
setInterval(tick, INTERVAL_MS);
