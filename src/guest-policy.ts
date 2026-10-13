/**
 * Когда слать бота ГОСТЕМ, хотя сессия socials@ жива.
 *
 * ИСТОРИЯ.
 * 12.10.2026 я ввёл два правила «гостем»: на чужой мит и пока работает другой
 * бот. Оба — из одного случая 30.09, без проверки истории. 13.10 правило
 * «другой бот» отправило стучаться трёх ботов при живой сессии: миты подряд —
 * обычное дело, и бот прошлого мита ещё сидит в своём, когда пора идти в
 * следующий. Считались даже гостевые и застрявшие боты, хотя аккаунт они не
 * трогают.
 *
 * Проверка истории это правило опровергла: с 09.09 по 24.09 боты под аккаунтом
 * 9 раз работали ОДНОВРЕМЕННО (до 58 минут вместе), и сессия жила две недели.
 *
 * Поэтому по умолчанию бот ВСЕГДА идёт под аккаунтом:
 *  • чужой мит — он и так стучится, но как «Tryll Engine» с почтой компании, а
 *    не анонимный гость (13.10 два анонимных гостя на внешнем мите так и не
 *    впустили). Куки после стука теперь тоже записываются (tryll-authstate);
 *  • параллельные миты — безопасно, см. выше.
 * Оба правила оставлены ВЫКЛЮЧАТЕЛЯМИ на случай, если Google поведёт себя иначе:
 *   GUEST_EXTERNAL=true   — на чужие миты гостем;
 *   AUTH_CONCURRENT=false — второй одновременный бот гостем.
 */
export type GuestPolicy = "external" | "concurrent";

export interface GuestPolicyOptions {
  companyDomain: string;
  guestExternal: boolean;
  authConcurrent: boolean;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): GuestPolicyOptions {
  return {
    companyDomain: (env.COMPANY_DOMAIN || "tryllengine.com").toLowerCase(),
    guestExternal: env.GUEST_EXTERNAL === "true",
    authConcurrent: env.AUTH_CONCURRENT !== "false",
  };
}

/**
 * @param organizer   email организатора из календаря (может отсутствовать)
 * @param otherAuthBots сколько ДРУГИХ ботов прямо сейчас работает под аккаунтом
 *                    (гостей и чужих митов не считать — сессию они не трогают)
 */
export function guestPolicyFor(
  organizer: string | undefined,
  otherAuthBots: number,
  opts: GuestPolicyOptions = optionsFromEnv(),
): GuestPolicy | undefined {
  const org = (organizer || "").toLowerCase();
  if (opts.guestExternal && org && !org.endsWith(`@${opts.companyDomain}`)) return "external";
  if (!opts.authConcurrent && otherAuthBots > 0) return "concurrent";
  return undefined;
}

export const policyLabel = (p?: GuestPolicy) =>
  p === "external" ? " ГОСТЕМ (внешний мит)" : p === "concurrent" ? " ГОСТЕМ (уже работает другой бот)" : "";
