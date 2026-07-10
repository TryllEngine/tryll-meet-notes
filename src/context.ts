import { readFileSync } from "fs";

/**
 * Источник правды о Tryll Engine и команде — контекст для генерации заметок:
 * помогает Claude правильно писать имена, понимать роли и термины.
 * ВАЖНО: это справка, НЕ источник фактов для заметок — факты берутся ТОЛЬКО из
 * транскрипта. Контекст нужен для корректной атрибуции/орфографии имён и ролей.
 *
 * Сам текст (про компанию + ростер команды) НЕ в git — он чувствительный
 * (revenue-share, MegaGrant, роли/локации людей). Лежит в src/context.local.txt
 * (в .gitignore), копируется в образ раннера при сборке (COPY src ./src). Если
 * файла нет (свежий клон) — используется обобщённый плейсхолдер, заметки при этом
 * генерятся, просто без точной сверки имён/ролей. Шаблон: src/context.local.txt.example.
 */
const FALLBACK =
  "COMPANY — Tryll Engine: on-device AI middleware for game developers (runs LLMs on the player's own hardware; Unreal/Unity plugins). " +
  "Team context is not loaded on this machine (src/context.local.txt missing) — use names/terms exactly as they appear in the transcript, do not guess roles.";

function loadTeamContext(): string {
  for (const p of ["src/context.local.txt", "./src/context.local.txt", "context.local.txt"]) {
    try {
      const s = readFileSync(p, "utf-8").trim();
      if (s) return s;
    } catch {
      /* пробуем следующий путь */
    }
  }
  return FALLBACK;
}

export const TEAM_CONTEXT = loadTeamContext();

/**
 * Notes may use company context for terminology, but never for speaker identity.
 * Identity-disambiguation blocks intentionally stay out of the notes prompt: a
 * topic or role is not evidence that a particular person said the words.
 */
export function teamContextForNotes(context: string = TEAM_CONTEXT): string {
  const lines = context.split(/\r?\n/);
  const marker = lines.findIndex((line) => /^\s*NAME\s+DISAMBIGUATION\b/i.test(line));
  return (marker < 0 ? lines : lines.slice(0, marker)).join("\n").trim();
}
