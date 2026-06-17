import { readFileSync } from "fs";
import { google } from "googleapis";
import { googleAuth } from "./google";

const FROM = process.env.NOTES_EMAIL_FROM || "maksim.makevich@tryllengine.com";
const COMPANY_DOMAIN = process.env.COMPANY_DOMAIN || "tryllengine.com";

/** HTML подписи: вытаскиваем <table>…</table> из assets/signature-source.html. */
function signatureHtml(): string {
  try {
    const src = readFileSync("assets/signature-source.html", "utf-8");
    const m = src.match(/<table[\s\S]*?<\/table>/i);
    return m ? m[0] : "";
  } catch {
    return "";
  }
}

/** Тело письма (HTML) по формату: Hi team → текст → Sent automatically → подпись. */
export function notesEmailHtml(title: string, dateISO: string, docUrl: string): string {
  const date = dateISO.slice(0, 10);
  // <br><br><br> = две пустые строки между блоками (как просил Максим)
  return (
    `Hi team,<br><br><br>` +
    `The meeting "${title}" (${date}) has wrapped up. The notes — summary, key decisions and action items — are ready here:<br>` +
    `📄 <a href="${docUrl}">${docUrl}</a><br>` +
    `This is an automated recap shared for your awareness. No reply needed.<br><br><br>` +
    `Sent automatically by Tryll Meeting Notes<br><br><br>` +
    signatureHtml()
  );
}

function buildRawMessage(to: string, subject: string, html: string): string {
  const subjectEnc = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const mime = [
    `From: ${FROM}`,
    `To: ${to}`,
    `Subject: ${subjectEnc}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64"),
  ].join("\r\n");
  return Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Оставляем только адреса нашего домена (внешним гостям не пишем). */
export function filterDomainRecipients(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const addr = e.trim().toLowerCase();
    if (!addr.endsWith(`@${COMPANY_DOMAIN}`)) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/** Отправляет письмо со ссылкой на заметки от имени FROM всем recipients (одним письмом). */
export async function sendNotesEmail(
  recipients: string[],
  title: string,
  dateISO: string,
  docUrl: string,
): Promise<void> {
  if (recipients.length === 0) return;
  const gmail = google.gmail({ version: "v1", auth: googleAuth() });
  const subject = `Meeting notes — ${title} (${dateISO.slice(0, 10)})`;
  const html = notesEmailHtml(title, dateISO, docUrl);
  const raw = buildRawMessage(recipients.join(", "), subject, html);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}
