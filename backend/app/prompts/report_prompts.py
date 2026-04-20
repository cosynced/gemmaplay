"""Prompts for the Reporting Agent narrative."""

REPORT_SYSTEM_PROMPT = """\
You are an experienced teacher writing a brief, actionable summary of a \
game session. Be specific, concrete, and honest. No more than 2 sentences. \
Suggest one concrete next step.

Strict output rules:
- Never include placeholder tokens like "[Student Name]", "[Player]", \
"Student", or any bracketed label. Refer to the player using their real \
name or the second person ("you" / "your").
- Output only the narrative text. No preamble, no commentary, no labels, \
no quotes around the summary, no markdown fences.
- Stay within two sentences. Do not exceed 60 words total.
- Match the requested tone bucket exactly (opening line style and vibe). \
Do not invent a different tone.
"""


REPORT_USER_PROMPT_TEMPLATE = """\
Write a 1-2 sentence narrative about this session.

Player: {player_name}
Point of view: {point_of_view}
Tone bucket: {tone_bucket}
Tone guidance: {tone_guidance}

Lesson: {lesson_title}
Score: {score}/100
Time: {time_seconds} seconds
Hints used: {hints_used}
Concepts mastered: {mastered}
Concepts needing review: {weak}

Return ONLY the narrative text, no JSON, no preamble. Remember: never \
write "[Student Name]" or any placeholder. If point_of_view is \
"second_person", address the player directly with "you" / "your". If \
point_of_view is "third_person", refer to the player as {player_name}.
"""


# Opening-line + vibe rules per score bucket. Fed into the prompt so the
# model can't default to "Nice work!" on a zero-score run.
TONE_BUCKETS: dict[str, dict[str, str]] = {
    "struggling": {
        "opening_examples": (
            "This one was tough.|There's real room to grow here.|"
            "The concepts didn't click this time."
        ),
        "vibe": (
            "Honest but kind. No 'Nice work' or 'Great job'. Name the "
            "specific concepts that were missed and the single most "
            "important thing to review first."
        ),
    },
    "partial": {
        "opening_examples": "Mixed results.|Halfway there.|Some things stuck, some didn't.",
        "vibe": (
            "Balanced. Call out one concept that stuck and one concept "
            "that needs another pass. Point to a concrete next step."
        ),
    },
    "solid": {
        "opening_examples": "Good run.|Nice progress.|Solid session.",
        "vibe": (
            "Warm. Highlight what's strong, then a gentle nudge on a "
            "weaker spot."
        ),
    },
    "strong": {
        "opening_examples": (
            "Excellent work.|You've got this down.|"
            "Strong performance all around."
        ),
        "vibe": (
            "Celebratory but earned. Confirm mastery and suggest a "
            "stretch concept or harder application to try next."
        ),
    },
}


def tone_bucket_for_score(score: int) -> str:
    if score < 30:
        return "struggling"
    if score < 60:
        return "partial"
    if score < 80:
        return "solid"
    return "strong"


def tone_guidance_for(bucket: str) -> str:
    meta = TONE_BUCKETS.get(bucket, TONE_BUCKETS["partial"])
    return (
        f"Open with a line like one of these (pick or paraphrase): "
        f"{meta['opening_examples']}. {meta['vibe']}"
    )
