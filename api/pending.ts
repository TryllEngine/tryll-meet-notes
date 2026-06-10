import type { VercelRequest, VercelResponse } from "@vercel/node";
import { finalizeMeeting } from "../src/finalize";
import type { MeetingNotes } from "../src/notes";
import { getMeeting, listPending } from "../src/store";

/**
 * Путь B (заметки по подписке Claude, без API-ключа):
 * scheduled-агент Claude Code периодически делает
 *   GET  /api/pending  → транскрипты, ждущие заметок
 *   POST /api/pending  { eventId, notes } → сервер сам соберёт .docx и зальёт на Drive
 */

function authorized(req: VercelRequest): boolean {
  const secret = process.env.AGENT_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (req.method === "GET") {
    const ids = await listPending();
    const items = [];
    for (const id of ids) {
      const m = await getMeeting(id);
      if (m?.status === "awaiting_notes" && m.transcript) {
        items.push({
          eventId: m.eventId,
          title: m.title,
          date: m.startISO.slice(0, 10),
          transcript: m.transcript,
        });
      }
    }
    return res.status(200).json({ items });
  }

  if (req.method === "POST") {
    const { eventId, notes } = (req.body ?? {}) as {
      eventId?: string;
      notes?: MeetingNotes;
    };
    if (!eventId || !notes) {
      return res.status(400).json({ error: "eventId and notes are required" });
    }
    const m = await getMeeting(eventId);
    if (!m || m.status !== "awaiting_notes") {
      return res.status(404).json({ error: "no awaiting meeting with this eventId" });
    }
    const url = await finalizeMeeting(m, notes);
    return res.status(200).json({ ok: true, url });
  }

  return res.status(405).json({ error: "method not allowed" });
}
