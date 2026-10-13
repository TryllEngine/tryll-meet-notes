# -*- coding: utf-8 -*-
"""Тест патча tryll-authstate (patch-vexa-authstate-build.py).

    npm run test:authstate-patch

Проверяет на заготовках кода (как test-vexa-gmeet-turns-patch.py):
  • блок проверки входа встаёт ровно после обработчика экранов Google и только
    в authenticated-ветке; повторное наложение ничего не меняет;
  • ПОВЕДЕНИЕ условия записи кук: условие вырезается из пропатченного index.js
    и выполняется в node на всех комбинациях. Главная регрессия: залогиненный
    бот, который СТУЧАЛСЯ (без «Join now»), тоже должен записать куки, а
    разлогиненный — ни в коем случае.
"""
import importlib.util
import sys

sys.stdout.reconfigure(encoding="utf-8")  # вывод по-русски и в консоли Windows
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("authstate_patch", HERE / "patch-vexa-authstate-build.py")
patch = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(patch)

# --- заготовка join.js: authenticated-ветка с обработчиком экранов Google ---
join = (
    "async function joinGoogleMeeting(page, meetingUrl, botName, botConfig) {\n"
    "    if (botConfig.authenticated) {\n"
    "        await page.screenshot({ path: 'auth-lobby.png' });\n"
    "        try {\n"
    "            // tryll-authscreens ...\n"
    + patch.JOIN_ANCHOR
    + "        // Mute mic and camera if visible\n"
    "    }\n"
    "    else {\n"
    "        // Anonymous flow\n"
    "    }\n"
    "}\n"
)
join_out = patch.patch_join(join)
assert join_out.count("tryll-authstate") >= 1, "блок не вставлен"
assert join_out.index(patch.JOIN_ANCHOR) < join_out.index("tryll-authstate"), "блок не после обработчика экранов"
assert join_out.index("tryll-authstate") < join_out.index("else {"), "блок попал не в authenticated-ветку"
assert patch.MODULE in join_out and patch.STATE in join_out
assert "process.pid" in join_out, "временный файл должен быть уникален для бота (параллельные боты)"
assert "renameSync" in join_out, "запись состояния должна быть атомарной"
assert patch.patch_join(join_out) == join_out, "повторное наложение изменило join.js"

# --- заготовка index.js: блок обратной записи кук (как его ставит writeback) ---
index = (
    "async function gracefulLeave() {\n"
    "    try {\n"
    + patch.INDEX_OLD
    + "            doWriteBack();\n"
    "        }\n"
    "    } catch (e) {}\n"
    "}\n"
)
index_out = patch.patch_index(index)
assert patch.INDEX_OLD not in index_out, "старое условие (только Join now) осталось"
assert patch.patch_index(index_out) == index_out, "повторное наложение изменило index.js"

# --- поведение условия: вырезаем его и выполняем в node ---
cond = re.search(r"if \((.+)\) \{\n", patch.INDEX_NEW).group(1)
cases = [
    # (joinedViaButton, authState, profileDir, ожидание, смысл)
    (True,  None,              "/tmp/bd", True,  "вошёл кнопкой Join now — пишем (как раньше)"),
    (True,  "signed_in",       "/tmp/bd", True,  "вошёл кнопкой и залогинен — пишем"),
    (False, "signed_in",       "/tmp/bd", True,  "СТУЧАЛСЯ, но залогинен — пишем (главная регрессия)"),
    (False, "signed_out",      "/tmp/bd", False, "разлогинен — НЕ пишем, не портим логин"),
    (False, "reauth_required", "/tmp/bd", False, "Google просит пароль — НЕ пишем"),
    (False, "unknown",         "/tmp/bd", False, "не распознали — НЕ пишем (осторожно)"),
    (False, None,              "/tmp/bd", False, "состояния нет (гость / сбой проверки) — НЕ пишем"),
    (True,  "signed_in",       None,      False, "нет каталога профиля — писать нечего"),
]
js = "const g = globalThis; const out = [];\n"
for ok, st, pd, _, _ in cases:
    js += "g.__tryllAuthOk = %s; g.__tryllAuthState = %s; g.__tryllProfileDir = %s;\n" % (
        "true" if ok else "undefined", json.dumps(st) if st else "undefined", json.dumps(pd) if pd else "undefined")
    js += "out.push(!!(" + cond.replace("global.", "g.") + "));\n"
js += "console.log(JSON.stringify(out));\n"
res = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
for (ok, st, pd, want, why), got in zip(cases, res):
    assert got == want, "запись кук: %s — ожидали %s, получили %s" % (why, want, got)

print("authstate patch: PASS (якоря, идемпотентность, %d случаев записи кук)" % len(cases))
