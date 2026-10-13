// Тест определения входа бота (tryll-authstate.cjs) в НАСТОЯЩЕМ Chromium —
// том же, что у бота. Экраны — заготовки по реальным скриншотам бота
// (28.09–13.10.2026). Сеть не нужна: запросы к meet.google.com и
// accounts.google.com подменяются заготовками, поэтому location.hostname
// настоящий.
//
// Запуск — внутри vexa-lite, где лежат Playwright и Chromium бота:
//   npm run test:authstate        (копирует файлы в контейнер и запускает)
"use strict";
const path = require("path");
const { detectAuthState } = require(path.join(__dirname, "tryll-authstate.cjs"));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/app/vexa-bot/node_modules/playwright");

const MEET = "https://meet.google.com/abc-defg-hij";
const ACCOUNTS = "https://accounts.google.com/v3/signin/challenge/pwd?TL=x";

const corner = (signedIn) =>
  signedIn
    ? `<div class="acct"><span>socials@tryllengine.com</span><a href="#">Switch account</a></div>`
    : `<div class="acct"><a href="https://accounts.google.com/ServiceLogin">Sign in</a></div>`;

const CASES = [
  {
    name: "залогинен, свой мит: Join now",
    url: MEET,
    html: `${corner(true)}<h1>Ready to join?</h1><button>Join now</button>`,
    want: "signed_in",
  },
  {
    name: "залогинен, предупреждение об устройствах: Join anyway",
    url: MEET,
    html: `${corner(true)}<h1>Sync Engineering</h1><button>Join anyway</button><button>Other ways to join</button>`,
    want: "signed_in",
  },
  {
    name: "залогинен, чужой мит — стучится: Ask to join без поля имени",
    url: MEET,
    html: `${corner(true)}<h1>Ready to join?</h1><button>Ask to join</button>`,
    want: "signed_in",
  },
  {
    name: "РАЗЛОГИНЕН (28.09, 12.10): поле имени + Sign in",
    url: MEET,
    html: `${corner(false)}<h1>What's your name?</h1>
           <input type="text" aria-label="Your name" placeholder="Your name">
           <button>Ask to join</button>
           <div>Sign in with your Google account. Instead of waiting to be let in, sign in…</div>`,
    want: "signed_out",
  },
  {
    name: "разлогинен: только поле имени (ссылки Sign in не видно)",
    url: MEET,
    html: `<h1>What's your name?</h1><input type="text" placeholder="Your name"><button>Ask to join</button>`,
    want: "signed_out",
  },
  {
    name: "залогинен, а скрытое поле имени в разметке не путает",
    url: MEET,
    html: `${corner(true)}<input type="text" aria-label="Your name" style="display:none"><button>Join now</button>`,
    want: "signed_in",
  },
  {
    name: "«Verify it's you» (09.09, 24.09): застрял на accounts.google.com",
    url: ACCOUNTS,
    html: `<h1>Verify it's you</h1><div>socials@tryllengine.com</div><button>Next</button>`,
    want: "reauth_required",
  },
  {
    name: "непонятный экран — unknown, а не ложное «залогинен»",
    url: MEET,
    html: `<h1>Checking your meeting…</h1>`,
    want: "unknown",
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const c of CASES) {
      const ctx = await browser.newContext();
      await ctx.route("**/*", (route) =>
        route.request().url().startsWith(c.url.split("?")[0])
          ? route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${c.html}</body></html>` })
          : route.abort(),
      );
      const page = await ctx.newPage();
      await page.goto(c.url);
      const got = await page.evaluate(detectAuthState); // ровно так вызывает бот
      if (got !== c.want) failures.push(`${c.name}: ожидали ${c.want}, получили ${got}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error("authstate detection: FAIL\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log(`authstate detection: PASS (${CASES.length} экранов в настоящем Chromium)`);
})().catch((e) => {
  console.error("authstate detection: ERROR", e);
  process.exit(1);
});
