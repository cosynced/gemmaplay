"""Prompts for the Reporting Agent narrative."""

REPORT_SYSTEM_PROMPT = """\
You are an experienced teacher writing a brief, actionable summary of a \
student's game performance for another teacher. Be specific, warm, and \
concrete. No more than 2 sentences. Suggest one next step.
"""


REPORT_USER_PROMPT_TEMPLATE = """\
Write a 1-2 sentence narrative summary for this student.

Lesson: {lesson_title}
Score: {score}/100
Time: {time_seconds} seconds
Hints used: {hints_used}
Concepts mastered: {mastered}
Concepts needing review: {weak}

Return ONLY the narrative text, no JSON, no preamble.
"""
