"""The four agents of GemmaPlay.

- LessonAgent:     source material -> structured Lesson
- GameAgent:       Lesson -> Game (quiz_runner)
- AdaptationAgent: gameplay events -> real-time difficulty signals
- ReportingAgent:  session log -> Report

Each agent has a single public method and a clean input/output contract
(see app.models.schemas). No agent calls another agent directly.
"""
