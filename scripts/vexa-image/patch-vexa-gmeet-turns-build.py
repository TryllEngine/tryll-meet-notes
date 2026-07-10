# -*- coding: utf-8 -*-
"""Build-time patch for overlap-safe, abstaining Google Meet attribution.

The pinned Vexa 0.10.6 image assumes a media-element index is a permanent
participant identity. Google Meet can reuse those channels. This patch makes
the index a temporary transport key and rotates independent turn buffers.
"""
import io
import os
import sys

INDEX = os.environ.get("VEXA_BOT_INDEX", "/app/vexa-bot/dist/index.js")
IDENTITY = os.environ.get("VEXA_SPEAKER_IDENTITY", "/app/vexa-bot/dist/services/speaker-identity.js")
MARKER = "tryll-gmeet-turn-attribution"


def patch_identity(src: str) -> str:
    start = src.find("async function resolveGoogleMeetSpeakerName(")
    end = src.find("// ─── Teams DOM Traversal", start)
    if start < 0 or end < 0:
        raise RuntimeError("GMeet identity function anchors not found")
    replacement = '''async function resolveGoogleMeetSpeakerName(page, elementIndex, botName) {
    // tryll-gmeet-turn-attribution: only exclusive live evidence may name a turn.
    // Overlap, silence, and stale votes abstain; channel lifetime is not identity.
    const state = await queryBrowserState(page, botName);
    if (!state || state.speaking.length !== 1)
        return null;
    return state.speaking[0];
}
'''
    return src[:start] + replacement + src[end:]


def patch_index(src: str) -> str:
    require_anchor = 'const speaker_identity_1 = require("./services/speaker-identity");\n'
    if require_anchor not in src:
        raise RuntimeError("speaker-identity require anchor not found")
    src = src.replace(
        require_anchor,
        require_anchor + 'const gmeet_turn_attribution_1 = require("/tryll-patches/gmeet-turn-attribution.cjs"); // tryll-gmeet-turn-attribution\n',
        1,
    )

    state_anchor = "const lastReResolveTime = new Map();\n"
    if state_anchor not in src:
        raise RuntimeError("lastReResolveTime anchor not found")
    state = '''const gmeetTurnAttributor = new gmeet_turn_attribution_1.GMeetTurnAttributor({ stableObservations: 3, turnGapMs: 1200 });
const retiredGmeetTurns = new Set();
async function retireGmeetTurn(speakerId) {
    if (!speakerId || retiredGmeetTurns.has(speakerId) || !speakerManager)
        return;
    retiredGmeetTurns.add(speakerId);
    await speakerManager.flushSpeaker(speakerId, true);
    setTimeout(() => {
        try { speakerManager?.removeSpeaker(speakerId); }
        catch { }
        retiredGmeetTurns.delete(speakerId);
    }, 60000);
}
'''
    src = src.replace(state_anchor, state + state_anchor, 1)

    speaker_id_anchor = '    const speakerId = `speaker-${speakerIndex}`;\n'
    if speaker_id_anchor not in src:
        raise RuntimeError("speakerId anchor not found")
    src = src.replace(speaker_id_anchor, '    let speakerId = `speaker-${speakerIndex}`;\n', 1)

    block_start = src.find("    // ─── GMeet / Teams / Zoom: voting + locking")
    block_end = src.find("    // Per-speaker streaming VAD gate (GMeet only).", block_start)
    if block_start < 0 or block_end < 0:
        raise RuntimeError("identity block anchors not found")
    legacy = src[block_start:block_end]
    turn_block = '''    // tryll-gmeet-turn-attribution: one independent buffer per channel-turn.
    if (currentPlatform === 'google_meet') {
        const exclusiveName = await (0, speaker_identity_1.resolveSpeakerName)(page, speakerIndex, platformKey, currentBotConfig?.botName);
        const decision = gmeetTurnAttributor.observe(speakerIndex, exclusiveName, Date.now());
        if (decision.previousTurnId)
            await retireGmeetTurn(decision.previousTurnId);
        speakerId = decision.turnId;
        if (!speakerManager.hasSpeaker(speakerId)) {
            speakerManager.addSpeaker(speakerId, decision.name);
            (0, utils_1.log)(`[GMeetTurn] ${decision.action} track=${speakerIndex} turn=${speakerId} name="${decision.name}"`);
        }
        else if (speakerManager.getSpeakerName(speakerId) !== decision.name) {
            speakerManager.updateSpeakerName(speakerId, decision.name);
            (0, utils_1.log)(`[GMeetTurn] verified track=${speakerIndex} turn=${speakerId} name="${decision.name}"`);
        }
    }
    else {
'''
    src = src[:block_start] + turn_block + legacy + "    }\n\n" + src[block_end:]

    cleanup_anchor = "        speakerManager.removeAll();\n        speakerManager = null;\n"
    if cleanup_anchor not in src:
        raise RuntimeError("speaker-manager cleanup anchor not found")
    src = src.replace(
        cleanup_anchor,
        cleanup_anchor + "        gmeetTurnAttributor.clear();\n        retiredGmeetTurns.clear();\n",
        1,
    )
    return src


def main() -> None:
    identity_src = io.open(IDENTITY, encoding="utf-8").read()
    index_src = io.open(INDEX, encoding="utf-8").read()

    if MARKER in identity_src and MARKER in index_src:
        print("gmeet turn attribution already applied")
        return

    try:
        identity_out = patch_identity(identity_src)
        index_out = patch_index(index_src)
    except RuntimeError as exc:
        sys.exit(f"GMEET TURNS: {exc}")

    io.open(IDENTITY, "w", encoding="utf-8").write(identity_out)
    io.open(INDEX, "w", encoding="utf-8").write(index_out)
    print("gmeet turn attribution applied: exclusive evidence, overlap abstention, rotating turn buffers")


if __name__ == "__main__":
    main()
