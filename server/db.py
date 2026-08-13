import os

import psycopg
from psycopg.rows import dict_row

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    steamid TEXT PRIMARY KEY,
    persona_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
    steamid TEXT NOT NULL REFERENCES users(steamid),
    mode TEXT NOT NULL,
    best_score INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (steamid, mode)
);
"""


def get_connection():
    database_url = os.environ.get("DATABASE_URL", "")
    return psycopg.connect(database_url, row_factory=dict_row, connect_timeout=10)


def init_db():
    with get_connection() as conn:
        conn.execute(SCHEMA)


def upsert_user(steamid, persona_name, avatar_url):
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO users (steamid, persona_name, avatar_url)
            VALUES (%s, %s, %s)
            ON CONFLICT (steamid) DO UPDATE SET
                persona_name = excluded.persona_name,
                avatar_url = excluded.avatar_url
            """,
            (steamid, persona_name, avatar_url),
        )


def get_user(steamid):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT steamid, persona_name, avatar_url FROM users WHERE steamid = %s",
            (steamid,),
        ).fetchone()
        return dict(row) if row else None


def submit_score(steamid, mode, score):
    """Записывает результат, если он лучше текущего личного максимума.
    Возвращает True, если рекорд обновился."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT best_score FROM scores WHERE steamid = %s AND mode = %s",
            (steamid, mode),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO scores (steamid, mode, best_score) VALUES (%s, %s, %s)",
                (steamid, mode, score),
            )
            return True
        if score > row["best_score"]:
            conn.execute(
                """
                UPDATE scores SET best_score = %s, updated_at = now()
                WHERE steamid = %s AND mode = %s
                """,
                (score, steamid, mode),
            )
            return True
        return False


def get_leaderboard(mode, limit=20):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT u.persona_name, u.avatar_url, s.best_score, s.steamid
            FROM scores s
            JOIN users u ON u.steamid = s.steamid
            WHERE s.mode = %s
            ORDER BY s.best_score DESC, s.updated_at ASC
            LIMIT %s
            """,
            (mode, limit),
        ).fetchall()
        return [dict(r) for r in rows]
