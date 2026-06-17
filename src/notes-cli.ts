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
  "title_en": "краткое название мита ВСЕГДА НА АНГЛИЙСКОМ (3-6 слов; если мит на русском — переведи на английский; имена собственные и бренды оставь как есть). Используется для имени файла и темы письма",
  "tldr_en": ["те же 3-6 главных пунктов, но ВСЕГДА НА АНГЛИЙСКОМ — для письма-сводки"],
  "tldr": ["3-6 главных пунктов"],
  "decisions": ["принятые решения"],
  "action_items": [{"owner": "кто", "task": "что", "due": "срок или —"}],
  "open_questions": ["открытые вопросы"],
  "summary": "связный пересказ хода обсуждения на 2-5 абзацев, кто что предлагал"
}
ЯЗЫК (критично):
1) Сначала определи ДОМИНИРУЮЩИЙ язык транскрипта (на каком языке реально говорили участники).
2) Поля tldr, decisions, action_items, open_questions, summary пиши ИМЕННО на этом языке. Если транскрипт на английском — все эти поля на английском. Если на русском — на русском. НЕ переводи на русский только потому, что эта инструкция на русском.
3) "language" — это код доминирующего языка ("en" или "ru").
4) title_en и tldr_en — ВСЕГДА на английском (для имени файла и письма), даже если мит на русском.

Пример: транскрипт целиком на английском → language="en", а tldr/decisions/summary и т.д. — на английском.`;

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
  // Весь промт — через stdin: многострочные argv ломаются в Windows-шелле
  const raw = await runClaude(
    ["-p", "--output-format", "json", "--model", model],
    `${CLI_INSTRUCTION}\n\n${notesUserPrompt(title, dateISO, transcript)}`,
    10 * 60_000,
  );
  // stdout может содержать предупреждения до JSON-конверта результата
  const idx = raw.indexOf('{"type":"result"');
  const jsonStart = idx >= 0 ? idx : raw.indexOf("{");
  if (jsonStart < 0) throw new Error(`claude CLI вернул не-JSON: ${raw.slice(0, 300)}`);
  const envelope = JSON.parse(raw.slice(jsonStart)) as { is_error?: boolean; result?: string };
  if (envelope.is_error || !envelope.result) {
    throw new Error(`claude CLI error: ${envelope.result ?? raw.slice(0, 300)}`);
  }
  return JSON.parse(extractJson(envelope.result)) as MeetingNotes;
}
