# Tryll Meet Notes

Бот для созвонов компании Tryll Engine: следит за Google Calendar, в момент начала созвона автоматически отправляет бота в Google Meet, транскрибирует разговор **с именами спикеров**, генерирует заметки через **Claude Sonnet** и складывает готовый **.docx** на Google Drive в структуру папок:

```
Tryll Meeting Notes/
├── Sync Tryll/                  ← папка = серия повторяющегося события
│   └── Sync Tryll — 2026-06-10.docx
└── Разовые встречи/
    └── Созвон с партнёром — 2026-06-08.docx
```

## Архитектура

```
Vercel (мозг, serverless)                 Vexa (тело бота)
┌─────────────────────────────┐           ┌──────────────────────┐
│ /api/tick  (cron, раз в мин)│──POST────▶│ бот заходит в Meet,  │
│  1. календарь → новые миты  │   /bots   │ пишет звук, Whisper, │
│  2. отправить бота          │◀──────────│ спикеры из UI Meet   │
│  3. созвон кончился →       │ transcript└──────────────────────┘
│     транскрипт → заметки    │
│     (Claude Sonnet) →       │──────────▶ Google Drive (.docx)
│     .docx → Drive           │
│ /api/pending (для агента)   │
└─────────────────────────────┘
   состояние: Upstash Redis
```

- **Почему бот не на Vercel:** serverless-функции живут минуты и не умеют держать headless-браузер с аудио 60+ минут. Бот — это [Vexa](https://vexa.ai) (open source, Apache 2.0): либо их облако (`https://api.cloud.vexa.ai`, ~$0.50/час звонка), либо self-hosted на сервере Tryll (`docker compose up`, бесплатно). Код одинаковый — меняется `VEXA_BASE_URL`.
- **Заметки — два пути:**
  - **Путь A** (если задан `ANTHROPIC_API_KEY`): `/api/tick` сам вызывает Claude Sonnet (`claude-sonnet-4-6`) и сразу собирает docx.
  - **Путь B** (без API-ключа, на подписке Claude): транскрипты копятся в очереди, а **scheduled-агент Claude Code** (работает в облаке по твоей подписке) периодически забирает их через `GET /api/pending`, пишет заметки и возвращает `POST /api/pending` — сервер сам собирает docx и грузит на Drive.

## Развёртывание

### 1. Vexa

Вариант «облако»: зарегистрируйся на [vexa.ai](https://vexa.ai), получи API key.
Вариант «свой сервер»: `git clone https://github.com/Vexa-ai/vexa && docker compose up -d`, затем `VEXA_BASE_URL=http://<сервер>:18056`.

> ⚠️ Эндпоинты Vexa в `src/vexa.ts` (`POST /bots`, `GET /transcripts/...`, `GET /bots/status`) сверь с документацией той версии Vexa, которую развернёшь — API у них активно развивается.

### 2. Google (Calendar + Drive)

1. [Google Cloud Console](https://console.cloud.google.com) → новый проект → включи **Google Calendar API** и **Google Drive API**.
2. OAuth consent screen (Internal для Workspace) → Credentials → **OAuth Client ID** (Desktop app).
3. Получи refresh token со scope `https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.file` (через [OAuth Playground](https://developers.google.com/oauthplayground): шестерёнка → Use your own OAuth credentials).
4. Заполни `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

### 3. Upstash Redis (состояние)

Vercel Dashboard → Storage → Marketplace → **Upstash Redis** (free tier). Переменные `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` подключатся к проекту автоматически.

### 4. Vercel

1. Импортируй репозиторий на [vercel.com/new](https://vercel.com/new).
2. Задай переменные окружения из `.env.example`.
3. **Cron:** `vercel.json` уже содержит cron `* * * * *` для `/api/tick`. На плане **Pro** он заработает сразу. На **Hobby** cron ограничен (раз в день) — вместо него заведи бесплатный пингер [cron-job.org](https://cron-job.org), дёргающий `https://<проект>.vercel.app/api/tick?secret=<CRON_SECRET>` каждую минуту.

### 5. Заметки

- **Путь A:** добавь `ANTHROPIC_API_KEY` — и всё работает само.
- **Путь B (подписка):** в Claude Code выполни `/schedule` и создай агента с расписанием «каждый час» и промптом вида:

  > Сделай GET https://<проект>.vercel.app/api/pending с заголовком `Authorization: Bearer <AGENT_SECRET>`. Для каждого item напиши заметки по транскрипту (язык созвона; TL;DR, решения, action items «кто→что→срок», открытые вопросы, связный пересказ) и отправь POST на тот же URL с JSON `{"eventId": ..., "notes": {language, tldr[], decisions[], action_items[{owner,task,due}], open_questions[], summary}}` с тем же заголовком.

## Поведение

- Бот отправляется в звонок, когда до старта ≤ 1 минуты (тик — каждую минуту).
- События без ссылки на Meet, all-day события и события с `[norec]` в названии игнорируются.
- Бот виден в участниках как **Tryll Notes Bot** — все знают о записи. Если Meet держит его в «зале ожидания», кто-то должен впустить (бот от аккаунта домена пускается автоматически — настрой в Vexa).
- Если встреча затянулась более чем на 30 минут сверх плана — бот принудительно останавливается, транскрипт сохраняется.
- Имя файла: `<Название события> — <YYYY-MM-DD>.docx`, папка — по названию серии (`recurringEventId`).

## Ограничения v1

- Только Google Meet (Vexa умеет Zoom/Teams — добавляется в `calendar.ts` + `vexa.ts`).
- Один календарь (`GOOGLE_CALENDAR_ID`).
- Заметки в .docx; вариант «Google Doc» — заменить mimeType в `src/drive.ts` на `application/vnd.google-apps.document` (Drive сконвертирует сам).

## Локальная проверка

```bash
npm install
npm run typecheck
npx vercel dev   # затем GET http://localhost:3000/api/tick?secret=...
```
