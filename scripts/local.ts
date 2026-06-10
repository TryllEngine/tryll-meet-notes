/**
 * Локальный раннер для теста без Vercel: крутит тик оркестратора каждые 30 секунд.
 * Запуск: npm run local (читает .env из корня проекта).
 */
import "dotenv/config";
import { runTick } from "../src/core";

const INTERVAL_MS = 30_000;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
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
  }
}

console.log("tryll-meet-notes local runner — тик каждые 30 сек, Ctrl+C для выхода");
console.log(`календарь: ${process.env.GOOGLE_CALENDAR_ID || "primary"}, Vexa: ${process.env.VEXA_BASE_URL}`);
void tick();
setInterval(tick, INTERVAL_MS);
