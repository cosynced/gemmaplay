# GemmaPlay — Development Guide

**Mission:** Any lesson, any classroom, playable in 60 seconds.

Hackathon: Kaggle Gemma 4 Good Hackathon
Deadline: May 18, 2026
Build target: working demo + deployable prototype

---

## 0. North Star

Before writing any code, re-read this:

**The demo is the product.** Everything you build should serve a 60-second judge-facing demo where a PDF becomes a playable game and a teacher sees results. If a feature does not make the demo better, it does not belong in the MVP.

**One game type: quiz runner.** No matching games. No multiplayer. No custom sprites. If you feel the urge to add a second game type, close the laptop and go for a walk.

**On-device Gemma 4 is the differentiator.** Every architectural decision should protect the offline story. If something requires cloud to run, it is optional, not core.

---

## 1. Tech Stack

### Core
- **Frontend / game:** React + Phaser 3 (2D game engine, battle-tested, runs in browser)
- **Backend:** Python 3.11, FastAPI
- **Model:** Gemma 4 (local inference via Ollama or llama.cpp for demo; Kaggle-hosted for submission)
- **Storage:** SQLite for MVP (zero setup, good enough for demo). Postgres later if needed.
- **Deployment:** Single Docker container for the backend, static frontend on Vercel or Netlify

### Why this stack
- **Phaser over Unity:** runs in browser, no install, judges can play instantly from a link
- **React shell around Phaser:** easy to build the teacher dashboard and upload UI in the same app
- **FastAPI over Flask:** async support for streaming model outputs, Pydantic for agent I/O contracts
- **SQLite over Postgres for MVP:** one file, zero ops, demo-ready
- **Ollama for local demo:** pulls Gemma 4, exposes OpenAI-compatible API, works offline — matches the product story

### Skip for MVP
- Authentication (use a hardcoded teacher ID for demo)
- Real-time multiplayer
- CDN, caching layers, Redis
- Custom art pipelines (use free sprite packs from itch.io or Kenney.nl)

---

## 2. System Architecture

```
┌─────────────┐
│   Teacher   │ uploads PDF
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│           FastAPI Backend                   │
│                                             │
│  ┌───────────┐   ┌───────────┐              │
│  │  Lesson   │──▶│   Game    │──▶ game.json │
│  │   Agent   │   │   Agent   │              │
│  └───────────┘   └───────────┘              │
│         │               │                   │
│         ▼               ▼                   │
│  ┌───────────────────────────┐              │
│  │     Gemma 4 (local)       │              │
│  └───────────────────────────┘              │
│                                             │
│  ┌───────────┐   ┌───────────┐              │
│  │Adaptation │   │ Reporting │              │
│  │   Agent   │   │   Agent   │              │
│  └───────────┘   └───────────┘              │
└─────────────────────────────────────────────┘
       │                       │
       ▼                       ▼
┌─────────────┐         ┌─────────────┐
│   Student   │         │   Teacher   │
│  (Phaser)   │         │  Dashboard  │
└─────────────┘         └─────────────┘
```

**Data flow:**
1. Teacher uploads PDF → Lesson Agent extracts concepts → stored as `lesson.json`
2. Game Agent consumes `lesson.json` → emits `game.json` (levels, questions, answers)
3. Student plays → Phaser sends gameplay events → Adaptation Agent adjusts on the fly
4. Session ends → Reporting Agent produces `report.json` → teacher dashboard renders it

---

## 3. The Four Agents

Each agent is a Python module with a clean input/output contract. No agent talks to another agent directly — they communicate through JSON artifacts stored in the DB.

### 3.1 Lesson Agent

**Input:** PDF file or raw text
**Output:** `lesson.json`

```json
{
  "lesson_id": "uuid",
  "title": "Photosynthesis",
  "subject": "Biology",
  "grade_level": "Grade 7",
  "concepts": [
    {
      "id": "c1",
      "name": "Chlorophyll captures light",
      "summary": "Chlorophyll in chloroplasts absorbs sunlight to start photosynthesis.",
      "questions": [
        {
          "q": "What molecule captures sunlight in plants?",
          "options": ["Chlorophyll", "Glucose", "Oxygen", "Water"],
          "answer_index": 0,
          "difficulty": "easy"
        }
      ]
    }
  ]
}
```

**Rules:**
- Extract 3 to 5 concepts. Not 2, not 10. Three to five.
- Each concept gets 3 questions: 1 easy, 1 medium, 1 hard
- Questions must be answerable from the source material (retrieval-grounded)
- No hallucinated facts. If the lesson does not mention mitochondria, do not ask about mitochondria.

**Implementation notes:**
- Use `pypdf` or `pdfplumber` for PDF extraction
- Chunk the document, embed chunks with a small local embedding model (or skip embeddings for MVP and just pass full text if under 8k tokens)
- Single Gemma 4 call with a strict JSON schema prompt
- Validate output with Pydantic before passing to Game Agent

### 3.2 Game Agent

