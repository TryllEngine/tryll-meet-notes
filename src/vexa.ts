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
    // Таймауты (мс): сколько ждать впуска / при пустом мите / в одиночестве
    automatic_leave: {
      max_wait_for_admission: 15 * 60_000, // 15 мин ждёт впуска из зала ожидания
      no_one_joined_timeout: 5 * 60_000, // 5 мин если в мите никого
      max_time_left_alone: 3 * 60_000, // 3 мин если все вышли, а бот один
    },
  };
  // Логотип в виртуальной камере бота (требует патча cameraEnabled в meeting-api,
  // см. scripts/patch-vexa-camera.sh)
  if (process.env.BOT_AVATAR_URL) {
    body.default_avatar_url = process.env.BOT_AVATAR_URL;
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

/** native_meeting_id всех ботов, которые сейчас в звонках */
export async function runningBots(): Promise<Set<string>> {
  const res = await vexaFetch("/bots/status");
  if (!res.ok) throw new Error(`Vexa runningBots ${res.status}`);
  const data = (await res.json()) as { running_bots?: Array<{ native_meeting_id?: string; meeting_id?: string }> };
  const ids = (data.running_bots ?? [])
    .map((b) => b.native_meeting_id ?? b.meeting_id)
    .filter((x): x is string => Boolean(x));
  return new Set(ids);
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
