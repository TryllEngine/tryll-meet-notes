# -*- coding: utf-8 -*-
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gmeet_turn_patch", HERE / "patch-vexa-gmeet-turns-build.py")
patch = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(patch)

identity = '''"use strict";
async function resolveGoogleMeetSpeakerName(page, elementIndex, botName) {
    const locked = getLockedMapping(elementIndex);
    if (locked) return locked;
    return null;
}
// ─── Teams DOM Traversal ─────────────────────────────────────────────────────
'''

index = '''"use strict";
const speaker_identity_1 = require("./services/speaker-identity");
const lastReResolveTime = new Map();
async function handlePerSpeakerAudioData(speakerIndex, audioDataArray) {
    let page, currentPlatform, currentBotConfig, speakerManager;
    const utils_1 = { log() {} };
    const segmentPublisher = {};
    const audioData = new Float32Array(audioDataArray);
    const platformKey = currentPlatform === 'google_meet' ? 'googlemeet' : 'unknown';
    const speakerId = `speaker-${speakerIndex}`;
    // ─── GMeet / Teams / Zoom: voting + locking ────────────────────────────────
    if (!speakerManager.hasSpeaker(speakerId)) speakerManager.addSpeaker(speakerId, '');
    // Per-speaker streaming VAD gate (GMeet only).
}
function cleanup() {
    if (speakerManager) {
        speakerManager.removeAll();
        speakerManager = null;
    }
}
'''

identity_out = patch.patch_identity(identity)
index_out = patch.patch_index(index)

assert "state.speaking.length !== 1" in identity_out
assert "LOCKED PERMANENTLY" not in identity_out
assert "gmeetTurnAttributor.observe" in index_out
assert "retireGmeetTurn(decision.previousTurnId)" in index_out
assert "gmeetTurnAttributor.clear()" in index_out
assert "let speakerId = `speaker-${speakerIndex}`" in index_out

print("vexa gmeet build-patch anchors: PASS")