**Input:** `lesson.json`
**Output:** `game.json`

```json
{
  "game_id": "uuid",
  "lesson_id": "uuid",
  "game_type": "quiz_runner",
  "levels": [
    {
      "level_id": "l1",
      "concept_id": "c1",
      "target_distance": 1000,
      "base_speed": 200,
      "obstacle_density": 0.3,
      "questions": ["q1", "q2", "q3"]
    }
  ]
}
```

**Rules:**
- One level per concept
- Each level pulls from that concept's question pool
- Questions appear as answer-gates: player must choose the correct option to pass
- Wrong answer = slow down + lose health, not instant death

**Implementation notes:**
- This agent is mostly deterministic — it does not need Gemma for MVP
- Template-based: take `lesson.json`, fill in a game template, emit `game.json`
- Save the Gemma budget for lesson understanding and adaptation

### 3.3 Adaptation Agent

**Input:** live gameplay events
**Output:** difficulty adjustments sent back to Phaser

**The concrete rule set:**

| Trigger | Action |
|---------|--------|
| 2 wrong on same concept | Insert hint card before next question, reduce options 4 → 2 |
| 2 correct streak on concept | Increase obstacle density +20%, speed +10% |
| Hint used | Mark concept as "needs review" in session log |
| Level completed with <50% correct | Re-queue that concept at end of game |

**Implementation notes:**
- This is rule-based, NOT LLM-based, for MVP. Judges will ask about latency. Rules are instant.
- You can add an LLM-based "explainer" layer that generates a one-sentence hint when the hint card triggers — this IS a good Gemma use case, and the latency is acceptable because gameplay pauses while the hint shows.
- Track events in memory during a session, persist on session end

### 3.4 Reporting Agent

**Input:** session log
**Output:** `report.json`

```json
{
  "report_id": "uuid",
  "student_id": "stu_001",
  "lesson_id": "uuid",
  "score": 78,
  "concepts_mastered": ["c1", "c3"],
  "concepts_weak": ["c2"],
  "time_seconds": 412,
  "hints_used": 3,
  "narrative": "Student showed strong grasp of chlorophyll and light reactions. Struggled with the Calvin cycle — consider re-teaching with a visual diagram."
}
```

**Rules:**
- Numeric fields are computed directly from the session log (no LLM needed)
- The `narrative` field uses Gemma 4 to write a 1-2 sentence teacher-facing summary
- Mastery threshold: 2 of 3 questions correct on a concept without hints

---

## 4. Gemma 4 Usage

You have a Gemma-budget. Spend it on the things that actually need generation:

| Agent | Uses Gemma? | Why |
|-------|-------------|-----|
| Lesson Agent | Yes | Concept extraction + question generation requires real understanding |
| Game Agent | No | Template-based assembly is deterministic |
| Adaptation Agent | Optional | Rules handle core logic; Gemma can generate hint text |
| Reporting Agent | Yes (narrative only) | One call per session for the teacher-facing summary |

**Prompt discipline:**
- Every Gemma call returns JSON matching a Pydantic schema
- Use few-shot examples in every prompt (cheap, big quality gain)
- Temperature 0.2 for extraction, 0.7 for narrative
- If a call fails validation, retry once with the validation error appended to the prompt, then fail loud

**Demo-critical:**
- Run Gemma locally via Ollama during the demo — do NOT depend on network
- Warm up the model at server start so the first request is not cold
- Have a pre-generated `game.json` ready as a fallback if Gemma hangs during the live demo

---

## 5. The Phaser Game

### Quiz runner mechanics

- **Character:** side-scrolling runner, auto-moves right
- **Obstacles:** spawn at configured density, player jumps/slides
- **Question gates:** every ~200px a gate appears with 4 doors labeled A/B/C/D
- **Answer:** player steers into the door they believe is correct
- **Correct:** gate opens, small speed boost, +10 score
- **Wrong:** gate knocks player back, -1 health, wrong-answer counter +1
- **Health:** 3 hearts; losing all 3 ends the level but not the game — they retry with a hint

### Scene structure

```
BootScene      → load sprites, fonts, JSON
LessonIntro    → show lesson title, "Level 1: [concept name]"
GameScene      → the runner itself
LevelEnd       → per-level stats, transition to next concept
SessionEnd     → full report display, "Send to teacher" button
```

### Keep it simple
- Free sprites from Kenney.nl (CC0 license, no attribution needed, quality is good)
- One background parallax layer, one character sprite, four obstacle variants
- Sound effects only — no music (easier to focus, smaller bundle)

---

## 6. Teacher Dashboard

One page. Three sections.

1. **Upload lesson** — file input + "Generate Game" button
2. **Active assignments** — list of lessons with student counts and avg scores
3. **Student reports** — click a student, see their report.json rendered nicely

Build with React + Tailwind. No routing library needed — conditional rendering is fine.

---

## 7. Build Order (Week by Week)

Hackathon deadline: May 18, 2026. Today is April 16. That's 4.5 weeks.

