"""One-off backfill: copy teacher_username from GameRow → SessionRow/ReportRow
for historical rows stuck on 'anon' or empty.

Why this exists: early plays (especially anonymously-created lessons that
were claimed later) captured teacher_username='anon' on the session/report,
so those rows don't surface on the creator's dashboard even though the
underlying game now has a real owner. This copies ownership forward.

Safe to run multiple times — only touches rows where teacher_username is
currently 'anon' or empty and the matching game has a real owner.

Run:
    python -m scripts.backfill_teacher_username           # from backend/
    python -m scripts.backfill_teacher_username --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/backfill_teacher_username.py` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, select  # noqa: E402

from app.db.models import GameRow, ReportRow, SessionRow  # noqa: E402
from app.db.session import _engine  # noqa: E402


NEEDS_BACKFILL = ("", "anon")


def _game_teacher_map(db: Session) -> dict[str, str]:
    return {
        g.game_id: g.teacher_username
        for g in db.exec(select(GameRow)).all()
        if g.teacher_username and g.teacher_username != "anon"
    }


def backfill(dry_run: bool = False) -> dict[str, int]:
    with Session(_engine) as db:
        game_map = _game_teacher_map(db)

        session_updates = 0
        for s in db.exec(select(SessionRow)).all():
            if s.teacher_username not in NEEDS_BACKFILL:
                continue
            owner = game_map.get(s.game_id)
            if not owner:
                continue
            session_updates += 1
            if not dry_run:
                s.teacher_username = owner
                db.add(s)

        # Reports store lesson_id (not game_id), but also session_id —
        # prefer the session's now-correct teacher_username, falling back
        # to any game for the same lesson.
        report_updates = 0
        session_teacher = {
            s.session_id: s.teacher_username
            for s in db.exec(select(SessionRow)).all()
            if s.teacher_username not in NEEDS_BACKFILL
        }
        for r in db.exec(select(ReportRow)).all():
            if r.teacher_username not in NEEDS_BACKFILL:
                continue
            owner = session_teacher.get(r.session_id)
            if not owner:
                continue
            report_updates += 1
            if not dry_run:
                r.teacher_username = owner
                db.add(r)

        if not dry_run:
            db.commit()

    return {"sessions": session_updates, "reports": report_updates}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would change without writing.")
    args = parser.parse_args()

    result = backfill(dry_run=args.dry_run)
    verb = "would update" if args.dry_run else "updated"
    print(f"{verb}: sessions={result['sessions']} reports={result['reports']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
