"use strict";

const UNKNOWN = "Unknown";

/**
 * Treat a Google Meet media channel as transport, not identity. A channel can
 * be reused, so attribution is scoped to a turn and a silence gap closes it.
 * A name is accepted only after repeated exclusive DOM observations; overlap
 * and missing evidence never vote and therefore never rename a turn.
 */
class GMeetTurnAttributor {
  constructor({ stableObservations = 3, turnGapMs = 1200 } = {}) {
    this.stableObservations = stableObservations;
    this.turnGapMs = turnGapMs;
    this.tracks = new Map();
    this.nextTurn = 1;
  }

  newTurn(trackIndex, nowMs) {
    return {
      turnId: `gmeet-${trackIndex}-turn-${this.nextTurn++}`,
      name: UNKNOWN,
      lastAudioMs: nowMs,
      candidate: "",
      candidateCount: 0,
    };
  }

  observe(trackIndex, exclusiveCandidate, nowMs) {
    const candidate = (exclusiveCandidate || "").trim();
    let track = this.tracks.get(trackIndex);
    let previousTurnId;
    let action = "continue";

    if (!track) {
      track = this.newTurn(trackIndex, nowMs);
      this.tracks.set(trackIndex, track);
      action = "start";
    } else if (nowMs - track.lastAudioMs >= this.turnGapMs) {
      previousTurnId = track.turnId;
      track = this.newTurn(trackIndex, nowMs);
      this.tracks.set(trackIndex, track);
      action = "rotate";
    }
    track.lastAudioMs = nowMs;

    if (!candidate) {
      track.candidate = "";
      track.candidateCount = 0;
      return { action, previousTurnId, turnId: track.turnId, name: track.name };
    }

    if (candidate === track.candidate) track.candidateCount += 1;
    else {
      track.candidate = candidate;
      track.candidateCount = 1;
    }

    // The first exclusive observation of a different person closes the named
    // turn immediately. Its audio goes to a fresh Unknown turn while the new
    // name stabilizes, so those onset frames can never leak into the old name.
    if (track.name !== UNKNOWN && candidate !== track.name) {
      previousTurnId = track.turnId;
      const next = this.newTurn(trackIndex, nowMs);
      next.candidate = candidate;
      next.candidateCount = 1;
      this.tracks.set(trackIndex, next);
      return { action: "rotate", previousTurnId, turnId: next.turnId, name: next.name };
    }

    if (track.candidateCount < this.stableObservations || candidate === track.name) {
      return { action, previousTurnId, turnId: track.turnId, name: track.name };
    }

    if (track.name === UNKNOWN) {
      track.name = candidate;
      return { action: "rename", previousTurnId, turnId: track.turnId, name: track.name };
    }

    return { action, previousTurnId, turnId: track.turnId, name: track.name };
  }

  clear() {
    this.tracks.clear();
    this.nextTurn = 1;
  }
}

module.exports = { GMeetTurnAttributor, UNKNOWN };
