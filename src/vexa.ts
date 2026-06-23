/**
 * Клиент Vexa (https://github.com/Vexa-ai/vexa) — meeting bot API.
 * Работает и с Vexa Cloud (api.cloud.vexa.ai), и с self-hosted —
 * меняется только VEXA_BASE_URL.
 */

const base = () => (process.env.VEXA_BASE_URL ?? "").replace(/\/$/, "");

async function vexaFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.VEXA_API_KEY ?? "",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export async function requestBot(nativeId: string): Promise<void> {
  const body: Record<string, unknown> = {
    platform: "google_meet",
    native_meeting_id: nativeId,
    bot_name: process.env.BOT_NAME || "Tryll Notes Bot",
    // Таймауты (мс): сколько ждать впуска / при пустом мите / в одиночестве.
    // Бот заходит за 5 мин до старта (+~2 мин загрузка). Логика:
    //  • никто не зашёл за 10 мин (от захода) → выходит, транскрипта/заметок нет, слот свободен;
    //  • все вышли, бот остался один 3 мин → выходит, делает заметки, слот свободен;
    //  • как только зашёл ≥1 человек — запись начинается сразу (ожидание отменяется).
    // Счёт «один» — по присутствию участников (тайлы в Meet), а не по речи:
    // замьютились/выключили камеры — бот видит, что люди в комнате, и не уходит.
    automatic_leave: {
      max_wait_for_admission: 10 * 60_000, // 10 мин ждёт впуска
      no_one_joined_timeout: 10 * 60_000, // 10 мин если так никто и не зашёл → выходит, заметок нет
      max_time_left_alone: 3 * 60_000, // 3 мин если все вышли, а бот один → выходит и делает заметки
    },
  };
  // Логотип в виртуальной камере бота (требует патча cameraEnabled в meeting-api,
  // см. scripts/patch-vexa-camera.sh)
  if (process.env.BOT_AVATAR_URL) {
    body.default_avatar_url = process.env.BOT_AVATAR_URL;
  }
  // Authenticated-режим: бот заходит под доменным аккаунтом (socials@) и его
  // автоматически впускают без зала ожидания. Требует патча scripts/patch_vexa_auth.py
  // и профиля в vexa-lite:/master-profile. Если cookies не подойдут — бот сам
  // откатывается на анонимный "Ask to join" (см. join.ts), т.е. деградация мягкая.
  if (process.env.BOT_AUTHENTICATED === "true") {
    body.authenticated = true;
  }
  const res = await vexaFetch("/bots", {
    method: "POST",
    body: JSON.stringify(body),
  });
  // 409 = бот уже в этой встрече — для нас это успех
  if (!res.ok && res.status !== 409) {
    throw new Error(`Vexa requestBot ${res.status}: ${await res.text()}`);
  }
}

export async function stopBot(nativeId: string): Promise<void> {
  await vexaFetch(`/bots/google_meet/${nativeId}`, { method: "DELETE" });
}

interface BotStatusEntry {
  native_meeting_id?: string;
  meeting_id?: string;
  data?: { recordings?: Array<{ media_files?: Array<{ created_at?: string }> }> };
}

/**
 * Карта: native_meeting_id → epoch-мс последнего записанного аудио-чанка.
 * Ключи = боты, которых Vexa считает «в звонке». Значение — «свежесть» аудио:
 * живой бот пишет чанки даже в ПОЛНОЙ ТИШИНЕ, поэтому свежий чанк = бот реально
 * в мите (молчат — не значит ушли). Застывший чанк = бот вышел/завис, даже если
 * Vexa ещё держит его в статусе running (защита от ботов-призраков). 0 — чанков
 * ещё нет (бот только зашёл / запись не началась).
 */
export async function runningBots(): Promise<Map<string, number>> {
  const res = await vexaFetch("/bots/status");
  if (!res.ok) throw new Error(`Vexa runningBots ${res.status}`);
  const data = (await res.json()) as { running_bots?: BotStatusEntry[] };
  const out = new Map<string, number>();
  for (const b of data.running_bots ?? []) {
    const nid = b.native_meeting_id ?? b.meeting_id;
    if (!nid) continue;
    let latest = 0;
    for (const rec of b.data?.recordings ?? []) {
      for (const mf of rec.media_files ?? []) {
        const t = Date.parse(mf.created_at ?? "");
        if (!Number.isNaN(t) && t > latest) latest = t;
      }
    }
    out.set(nid, latest);
  }
  return out;
}

interface TranscriptSegment {
  speaker?: string | null;
  text?: string | null;
  absolute_start_time?: string | null;
}

/**
 * Транскрипт в виде текста "Имя: реплика" построчно.
 * Возвращает null, если транскрипта нет (бот не попал в звонок).
 */
export async function getTranscript(nativeId: string): Promise<string | null> {
  const res = await vexaFetch(`/transcripts/google_meet/${nativeId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Vexa getTranscript ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { segments?: TranscriptSegment[] };
  const segments = data.segments ?? [];
  if (segments.length === 0) return null;

  const lines: string[] = [];
  let prevSpeaker = "";
  for (const s of segments) {
    const text = (s.text ?? "").trim();
    if (!text) continue;
    const speaker = (s.speaker ?? "Unknown").trim();
    if (speaker === prevSpeaker && lines.length > 0) {
      lines[lines.length - 1] += ` ${text}`;
    } else {
      lines.push(`${speaker}: ${text}`);
      prevSpeaker = speaker;
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
