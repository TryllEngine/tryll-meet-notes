// Дашборд-календарь Tryll Meet Notes (read-only + лёгкое управление).
// Изолирован: читает store.json раннера ТОЛЬКО на чтение + Google Calendar.
// Раннер/боты/vexa не модифицирует (управление = прямые вызовы Vexa REST).
import { createServer } from "http";
import { readFile, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT || 8090);
const STORE_FILE = process.env.STORE_FILE || "/data/store.json";
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || "tryllengine.com";
const VEXA_BASE = (process.env.VEXA_BASE_URL || "http://vexa-lite:8056").replace(/\/$/, "");
const VEXA_KEY = process.env.VEXA_API_KEY || "";
const BOT_AVATAR_URL = process.env.BOT_AVATAR_URL || "";
const BOT_NAME = process.env.BOT_NAME || "Tryll Notes Bot";

const MEET_RE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;

function calendarIds() {
  const multi = process.env.GOOGLE_CALENDAR_IDS;
  if (multi) return multi.split(",").map((s) => s.trim()).filter(Boolean);
  return [process.env.GOOGLE_CALENDAR_ID || "primary"];
}

function googleAuth() {
  const c = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  c.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return c;
}

function meetCode(ev) {
  const cands = [ev.hangoutLink, ...(ev.conferenceData?.entryPoints ?? []).map((e) => e.uri), ev.location, ev.description];
  for (const c of cands) {
    const m = (c || "").match(MEET_RE);
    if (m) return m[1];
  }
  return null;
}

const SKIP_FILE = process.env.SKIP_FILE || "/cmd/skip.json";
/** Скип-лист «бота не впускать» (общий с раннером файл). Объект eventId→{...}. */
function readSkip() {
  try { return JSON.parse(readFileSync(SKIP_FILE, "utf-8")) || {}; } catch { return {}; }
}
function writeSkip(obj) {
  const dir = dirname(SKIP_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SKIP_FILE, JSON.stringify(obj), "utf-8");
}

/** Читаем store.json раннера на чтение. Никогда не пишем. */
function readStore() {
  try {
    const raw = JSON.parse(readFileSync(STORE_FILE, "utf-8"));
    return raw.meetings || {};
  } catch {
    return {};
  }
}

