import { google } from "googleapis";
import { Readable } from "stream";
import { googleAuth } from "./google";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function driveClient() {
  return google.drive({ version: "v3", auth: googleAuth() });
}

function escapeQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const drive = driveClient();
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const res = await drive.files.list({
    q: `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentClause}`,
    fields: "files(id)",
    pageSize: 1,
  });
  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  return created.data.id!;
}

/**
 * Кладёт .docx в "<DRIVE_ROOT_FOLDER_NAME>/<seriesName>/<fileName>.docx".
 * Возвращает webViewLink документа.
 */
export async function uploadNotesDocx(
  seriesName: string,
  fileName: string,
  docx: Buffer,
): Promise<string> {
  const rootName = process.env.DRIVE_ROOT_FOLDER_NAME || "Tryll Meeting Notes";
  const rootId = await ensureFolder(rootName);
  const seriesId = await ensureFolder(seriesName, rootId);

  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: {
      name: `${fileName}.docx`,
      parents: [seriesId],
      mimeType: DOCX_MIME,
    },
    media: {
      mimeType: DOCX_MIME,
      body: Readable.from(docx),
    },
    fields: "id, webViewLink",
  });
  return res.data.webViewLink ?? `https://drive.google.com/file/d/${res.data.id}/view`;
}
