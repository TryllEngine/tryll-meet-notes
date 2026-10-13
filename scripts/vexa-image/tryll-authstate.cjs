// Залогинен ли бот в Google на самом деле — по экрану лобби Meet.
//
// ЗАЧЕМ (13.10.2026). Каждый раз, когда бот «стучался», мы гадали: сессия
// socials@ умерла или бота просто не пускает мит? Логи ботов в базе Vexa
// обрезаются до хвоста, начало (где видно, как бот входил) у долгих ботов
// теряется. Так 12.10 я ввёл лишнее правило, а 13.10 боты стучались, хотя
// сессия была жива. Теперь бот сам смотрит на экран и записывает итог в
// /master-profile/tryll-auth-state.json — его читают meet-check и человек.
//
// Один исходник на два места: патч join.js подключает этот файл в боте,
// test-authstate.cjs проверяет его в настоящем Chromium на заготовках экранов.
//
// detectAuthState выполняется ВНУТРИ СТРАНИЦЫ (page.evaluate) — поэтому она
// самодостаточная: без замыканий и внешних переменных.
"use strict";

function detectAuthState() {
  const visible = (el) =>
    !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  // Бот так и не ушёл со страницы аккаунтов Google — значит, Google требует
  // подтвердить вход («Verify it's you», выбор аккаунта, пароль).
  if (/(^|\.)accounts\.google\.com$/i.test(location.hostname)) return "reauth_required";
  // Разлогинен: Meet спрашивает имя и предлагает войти.
  const nameInput = document.querySelector(
    'input[aria-label="Your name"], input[placeholder="Your name"]',
  );
  const signIn = Array.from(document.querySelectorAll("a, button")).find((el) =>
    /^\s*sign in\s*$/i.test(el.textContent || ""),
  );
  if (visible(nameInput) || visible(signIn)) return "signed_out";
  // Залогинен: в углу почта аккаунта и ссылка «Switch account» — и при входе
  // без стука («Join now»), и при стуке на чужой мит («Ask to join»).
  const text = (document.body && document.body.innerText) || "";
  if (/switch account/i.test(text)) return "signed_in";
  return "unknown";
}

module.exports = { detectAuthState };
