# Architecture

High-level map of GemmaPlay. For the build-order view, see [DEV_GUIDE.md](DEV_GUIDE.md).

## System diagram

```
┌──────────────┐                    ┌──────────────┐
│   Teacher    │  upload PDF        │   Student    │  play game
│   (browser)  │─────────┐          │   (browser)  │─────────┐
└──────────────┘         │          └──────────────┘         │
                         ▼                                    ▼
                 ┌────────────────────────────────────────────────┐
                 │           FastAPI backend (Cloud Run)          │
                 │                                                │
                 │   /api/lessons       /api/sessions             │
                 │       │                 │                      │
                 │       ▼                 ▼                      │
                 │   Orchestrator ─────────────► Agents           │
                 │       │                       ┌────────┐       │
                 │       │                       │ Lesson │──┐    │
                 │       │                       ├────────┤  │    │
                 │       │                       │  Game  │  │    │
                 │       │                       ├────────┤  │    │
                 │       │                       │Adapt.  │  │    │
                 │       │                       ├────────┤  │    │
                 │       │                       │Report  │  │    │
                 │       │                       └────┬───┘  │    │
                 │       │                            │      │    │
                 │       ▼                            ▼      ▼    │
                 │    SQLite / Cloud SQL        Gemma 4 client    │
                 └────────────────────────────────┬─────────┬─────┘
                                                  │         │
                                         ┌────────▼───┐  ┌──▼────────┐
                                         │  Google    │  │  Ollama   │
                                         │ AI Studio  │  │ (offline) │
                                         └────────────┘  └───────────┘
```

## Data flow (happy path)

1. Teacher uploads `photosynthesis.pdf` → `POST /api/lessons`
2. Orchestrator extracts text → `LessonAgent` → Gemma call → validated `Lesson`
3. `GameAgent` maps lesson concepts to levels → `Game` (deterministic, no LLM)
4. Both persisted, `{ lesson_id, game_id }` returned to frontend
5. Student opens `/play?game_id=...` → frontend fetches `/api/games/{id}/full`
6. `POST /api/sessions/start` → session row created
7. Phaser renders levels. Each answer → `POST /api/sessions/event` → `AdaptationAgent` rule result
8. Frontend applies signal in real time (speed bump, hint card, reduced options)
9. Level done → `POST /api/sessions/end` → `ReportingAgent` builds numeric stats + Gemma narrative
10. Teacher dashboard polls `/api/sessions/reports` and renders

## Agent contracts

All contracts are Pydantic models in `backend/app/models/schemas.py`. Agents communicate through JSON artifacts, never by method call:

| Agent       | Input              | Output              | Uses Gemma? |
|-------------|--------------------|---------------------|-------------|
| Lesson      | `str` source text  | `Lesson`            | Yes         |
| Game        | `Lesson`           | `Game`              | No          |
| Adaptation  | `GameplayEvent`    | `AdaptationSignal`  | No (rules)  |
| Reporting   | session summary    | `Report`            | Yes (narrative only) |

## Why these boundaries

**Pydantic contracts everywhere.** Every LLM output is validated before another agent can use it. If Gemma returns malformed JSON, we catch it at the boundary, not three layers deep in game state.

**Game agent is deterministic.** We don't burn Gemma calls on level layout. Same lesson always produces the same game structure, which makes debugging and caching trivial.

**Adaptation is rule-based.** The game loop needs millisecond response, not a 2-second Gemma roundtrip. Rules run in-process. If we later want an LLM-based hint explainer, it plugs in separately without blocking gameplay.

**Storage abstraction.** Local filesystem for dev, GCS for Cloud Run. One env var swap, no code change.

**Gemma provider abstraction.** Same client interface for Google AI Studio (demo) and Ollama (offline). One env var swap.

## Scaling notes

For the hackathon MVP, single Cloud Run instance, SQLite. If/when usage grows:

- Move DB to Cloud SQL Postgres (DATABASE_URL change)
- Move adaptation state out of process memory to Redis / Memorystore
- Separate background jobs (lesson ingestion) from request-path agents via Cloud Tasks
- Add per-teacher authentication (Firebase Auth is the natural fit)

None of this is needed to ship the hackathon submission.