/** native_meeting_id'ы ботов, что прямо сейчас в звонках (живые). */
async function liveBots() {
  try {
    const r = await fetch(`${VEXA_BASE}/bots/status`, { headers: { "X-API-Key": VEXA_KEY } });
    if (!r.ok) return new Set();
    const d = await r.json();
    return new Set((d.running_bots ?? []).map((b) => b.native_meeting_id ?? b.meeting_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Статус бота для мита: live / done / failed / skipped / pending / none. */
function botStatus(rec, isLive) {
  if (isLive) return "live";
  if (!rec) return "none";
  if (rec.status === "done") return "done";
  if (rec.status === "failed") return "failed";
  if (rec.status === "skipped") return "skipped";
  if (rec.status === "awaiting_notes" || rec.status === "joining") return "pending";
  return "none";
}

async function getMeetings(fromISO, toISO) {
  const cal = google.calendar({ version: "v3", auth: googleAuth() });
  const events = [];
  for (const calendarId of calendarIds()) {
    try {
      const res = await cal.events.list({
        calendarId,
        timeMin: fromISO,
        timeMax: toISO,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
      });
      events.push(...(res.data.items ?? []));
    } catch (e) {
      // нет доступа к календарю — не валим остальные
    }
  }
  const byEvent = readStore(); // ключ = eventId (уникален для каждой даты/повтора)
  const skip = readSkip();
  const live = await liveBots();
  const now = Date.now();

  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue; // пропускаем all-day
    if (ev.status === "cancelled") continue;
    const code = meetCode(ev);
    // дедуп по eventId: одна и та же встреча в нескольких календарях имеет общий
    // instance-id → схлопывается; РАЗНЫЕ дни recurring-мита (один Meet-код, но
    // разные eventId) — остаются (раньше дедуп по коду съедал ср/пт у Sync).
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const rec = byEvent[ev.id] || null; // строго по eventId — recurring с одним Meet-кодом не путаем
    const sMs = Date.parse(ev.start.dateTime), eMs = Date.parse(ev.end.dateTime);
    const happening = now >= sMs - 5 * 60000 && now <= eMs + 30 * 60000;
    const isLive = !!(code && happening && live.has(code)); // «идёт» только в окне мита
    const manualSkip = !!skip[ev.id];
    const attendees = (ev.attendees ?? [])
      .map((a) => a.email || "")
      .filter((e) => e && !e.endsWith(".calendar.google.com"));
    const organizer = ev.organizer?.email || ev.creator?.email || "";
    const external = organizer && !organizer.endsWith(`@${COMPANY_DOMAIN}`);
    out.push({
      id: ev.id,
      title: ev.summary || "Без названия",
      start: ev.start.dateTime,
      end: ev.end.dateTime,
      meetCode: code,
      meetUrl: code ? `https://meet.google.com/${code}` : null,
      organizer,
      externalOrganizer: !!external,
      attendees,
      botStatus: manualSkip ? "skipped" : botStatus(rec, isLive),
      manualSkip,
      noteUrl: rec?.noteDocUrl || null,
      error: rec?.error || null,
      hasTranscript: !!(rec?.transcript),
      norec: /\[norec\]/i.test(ev.summary || ""),
    });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : 1));
  return out;
}

/** Транскрипт мита из Vexa (для просмотра). */
async function getTranscript(code) {
  try {
    const r = await fetch(`${VEXA_BASE}/transcripts/google_meet/${code}`, { headers: { "X-API-Key": VEXA_KEY } });
    if (!r.ok) return null;
    const d = await r.json();
    const segs = d.segments ?? [];
    return segs.map((s) => `${(s.speaker || "?").trim()}: ${(s.text || "").trim()}`).filter((l) => l.length > 2).join("\n");
  } catch {
    return null;
  }
}

/** Переотправить бота на мит (прямой вызов Vexa, как делает раннер). */
async function redispatch(code) {
  const body = {
    platform: "google_meet",
    native_meeting_id: code,
    bot_name: BOT_NAME,
    automatic_leave: { max_wait_for_admission: 900000, no_one_joined_timeout: 900000, max_time_left_alone: 180000 },
  };
  if (BOT_AVATAR_URL) body.default_avatar_url = BOT_AVATAR_URL;
  if (process.env.BOT_AUTHENTICATED === "true") body.authenticated = true;
  const r = await fetch(`${VEXA_BASE}/bots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": VEXA_KEY },
    body: JSON.stringify(body),
  });
  return { ok: r.ok || r.status === 409, status: r.status };
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function body(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/meetings") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const data = await getMeetings(from, to);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(data));
    }
    if (url.pathname === "/api/transcript") {
      const tr = await getTranscript(url.searchParams.get("code"));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ transcript: tr }));
    }
    if (url.pathname === "/api/redispatch" && req.method === "POST") {
      const { code } = JSON.parse((await body(req)) || "{}");
      const r = await redispatch(code);
      res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(r));
    }
    if (url.pathname === "/api/skip" && req.method === "POST") {
      const { eventId, nativeId, title, code, on } = JSON.parse((await body(req)) || "{}");
      const s = readSkip();
      if (on) {
        s[eventId] = { nativeId: nativeId || null, title: title || "", ts: new Date().toISOString() };
        if (code) { try { await fetch(`${VEXA_BASE}/bots/google_meet/${code}`, { method: "DELETE", headers: { "X-API-Key": VEXA_KEY } }); } catch {} }
      } else {
        delete s[eventId];
      }
      writeSkip(s);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, on: !!on }));
    }
    // static
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(__dirname, "public", p);
    if (!file.startsWith(join(__dirname, "public"))) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => console.log(`dashboard на :${PORT}, store=${STORE_FILE}, календарей=${calendarIds().length}`));
