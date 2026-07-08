import { google } from "googleapis";
import { googleAuth } from "./google";
import type { GeminiNotes } from "./notes-gemini";

/**
 * Рендер заметок как Google Doc 1:1 со стилем «Notes by Gemini» (Docs API).
 * Значения стилей сняты с реального дока Gemini (namedStyles): шрифт Google Sans
 * Flex Normal, HEADING_2 32pt (имя мита), HEADING_3 20pt (секции), SUBTITLE 14pt
 * (под-группы), тело 12pt; Next steps — чекбоксы; Decisions/Details — буллеты ●.
 */

const FONT = "Google Sans Flex Normal";
function rgb(hex: string) {
  const h = hex.replace("#", "");
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
}
const C = { ink: "#1f1f1f", body: "#303030", muted: "#5f6368", faint: "#9aa0a6", link: "#1a73e8", pill: "#e8eaed", dateBg: "#d2e3fc", dateInk: "#174ea6" };

interface Run { text: string; bold?: boolean; italic?: boolean; size?: number; color?: string; bg?: string; link?: string }
interface ParaOpt { spaceBefore?: number; spaceAfter?: number; named?: string; bullet?: "disc" | "checkbox" }

class DocBuilder {
  buf = "";
  textReq: any[] = [];
  paraReq: any[] = [];
  discReq: any[] = [];
  checkReq: any[] = [];

  line(runs: Run[], opt: ParaOpt = {}) {
    const paraStart = this.buf.length;
    for (const r of runs) {
      const s = this.buf.length;
      this.buf += r.text;
      const e = this.buf.length;
      const ts: any = {}; const f: string[] = [];
      if (r.bold !== undefined) { ts.bold = r.bold; f.push("bold"); }
      if (r.italic) { ts.italic = true; f.push("italic"); }
      if (r.size) { ts.fontSize = { magnitude: r.size, unit: "PT" }; f.push("fontSize"); }
      if (r.color) { ts.foregroundColor = { color: { rgbColor: rgb(r.color) } }; f.push("foregroundColor"); }
      if (r.bg) { ts.backgroundColor = { color: { rgbColor: rgb(r.bg) } }; f.push("backgroundColor"); }
      if (r.link) { ts.link = { url: r.link }; f.push("link"); }
      if (f.length) this.textReq.push({ updateTextStyle: { range: { startIndex: s + 1, endIndex: e + 1 }, textStyle: ts, fields: f.join(",") } });
    }
    this.buf += "\n";
    const paraEnd = this.buf.length;
    const range = { startIndex: paraStart + 1, endIndex: paraEnd + 1 };
    const ps: any = {}; const pf: string[] = [];
    if (opt.named) { ps.namedStyleType = opt.named; pf.push("namedStyleType"); }
    if (opt.spaceBefore !== undefined) { ps.spaceAbove = { magnitude: opt.spaceBefore, unit: "PT" }; pf.push("spaceAbove"); }
    if (opt.spaceAfter !== undefined) { ps.spaceBelow = { magnitude: opt.spaceAfter, unit: "PT" }; pf.push("spaceBelow"); }
    if (pf.length) this.paraReq.push({ updateParagraphStyle: { range, paragraphStyle: ps, fields: pf.join(",") } });
    if (opt.bullet === "disc") this.discReq.push({ createParagraphBullets: { range, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
    if (opt.bullet === "checkbox") this.checkReq.push({ createParagraphBullets: { range, bulletPreset: "BULLET_CHECKBOX" } });
  }

  requests() {
    return [
      { insertText: { location: { index: 1 }, text: this.buf } },
      ...this.discReq,
      ...this.checkReq,
      ...this.paraReq,
      { updateTextStyle: { range: { startIndex: 1, endIndex: this.buf.length + 1 }, textStyle: { weightedFontFamily: { fontFamily: FONT } }, fields: "weightedFontFamily" } },
      ...this.textReq,
    ];
  }
}

export function docTitle(meeting: string, dateISO: string): string {
  const d = new Date(dateISO);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "/");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "CEST";
  return `${meeting} - ${date} ${time} ${tz} - Notes by Tryll`;
}

function dateLabel(dateISO: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", month: "short", day: "numeric", year: "numeric" }).format(new Date(dateISO));
}

export async function createGeminiDoc(opts: {
  meeting: string; dateISO: string; notes: GeminiNotes; attendees: string[]; eventUrl?: string | null; folderId?: string | null; transcript?: string | null;
}): Promise<{ url: string; id: string }> {
  const auth = googleAuth();
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });
  const n = opts.notes;
  const b = new DocBuilder();
  const H3 = { named: "HEADING_3", spaceBefore: 16, spaceAfter: 8 } as ParaOpt;

  // дата-чип (NORMAL_TEXT с голубой заливкой, как у Gemini)
  b.line([{ text: ` ${dateLabel(opts.dateISO)} `, size: 11, color: C.dateInk, bg: C.dateBg }], { spaceAfter: 2 });
  // имя мита — HEADING_2 32pt bold
  b.line([{ text: opts.meeting, size: 32, bold: true, color: C.ink }], { named: "HEADING_2", spaceBefore: 6, spaceAfter: 14 });
  // Invited + серые пилюли
  if (opts.attendees.length) {
    const inv: Run[] = [{ text: "Invited  ", size: 11, color: C.muted }];
    for (const a of opts.attendees) { inv.push({ text: ` ${a} `, size: 11, color: C.body, bg: C.pill }); inv.push({ text: "  ", size: 11 }); }
    b.line(inv, { spaceAfter: 4 });
  }
  // Attachments — ссылка-чип
  if (opts.eventUrl) b.line([{ text: "Attachments  ", size: 11, color: C.muted }, { text: `📅 ${opts.meeting}`, size: 11, color: C.link, bg: C.pill, link: opts.eventUrl }], { spaceAfter: 4 });

