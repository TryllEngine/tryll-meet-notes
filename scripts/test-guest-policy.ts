/**
 * Тест правила «когда слать бота гостем» (src/guest-policy.ts).
 *   npm run test:guest-policy
 *
 * Главное, что фиксирует тест: по умолчанию бот ВСЕГДА идёт под аккаунтом.
 * 13.10.2026 правило «другой бот работает → гостем» зря отправило стучаться
 * трёх ботов при живой сессии; история показала, что параллельные боты под
 * аккаунтом сессию не губят.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { guestPolicyFor, optionsFromEnv, policyLabel } from "../src/guest-policy";

const DEFAULT = optionsFromEnv({});
const INTERNAL = "sasha.glotov@tryllengine.com";
const EXTERNAL = "alex@neverstatic.co";

test("по умолчанию: свой мит, никого больше — под аккаунтом", () => {
  assert.equal(guestPolicyFor(INTERNAL, 0, DEFAULT), undefined);
});

test("по умолчанию: миты подряд / параллельно — всё равно под аккаунтом (регрессия 13.10)", () => {
  assert.equal(guestPolicyFor(INTERNAL, 1, DEFAULT), undefined);
  assert.equal(guestPolicyFor(INTERNAL, 3, DEFAULT), undefined);
});

test("по умолчанию: чужой мит — под аккаунтом (стучится как Tryll Engine, а не аноним)", () => {
  assert.equal(guestPolicyFor(EXTERNAL, 0, DEFAULT), undefined);
});

test("организатор неизвестен — под аккаунтом", () => {
  assert.equal(guestPolicyFor(undefined, 0, DEFAULT), undefined);
  assert.equal(guestPolicyFor("", 2, DEFAULT), undefined);
});

test("выключатель GUEST_EXTERNAL=true: чужой мит — гостем, свой — нет", () => {
  const o = optionsFromEnv({ GUEST_EXTERNAL: "true" });
  assert.equal(guestPolicyFor(EXTERNAL, 0, o), "external");
  assert.equal(guestPolicyFor(INTERNAL, 0, o), undefined);
  // регистр почты не должен превращать свой мит в чужой
  assert.equal(guestPolicyFor("Sasha.Glotov@TryllEngine.com", 0, o), undefined);
});

test("выключатель AUTH_CONCURRENT=false: второй бот под аккаунтом — гостем", () => {
  const o = optionsFromEnv({ AUTH_CONCURRENT: "false" });
  assert.equal(guestPolicyFor(INTERNAL, 0, o), undefined);
  assert.equal(guestPolicyFor(INTERNAL, 1, o), "concurrent");
});

test("домен компании берётся из COMPANY_DOMAIN", () => {
  const o = optionsFromEnv({ GUEST_EXTERNAL: "true", COMPANY_DOMAIN: "Example.org" });
  assert.equal(guestPolicyFor("a@example.org", 0, o), undefined);
  assert.equal(guestPolicyFor(INTERNAL, 0, o), "external");
});

test("подпись в логе", () => {
  assert.equal(policyLabel(undefined), "");
  assert.match(policyLabel("external"), /ГОСТЕМ/);
  assert.match(policyLabel("concurrent"), /другой бот/);
});
