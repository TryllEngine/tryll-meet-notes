/**
 * Источник правды о Tryll Engine и команде — контекст для генерации заметок:
 * помогает Claude правильно писать имена, понимать роли и термины.
 * ВАЖНО: это справка, НЕ источник фактов для заметок — факты берутся ТОЛЬКО из
 * транскрипта. Контекст нужен для корректной атрибуции/орфографии имён и ролей.
 */
export const TEAM_CONTEXT = `COMPANY — Tryll Engine Inc. (US/Delaware startup, ~10 months old, Belgian subsidiary; Epic MegaGrant recipient; closed beta with several studios; revenue-share model ~0.5% of game revenue).
What it builds: on-device AI middleware for game developers — runs LLMs directly on the player's own hardware (CPU/GPU) instead of the cloud, removing cloud costs, token fees and third-party live dependencies, and keeping player data local. Engine-agnostic with Unreal Engine and Unity plugins. Branded "Tryll Engine" for developers and "Tryll Assistant" for end users.

TEAM (name → role; use for correct spelling and roles):
- Sasha (Aleksandr) Glotov — CEO & co-founder (esports-data background, serial entrepreneur; based in Germany).
- Alex (Sasha / Aleksandr) Riabov — CBDO & co-founder (founded a ~110-person gamedev outsourcing studio in China; well-connected East/West).

NAME DISAMBIGUATION — there are TWO people called "Sasha"/"Aleksandr": Sasha Glotov (CEO) and Alex Riabov (CBDO, also called Sasha). When the transcript just says "Sasha"/"Aleksandr"/"Alex" without a surname, infer who from context: CEO / founder voice / company-strategy / fundraising / overall vision → Glotov; business development / sales / publishing / China / partner & studio relationships → Riabov. If it is genuinely unclear, write "Sasha" without guessing a surname rather than picking the wrong one.
- Vladimir Beliaev — CTO (25+ yrs real-time graphics/engines; scaled a C++ game engine 3→85 engineers; based in Malaysia).
- Maksim Makevich — Head of Applied AI & co-founder (AI content pipelines at scale; based in Italy).
- Gennadii Potapov — Games Tech Lead (cross-platform game dev; based in Malaysia).
- Andrei Morozov — Engineering Lead (game & enterprise engineering; based in Malaysia).
- Lidia Kozlova — Creative Strategy Lead (creative strategy/design; game-art studio founder).
- Nikolay Andreev — Marketing / PR (press releases, LinkedIn, Gamescom networking, customer development).
- Bohdan Kuzmenko — Business Development / Publishing.
- Alexander — AI Strategic Advisor (VP at Microsoft NEXT AI R&D; ex-CTO of AI/ML at Oracle, Cisco, eBay).
- Pierre Moisan — Gamedev Strategic Advisor (ex-VP Megatoon & Frima Studio; based in Canada).
- Samuel Mungy, Miloš Petković — engineering contributors via General Arcade (Unity & Unreal integrations).`;
