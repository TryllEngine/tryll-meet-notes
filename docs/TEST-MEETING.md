# Google Meet speaker-attribution test

Run this only after the current production meeting is finished and the patched
image has been built explicitly. The test uses two controlled Google accounts;
no voice enrollment and no live captions are required.

## Safety preflight

1. Confirm there are no production meetings in progress or starting soon.
2. Record the current `vexa-lite` image ID so rollback is one command away.
3. Run `npm run typecheck`, `npm run test:identity`, and `npm run test:gmeet-turns`.
4. Build the candidate image, but do not replace the running container until the
   operator explicitly starts the test window.
5. Enable raw capture for the test candidate so audio, turn decisions, and the
   final transcript can be compared offline.

## Scripted call

Account A and Account B should read the exact markers aloud. Leave a short pause
between numbered sections, but not between lines inside a section.

1. **Solo baseline**
   - A: `A01 alpha owns the red notebook.`
   - B: `B01 bravo owns the blue notebook.`
2. **Fast hand-off**
   - A: `A02 the launch is Monday.`
   - B starts within 300 ms: `B02 correction, the launch is Tuesday.`
3. **Short interruption**
   - A: `A03 I am describing the partnership plan.`
   - B interrupts with: `B03 wait.`
   - A continues: `A04 the plan has three stages.`
4. **Sustained overlap**
   - A continuously repeats `A05 red green orange` for five seconds.
   - At the same time B repeats `B05 circle square triangle` for five seconds.
5. **Channel reuse after silence**
   - Stay silent for three seconds.
   - B: `B06 this is the first line after silence.`
   - A: `A06 this is the second line after silence.`
6. **Participant lifecycle**
   - B leaves, rejoins, and says: `B07 I rejoined the meeting.`
   - A says: `A07 the lifecycle test is complete.`
7. **Action ownership**
   - A: `A08 I will send the deck.`
   - B: `B08 I will review the deck.`

## Acceptance gates

- Every named marker is attributed to the account that spoke it.
- No marker from A appears inside a B turn and vice versa.
- `A05` and `B05` exist as separate overlapping time ranges.
- A channel reused after the silence does not inherit its previous name.
- A leave/rejoin creates a fresh turn without relabeling completed turns.
- Ambiguous evidence is `Unknown`; it is never guessed from attendee order.
- Notes keep exact transcript labels. `A08` belongs to A, `B08` belongs to B;
  any unsupported owner is `Unassigned`.
- Zero false named attributions is mandatory. Unknown coverage is measured and
  improved later, but never by restoring a guessing fallback.

Keep the previous image available until the raw capture, transcript, and notes
all pass these gates. Roll back immediately if any production-like marker is
assigned to the wrong account.
