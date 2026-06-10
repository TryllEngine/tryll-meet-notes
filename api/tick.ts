import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runTick } from "../src/core";

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.authorization === `Bearer ${secret}`) return true; // Vercel Cron
  if (req.query.secret === secret) return true; // внешний пингер
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const log: string[] = [];
  try {
    await runTick(log);
    return res.status(200).json({ ok: true, log });
  } catch (e) {
    log.push(`tick error: ${e}`);
    return res.status(500).json({ ok: false, log, error: String(e) });
  }
}
