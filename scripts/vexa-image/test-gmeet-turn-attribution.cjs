"use strict";

const assert = require("node:assert/strict");
const { GMeetTurnAttributor, UNKNOWN } = require("./gmeet-turn-attribution.cjs");

const a = new GMeetTurnAttributor({ stableObservations: 3, turnGapMs: 1200 });

const first = a.observe(0, "Alice", 0);
assert.equal(first.name, UNKNOWN, "one glow frame must not name a turn");
assert.equal(a.observe(0, "Alice", 100).name, UNKNOWN);
const verifiedAlice = a.observe(0, "Alice", 200);
assert.equal(verifiedAlice.action, "rename");
assert.equal(verifiedAlice.name, "Alice");

// Overlap never votes and never steals Alice's active turn.
assert.equal(a.observe(0, "", 300).name, "Alice");
assert.equal(a.observe(0, "", 400).name, "Alice");
assert.equal(a.observe(0, "", 500).name, "Alice");

// A different exclusive glow closes Alice immediately. Bob's onset is Unknown
// until stable, never attributed to Alice.
const bobOnset = a.observe(0, "Bob", 600);
assert.equal(bobOnset.action, "rotate");
assert.equal(bobOnset.name, UNKNOWN);
assert.equal(a.observe(0, "Bob", 700).name, UNKNOWN);
assert.equal(a.observe(0, "Bob", 800).name, "Bob");

// A second simultaneous channel is independent and abstains until verified.
assert.equal(a.observe(1, "", 300).name, UNKNOWN);
assert.equal(a.observe(1, "Bob", 400).name, UNKNOWN);
assert.equal(a.observe(1, "Bob", 500).name, UNKNOWN);
assert.equal(a.observe(1, "Bob", 600).name, "Bob");

// Silence closes the transport turn; the reused channel cannot inherit Alice.
const afterGap = a.observe(0, "Alice", 2000);
assert.equal(afterGap.action, "rotate");
assert.equal(afterGap.name, UNKNOWN);
assert.equal(a.observe(0, "Alice", 2100).name, UNKNOWN);
const verifiedAfterGap = a.observe(0, "Alice", 2200);
assert.equal(verifiedAfterGap.name, "Alice");
assert.notEqual(verifiedAfterGap.turnId, verifiedAlice.turnId);

console.log("gmeet turn attribution: PASS (overlap abstains, streams stay parallel, reuse rotates)");
