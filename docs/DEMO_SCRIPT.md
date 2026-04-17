# Demo Script

90 seconds. Record this for the submission video and rehearse it before the live round.

## Pre-roll checklist

- Backend hitting `/readyz` returns 200 within 1s (warm)
- Test PDF open in a browser tab, ready to drag
- Second Chrome window set to the teacher dashboard
- Audio checked, screen recording at 1080p
- Network test: the demo works even with flaky wifi

## Script

**[0:00 - 0:10] Hook**

> "In most African classrooms, 40 students share one textbook and one teacher has no way to see who actually understands what. GemmaPlay fixes that."

Visual: opening shot of the upload screen.

**[0:10 - 0:25] Upload**

> "I'm a Grade 7 biology teacher. Here's my photosynthesis lesson as a PDF."

Drag the file in. Click Generate Game.

> "In about 20 seconds, Gemma 4 extracts the key concepts and builds a playable game."

Visual: lesson processing → game screen appears.

**[0:25 - 0:55] Play**

> "My student opens it on a shared tablet."

Runner scene active. Answer the first question correctly, show the score bump.

> "She got the second one wrong. Watch the game adapt."

Miss the next question on purpose. Hint card appears, options reduce to 2.

> "The Adaptation Agent responds in milliseconds because the rules are in-process — no roundtrip to the model."

Answer the hinted question correctly, move on.

**[0:55 - 1:15] Report**

> "When she finishes, I open my dashboard."

Switch to teacher view. Click the latest report.

> "Score, time, hints used, and a Gemma-written summary I can act on. I know to re-teach the Calvin cycle before the next class."

Visual: report modal with narrative highlighted.

**[1:15 - 1:30] Closer**

> "The same code runs on-device with Ollama. No internet after the game is generated. That's the point — AI that reaches the kids who are usually last in line for it. GemmaPlay: any lesson, any classroom, playable in 60 seconds."

Visual: logo on dark background, URL overlay.

## Recording tips

**Record in one take if possible.** Edited-together demos look worse than a clean take, even with small stumbles. Rehearse the whole flow 5 times before the first recording.

**Pre-generate a fallback.** Have a known-good `game.json` ready. If Gemma stalls during the live demo, inject the cached game with a keystroke. The judges never see it.

**Keep the mouse calm.** Slow, deliberate clicks. No jittering over UI.

**Cut to 90 seconds.** If it runs to 2 minutes, cut the hook. Keep the upload-play-report loop. That's what wins.

## Offline demo variant

For the live round (if judges want to see the offline story):

1. Before demo: disconnect wifi
2. Backend is already running on Ollama (verified with `/readyz`)
3. Upload a pre-downloaded PDF (already on disk)
4. Same flow as above
5. Open network tab in DevTools to show zero outbound calls

This is the differentiator. Budget 30 extra seconds for it if they ask.

## FAQ prep (what judges will ask)

**"Why a game instead of just a quiz?"**
> Games hold attention longer and the Adaptation Agent can adjust pacing, not just question order. For classrooms where students share devices, engagement per minute matters more than coverage.

**"Is the adaptation really meaningful or cosmetic?"**
> It's rule-based and measurable. Two wrong answers on a concept triggers a hint card and reduces options 4→2. Two correct streaks bump speed and obstacle density. Every adjustment is logged and shows up in the teacher report.

**"How do you prevent hallucinated questions?"**
> Lesson Agent runs retrieval over the uploaded document and the prompt explicitly forbids inventing facts. Output is Pydantic-validated. If Gemma returns something malformed, we retry once with the validation error, then fail loud.

**"Why Gemma and not a bigger model?"**
> Size matters for on-device. The offline toggle is the entire point for our target users. Gemma 4 9B is the smallest model that still produces reliable structured output, which is exactly what we need.

**"What's the business model?"**
> Not part of the hackathon ask, but: per-school SaaS for private schools, sponsored deployment for public schools via telecoms and NGOs. Zero-marginal-cost once the model runs on-device.