### Week 1 (Apr 16 - Apr 22): Skeleton
- FastAPI backend scaffolded, SQLite connected
- Ollama running locally with Gemma 4
- Lesson Agent working end to end on one test PDF
- Emit valid `lesson.json`
- **Milestone:** paste a PDF path, get structured concepts back

### Week 2 (Apr 23 - Apr 29): Game generation + Phaser shell
- Game Agent producing `game.json` from `lesson.json`
- Phaser project set up, boot scene, one playable level hardcoded
- Load `game.json` into Phaser, render questions on gates
- **Milestone:** upload PDF, see a playable level with real questions from the PDF

### Week 3 (Apr 30 - May 6): Adaptation + full game loop
- Adaptation rules wired into GameScene
- Multiple levels, session state, health/score tracking
- Session log persisted to DB
- **Milestone:** full game playable from start to finish on a real lesson

### Week 4 (May 7 - May 13): Reporting + teacher dashboard
- Reporting Agent producing `report.json`
- Teacher dashboard rendering upload → assignments → reports
- Gemma-generated narrative for reports
- **Milestone:** full teacher-student loop works

### Week 5 (May 14 - May 18): Polish + submission
- Record demo video (60-90 seconds, scripted)
- Deploy backend to Render or Fly.io, frontend to Vercel
- Write the Kaggle submission writeup
- Test cold-start, offline demo, fallback paths
- Submit Friday May 15 or Saturday May 16 — do NOT wait until deadline day

---

## 8. Demo Script (Draft)

Record this as the submission video. Judges will watch this before touching your app.

```
[0:00-0:10] Hook
"In most African classrooms, students share textbooks and teachers
have no way to see who understands what. GemmaPlay fixes that."

[0:10-0:25] Upload
"I'm a Grade 7 teacher. Here's my photosynthesis lesson as a PDF.
I drop it into GemmaPlay..." [upload happens]
"...and in 30 seconds, Gemma 4 has extracted the key concepts
and built a playable game." [game.json appears]

[0:25-0:50] Play
"My student opens the game on a shared tablet."
[play the runner, answer a question wrong]
"She got that wrong — watch the game adapt. Fewer options,
a hint card, and the concept comes back later."
[answer correctly this time]

[0:50-1:10] Report
"When she finishes, I see exactly what she mastered and where
she struggled — with a Gemma-written summary I can act on."
[show dashboard]

[1:10-1:30] Closer
"It runs on-device. No internet after the game is generated.
That's the point. GemmaPlay is AI that reaches students
who are usually last in line for it."
```

---

## 9. Submission Checklist

Pulled straight from the Kaggle rules — verify these against the official page before submitting.

- [ ] Public GitHub repo with MIT or Apache-2.0 license
- [ ] README with setup instructions a judge can follow in under 5 minutes
- [ ] Demo video uploaded (YouTube or Kaggle)
- [ ] Kaggle writeup covering: problem, approach, Gemma usage, impact, what's next
- [ ] Working deployed demo link (even if usage is gated)
- [ ] Screenshot or GIF in the writeup header
- [ ] Explicit Gemma 4 version number cited
- [ ] "For Good" angle clearly stated (offline, African classrooms, underserved learners)

---

## 10. What Will Go Wrong (Plan For It)

**Gemma outputs bad JSON.** Solution: Pydantic validation + one retry with error feedback in the prompt. If that fails, fall back to a pre-generated lesson.

**PDF parsing breaks on scanned images.** Solution: MVP only supports text-based PDFs. Add OCR post-hackathon. Document this clearly.

**Phaser performance tanks on low-end devices.** Solution: test on a cheap Android tablet early. Cap sprite count, use texture atlases, kill particle effects if FPS drops.

**Demo day: no internet.** Solution: the entire stack should run on your laptop with Ollama + SQLite + Phaser in the browser. Test this explicitly once a week.

**Scope creep.** Solution: if you catch yourself adding features, re-read Section 0.

---

## 11. Post-Hackathon (Save for Later)

Write these down and close the tab:

- Matching game, drag-drop, fill-in-the-blank variants
- Multi-student leaderboards
- Teacher account system + assignment distribution
- LMS integration (Google Classroom, Moodle)
- Voice input for students who struggle with reading
- Offline sync when a connection is restored
- Custom branding per school
- Analytics dashboard with class-wide trends
- Neriah integration (same teacher account, same school database)

The Neriah link is the long-term play: GemmaPlay generates the game, Neriah grades the handwritten follow-up. Together they're an AI-first classroom stack for African schools. Do not build the integration during the hackathon.

---

## 12. Daily Rhythm

- Morning: one feature, one commit, one PR
- Afternoon: test on a real PDF you haven't used before
- End of day: can a stranger still run the project with `docker compose up`?
- Friday: record a 30-second progress clip, even if it's rough. Builds demo muscle.

---

**If you are reading this and feel stuck, go back to Section 0. The demo is the product.**
