import { spawn } from "child_process";
import { MeetingNotes, NOTES_SYSTEM, notesUserPrompt } from "./notes";

/**
 * Путь C: заметки через локальный Claude Code CLI (claude -p) — работает
 * по подписке пользователя, API-ключ не нужен. Подходит, когда раннер
 * крутится на машине, где выполнен `claude` login.
 */

const CLI_INSTRUCTION = `${NOTES_SYSTEM}

Прочитай транскрипт созвона (придёт ниже) и верни ТОЛЬКО валидный JSON без markdown-обёрток и пояснений, ровно такой структуры:
{
  "language": "ru|en",
  "tldr": ["3-6 главных пунктов"],
  "decisions": ["принятые решения"],
  "action_items": [{"owner": "кто", "task": "что", "due": "срок или —"}],
  "open_questions": ["открытые вопросы"],
  "summary": "связный пересказ хода обсуждения на 2-5 абзацев, кто что предлагал"
}`;

function runClaude(args: string[], stdinText: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32", // claude — это .cmd-шим на Windows
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exit ${code}: ${err || out}`));
    });
    child.stdin.write(stdinText, "utf-8");
    child.stdin.end();
  });
}

function extractJson(text: string): string {
  // срезаем возможные ```json-обёртки и текст вокруг
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`нет JSON в ответе CLI: ${text.slice(0, 300)}`);
  return body.slice(start, end + 1);
}

export async function generateNotesViaCli(
  title: string,
  dateISO: string,
  transcript: string,
): Promise<MeetingNotes> {
  const model = process.env.NOTES_CLI_MODEL || "sonnet";
  const raw = await runClaude(
    ["-p", CLI_INSTRUCTION, "--output-format", "json", "--model", model],
    notesUserPrompt(title, dateISO, transcript),
    10 * 60_000,
  );
  // stdout может содержать строки-предупреждения до JSON-объекта результата
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  const envelope = JSON.parse(lines.join("")) as { is_error?: boolean; result?: string };
  if (envelope.is_error || !envelope.result) {
    throw new Error(`claude CLI error: ${envelope.result ?? raw.slice(0, 300)}`);
  }
  return JSON.parse(extractJson(envelope.result)) as MeetingNotes;
}
