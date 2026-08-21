"""SQLite persistence for game entries (WAL, single table)."""

import sqlite3
from contextlib import contextmanager

from scientifica import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    game_image_id TEXT NOT NULL,
    guess INTEGER NOT NULL,
    time_seconds REAL NOT NULL,
    score INTEGER NOT NULL,
    true_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def init() -> None:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(entries)")}
        if "true_count" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN true_count INTEGER")


@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def add_entry(name: str, game_image_id: str, guess: int, time_seconds: float, score: int, true_count: int | None = None) -> dict:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO entries (name, game_image_id, guess, time_seconds, score, true_count) VALUES (?,?,?,?,?,?)",
            (name, game_image_id, guess, time_seconds, score, true_count),
        )
        row = conn.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


def delete_entry(entry_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
    return cur.rowcount > 0


def ranked_entries(limit: int | None = None) -> list[dict]:
    """Entries ordered by score desc (ties: earlier submission wins), rank attached."""
    q = "SELECT * FROM entries ORDER BY score DESC, created_at ASC, id ASC"
    if limit:
        q += f" LIMIT {int(limit)}"
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(q).fetchall()]
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    return rows


def rank_of(entry_id: int) -> tuple[int, int]:
    """(rank, total) of one entry within the full ordering."""
    rows = ranked_entries()
    for row in rows:
        if row["id"] == entry_id:
            return row["rank"], len(rows)
    raise KeyError(entry_id)