  // Summary
  b.line([{ text: "Summary", size: 20, bold: true, color: C.ink }], H3);
  if (n.summary_intro) b.line([{ text: n.summary_intro, size: 12, color: C.body }], { spaceAfter: 6 });
  for (const s of n.summary_sections || []) {
    b.line([{ text: s.heading, size: 12, bold: true, color: C.ink }], { spaceBefore: 6, spaceAfter: 2 });
    b.line([{ text: s.text, size: 12, color: C.body }], { spaceAfter: 4 });
  }

  // Decisions (буллеты ●, жирный лид)
  if ((n.decisions_aligned?.length || 0) + (n.decisions_open?.length || 0) > 0) {
    b.line([{ text: "Decisions", size: 20, bold: true, color: C.ink }], H3);
    if (n.decisions_aligned?.length) {
      b.line([{ text: "Aligned", size: 14, bold: true, color: C.body }], { named: "SUBTITLE", spaceBefore: 4, spaceAfter: 2 });
      for (const d of n.decisions_aligned) b.line([{ text: `${d.title} `, size: 12, bold: true, color: C.ink }, { text: d.desc, size: 12, color: C.body }], { bullet: "disc" });
    }
    if (n.decisions_open?.length) {
      b.line([{ text: "Needs further discussion", size: 14, bold: true, color: C.body }], { named: "SUBTITLE", spaceBefore: 8, spaceAfter: 2 });
      for (const d of n.decisions_open) b.line([{ text: `${d.title} `, size: 12, bold: true, color: C.ink }, { text: d.desc, size: 12, color: C.body }], { bullet: "disc" });
    }
  }

  // Next steps (ЧЕКБОКСЫ, текст не жирный)
  if (n.next_steps?.length) {
    b.line([{ text: "Next steps", size: 20, bold: true, color: C.ink }], H3);
    for (const s of n.next_steps) b.line([{ text: `[${s.owner}] ${s.title}: ${s.task}`, size: 12, color: C.body }], { bullet: "checkbox" });
  }

  // Details (буллеты ●, жирная тема)
  if (n.details?.length) {
    b.line([{ text: "Details", size: 20, bold: true, color: C.ink }], H3);
    for (const d of n.details) b.line([{ text: `${d.topic}: `, size: 12, bold: true, color: C.ink }, { text: d.text, size: 12, color: C.body }], { bullet: "disc" });
  }

  // Full transcript (полная запись мита, тот же шрифт Google Sans Flex, компактнее)
  if (opts.transcript && opts.transcript.trim()) {
    b.line([{ text: "Full transcript", size: 20, bold: true, color: C.ink }], H3);
    for (const raw of opts.transcript.split("\n")) {
      const ln = raw.trim();
      if (!ln) continue;
      const m = ln.match(/^([^:]{1,60}):\s*(.*)$/); // "Спикер: реплика"
      if (m && m[2]) b.line([{ text: `${m[1]}: `, size: 10, bold: true, color: C.ink }, { text: m[2], size: 10, color: C.body }], { spaceAfter: 1 });
      else b.line([{ text: ln, size: 10, color: C.body }], { spaceAfter: 1 });
    }
  }

  // Footer
  b.line([{ text: "Sent automatically by Tryll Meeting Notes.", size: 9, italic: true, color: C.faint }], { spaceBefore: 20 });

  const title = docTitle(opts.meeting, opts.dateISO);

  // Идемпотентность: если процесс упал МЕЖДУ созданием дока и сохранением
  // m.noteDocUrl (или тики пересеклись), ретрай не должен плодить второй док.
  // Имя уникально по миту (включает дату/время) — ищем его перед созданием.
  try {
    const q = `name = '${title.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`;
    const found = await drive.files.list({ q, fields: "files(id,webViewLink)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
    const ex = found.data.files?.[0];
    if (ex?.id) return { url: ex.webViewLink || `https://docs.google.com/document/d/${ex.id}/edit`, id: ex.id };
  } catch { /* поиск недоступен — просто создаём новый (как раньше) */ }

  const created = await docs.documents.create({ requestBody: { title } });
  const id = created.data.documentId!;
  await docs.documents.batchUpdate({ documentId: id, requestBody: { requests: b.requests() } });

  if (opts.folderId) {
    try {
      const meta = await drive.files.get({ fileId: id, fields: "parents", supportsAllDrives: true });
      await drive.files.update({ fileId: id, addParents: opts.folderId, removeParents: (meta.data.parents || []).join(","), supportsAllDrives: true, fields: "id" });
    } catch { /* папка недоступна — оставляем в My Drive */ }
  }
  const link = await drive.files.get({ fileId: id, fields: "webViewLink", supportsAllDrives: true });
  return { url: link.data.webViewLink || `https://docs.google.com/document/d/${id}/edit`, id };
}
