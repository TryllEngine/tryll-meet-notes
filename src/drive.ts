import { google } from "googleapis";
import { Readable } from "stream";
import { googleAuth } from "./google";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GDOC_MIME = "application/vnd.google-apps.document"; // нативный Google Doc

function driveClient() {
  return google.drive({ version: "v3", auth: googleAuth() });
}

function escapeQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** нормализация для сопоставления названий: без пробелов/регистра/пунктуации */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/\\.,:;]+/g, "");
}

async function getRootFolderId(): Promise<string> {
  const byId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (byId) return byId;
  // fallback: найти/создать папку по имени в корне Drive
  const name = process.env.DRIVE_ROOT_FOLDER_NAME || "Tryll Meeting Notes";
  const drive = driveClient();
  const res = await drive.files.list({
    q: `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id!;
}

/**
 * Подпапка для серии митов внутри корня:
 * 1) ищем существующую папку, чьё имя «похоже» на название серии
 *    (нормализованное вхождение в обе стороны: "n8n" ⊂ "n8n Progon / Sync", "SyncTryll" ≈ "Sync Tryll");
 * 2) иначе создаём папку с именем серии.
 */
async function ensureSeriesFolder(rootId: string, seriesName: string): Promise<string> {
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const series = norm(seriesName);
  for (const f of res.data.files ?? []) {
    const folder = norm(f.name ?? "");
    if (!folder) continue;
    if (series.includes(folder) || folder.includes(series)) return f.id!;
  }
  const created = await drive.files.create({
    requestBody: { name: seriesName, mimeType: FOLDER_MIME, parents: [rootId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id!;
}

/**
 * Кладёт заметки в "<корень>/<папка серии>/<fileName>" как НАТИВНЫЙ Google Doc.
 * Загружаем .docx-байты, а Drive конвертирует их в Google Doc (mimeType цели =
 * google-apps.document). Возвращает ссылку на документ.
 */
export async function uploadNotesDocx(
  seriesName: string,
  fileName: string,
  docx: Buffer,
): Promise<string> {
  const rootId = await getRootFolderId();
  const seriesId = await ensureSeriesFolder(rootId, seriesName);

  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: {
      name: fileName, // без .docx — это будет Google Doc
      parents: [seriesId],
      mimeType: GDOC_MIME, // цель — нативный Google Doc → Drive сконвертирует
    },
    media: {
      mimeType: DOCX_MIME, // исходные байты — .docx
      body: Readable.from(docx),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return res.data.webViewLink ?? `https://docs.google.com/document/d/${res.data.id}/edit`;
}
