import { spawn } from "child_process";
import { google } from "googleapis";
import { googleAuth } from "./google";

/**
 * Умный выбор папки на Drive для заметки (структура «Notesnew», 2026-07).
 * Логика:
 *   1) ЖЁСТКИЕ ПРАВИЛА — регулярные миты кладём 100% детерминированно, без ИИ.
 *   2) Иначе — спрашиваем Claude (claude -p): даём живой список всех папок с
 *      путями + название мита + краткое саммари → он возвращает ID папки.
 *   3) ФОЛБЭК — если не удалось выбрать/провалидировать → 07_Inbox (разберут вручную).
 * Список папок тянется из Drive КАЖДЫЙ РАЗ, поэтому новые папки подхватываются сами.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Корень новой структуры заметок (папка «Notesnew»). Переопределяется env.
const NOTES_ROOT = process.env.NOTES_ROOT_FOLDER_ID || "1j2WTzXKSg7wL62llWWgpYgZP-VVI1Uaq";
// Куда класть, если папка не выбрана (07_Inbox).
const INBOX_ID = process.env.NOTES_INBOX_FOLDER_ID || "1x_LDyfFdzTXqxjBJR3DQHJTo0cj2uzIM";

export interface FolderNode {
  id: string;
  /** человекочитаемый путь, напр. "04_GTM / Clients" */
  path: string;
}

/**
 * ЖЁСТКИЕ ПРАВИЛА (100%, без ИИ) — регулярные миты с фиксированной папкой.
 * test проверяет НАЗВАНИЕ мита. Добавлять сюда новые соответствия по мере надобности.
 */
const HARD_RULES: { test: (title: string) => boolean; folderId: string; label: string }[] = [
  // Sync Tryll (синки 3×/нед) → 00_Company / All-Hands
  { test: (t) => /sync\s*tryll/i.test(t), folderId: "1xqOkLDEpA9-vexs0EyECqztwevhaHcSY", label: "00_Company / All-Hands" },
  // Marketing Catch up (каждую среду) → 04_GTM / GTM Sync
  { test: (t) => /marketing\s*catch\s*-?\s*up/i.test(t), folderId: "1hWh14pdud3pfMS062ryS5RBSmvo0FCTp", label: "04_GTM / GTM Sync" },
];

/** Рекурсивно собрать все папки под корнем с путями (напр. "04_GTM / Clients"). */
export async function listNoteFolders(): Promise<FolderNode[]> {
  const drive = google.drive({ version: "v3", auth: googleAuth() });
  const out: FolderNode[] = [];
  async function walk(id: string, prefix: string, depth: number): Promise<void> {
    if (depth > 4) return; // страховка от циклов/слишком глубокой вложенности
    const r = await drive.files.list({
      q: `'${id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 1000,
      orderBy: "name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of r.data.files ?? []) {
      if (!f.id || !f.name) continue;
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ id: f.id, path });
      await walk(f.id, path, depth + 1);
    }
  }
  await walk(NOTES_ROOT, "", 0);
  return out;
}

/** Вызов claude CLI (по подписке), возвращает текст ответа (result из JSON-конверта). */
function runClaude(stdinText: string, timeoutMs: number): Promise<string> {
  const model = process.env.FOLDER_CLI_MODEL || process.env.NOTES_CLI_MODEL || "sonnet";
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timeout ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude CLI exit ${code}: ${err || out}`));
    });
    child.stdin.write(stdinText, "utf-8");
    child.stdin.end();
  });
}

/** Спросить Claude, в какую папку положить заметку. Возвращает folderId или null. */
async function classifyViaClaude(title: string, summaryHint: string, folders: FolderNode[]): Promise<string | null> {
  const list = folders.map((f) => `${f.id} — ${f.path}`).join("\n");
  const prompt = `You are filing a meeting note into the correct folder of a company's Google Drive.

Meeting title: "${title}"
Short summary: ${summaryHint || "(none)"}

Available folders (format "id — path"):
${list}

Pick the SINGLE best-fitting folder for this meeting note based on the title and summary.
Reply with ONLY the folder id (the token before " — "), nothing else.
If no folder fits well, reply exactly: INBOX`;

  const raw = await runClaude(prompt, 2 * 60_000);
  const idx = raw.indexOf('{"type":"result"');
  const jsonStart = idx >= 0 ? idx : raw.indexOf("{");
  if (jsonStart < 0) return null;
  const env = JSON.parse(raw.slice(jsonStart)) as { is_error?: boolean; result?: string };
  if (env.is_error || !env.result) return null;
  const answer = env.result.trim();
  if (/^INBOX$/i.test(answer)) return null;
  // вытащить id из ответа (на случай, если модель добавила лишнего)
  const ids = folders.map((f) => f.id);
  const found = ids.find((id) => answer.includes(id));
  return found ?? null;
}

/**
 * Выбрать папку для заметки. Никогда не бросает — при любой проблеме возвращает Inbox.
 * @returns folderId + reason (для лога).
 */
export async function chooseNoteFolder(title: string, summaryHint: string): Promise<{ folderId: string; reason: string }> {
  // 1) жёсткие правила
  for (const r of HARD_RULES) {
    if (r.test(title)) return { folderId: r.folderId, reason: `rule → ${r.label}` };
  }
  // 2) живой список папок
  let folders: FolderNode[] = [];
  try {
    folders = await listNoteFolders();
  } catch (e) {
    return { folderId: INBOX_ID, reason: `folders unavailable → Inbox (${(e as Error).message})` };
  }
  if (folders.length === 0) return { folderId: INBOX_ID, reason: "no folders → Inbox" };
  // 3) выбор Claude
  try {
    const chosen = await classifyViaClaude(title, summaryHint, folders);
    if (chosen) {
      const f = folders.find((x) => x.id === chosen)!;
      return { folderId: f.id, reason: `claude → ${f.path}` };
    }
  } catch (e) {
    return { folderId: INBOX_ID, reason: `claude failed → Inbox (${(e as Error).message})` };
  }
  // 4) фолбэк
  return { folderId: INBOX_ID, reason: "no confident match → Inbox" };
}
