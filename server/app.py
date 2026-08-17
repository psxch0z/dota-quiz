import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session

import db
import quiz_data
import steam_auth

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
load_dotenv(ROOT / ".env")

STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")
SITE_URL = os.environ.get("SITE_URL", "http://localhost:8420").rstrip("/")
VALID_MODES = {"easy", "hard"}

MAX_SELECTED_ENTRIES = 15
MIN_ANSWER_INTERVAL = 0.25  # секунд между ответами — простая защита от скриптового спама

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "dev-only-insecure-key"

db.init_db()


# ---------- статика (тот же фронтенд, что раньше отдавал scripts/serve.py) ----------


@app.after_request
def add_no_cache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


@app.route("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(PUBLIC_DIR, filename)


# ---------- вход через Steam ----------


@app.route("/auth/login")
def auth_login():
    return_to = f"{SITE_URL}/auth/callback"
    url = steam_auth.build_login_url(return_to, SITE_URL)
    return redirect(url)


@app.route("/auth/callback")
def auth_callback():
    steamid = steam_auth.verify_callback(request.args)
    if not steamid:
        return redirect("/?login=failed")

    summary = None
    if STEAM_API_KEY:
        try:
            summary = steam_auth.fetch_player_summary(steamid, STEAM_API_KEY)
        except Exception:
            summary = None

    persona_name = (summary or {}).get("persona_name") or f"Player {steamid}"
    avatar_url = (summary or {}).get("avatar_url")
    db.upsert_user(steamid, persona_name, avatar_url)

    session["steamid"] = steamid
    return redirect("/")


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("steamid", None)
    return jsonify({"ok": True})


# ---------- API ----------


@app.route("/api/me")
def api_me():
    steamid = session.get("steamid")
    if not steamid:
        return jsonify({"user": None})
    user = db.get_user(steamid)
    return jsonify({"user": user})


def _pick_recipe_key(avoid_key=None):
    if len(quiz_data.RECIPE_KEYS) <= 1:
        return quiz_data.RECIPE_KEYS[0]
    while True:
        key = random.choice(quiz_data.RECIPE_KEYS)
        if key != avoid_key:
            return key


def _validate_selected(raw):
    """Проверяет и нормализует присланный игроком выбор компонентов.
    Возвращает None, если формат подозрительный/невалидный."""
    if not isinstance(raw, dict) or not raw or len(raw) > MAX_SELECTED_ENTRIES:
        return None
    selected = {}
    for key, count in raw.items():
        if not isinstance(key, str) or key not in quiz_data.POOL_KEYS:
            return None
        if isinstance(count, bool) or not isinstance(count, int) or not (1 <= count <= 10):
            return None
        selected[key] = count
    return selected


@app.route("/api/round/start", methods=["POST"])
def round_start():
    """Начинает новый раунд (сброс счёта, новый вопрос). Прогресс раунда
    (текущий рецепт, счёт) живёт только в подписанной серверной сессии —
    подделать его без секретного ключа сервера нельзя."""
    data = request.get_json(silent=True) or {}
    mode = data.get("mode")
    if mode not in VALID_MODES:
        return jsonify({"error": "invalid_mode"}), 400

    session["quiz"] = {
        "mode": mode,
        "score": 0,
        "recipe_key": _pick_recipe_key(),
        "answered": False,
        "last_correct": None,
        "last_ts": 0.0,  # 0 => первый ответ раунда никогда не считается "слишком быстрым"
    }
    return jsonify({"recipe_key": session["quiz"]["recipe_key"], "score": 0})


@app.route("/api/round/next", methods=["POST"])
def round_next():
    quiz = session.get("quiz")
    if not quiz:
        return jsonify({"error": "no_active_round"}), 400

    quiz["recipe_key"] = _pick_recipe_key(avoid_key=quiz.get("recipe_key"))
    quiz["answered"] = False
    quiz["last_correct"] = None
    session["quiz"] = quiz
    return jsonify({"recipe_key": quiz["recipe_key"], "score": quiz["score"]})


@app.route("/api/round/answer", methods=["POST"])
def round_answer():
    """Единственное место, где начисляются очки. Правильность ответа
    проверяется здесь же по серверной копии данных о предметах — клиент
    присылает только выбор компонентов, а не готовый счёт."""
    quiz = session.get("quiz")
    if not quiz or not quiz.get("recipe_key"):
        return jsonify({"error": "no_active_round"}), 400
    if quiz.get("answered"):
        return jsonify({"error": "already_answered"}), 400

    now = time.time()
    if now - quiz.get("last_ts", 0) < MIN_ANSWER_INTERVAL:
        return jsonify({"error": "too_fast"}), 429

    recipe = quiz_data.RECIPES.get(quiz["recipe_key"])
    if recipe is None:
        return jsonify({"error": "unknown_recipe"}), 400

    body = request.get_json(silent=True) or {}
    selected = _validate_selected(body.get("selected"))
    if selected is None:
        return jsonify({"error": "invalid_selection"}), 400

    correct = quiz_data.is_correct(recipe, selected)
    quiz["score"] = quiz["score"] + 10 if correct else 0
    quiz["answered"] = True
    quiz["last_correct"] = correct
    quiz["last_ts"] = now
    session["quiz"] = quiz

    best_updated = False
    steamid = session.get("steamid")
    if correct and steamid:
        best_updated = db.submit_score(steamid, quiz["mode"], quiz["score"])

    return jsonify({"correct": correct, "score": quiz["score"], "best_updated": best_updated})


@app.route("/api/round/state")
def round_state():
    quiz = session.get("quiz")
    if not quiz:
        return jsonify({"active": False})
    return jsonify(
        {
            "active": True,
            "mode": quiz["mode"],
            "recipe_key": quiz.get("recipe_key"),
            "score": quiz["score"],
            "answered": quiz.get("answered", False),
            "last_correct": quiz.get("last_correct"),
        }
    )


@app.route("/api/leaderboard")
def api_leaderboard():
    mode = request.args.get("mode", "easy")
    if mode not in VALID_MODES:
        return jsonify({"error": "invalid_mode"}), 400
    rows = db.get_leaderboard(mode)
    return jsonify({"mode": mode, "leaderboard": rows})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8420))
    # debug=False: во flask-режиме отладки (PIN интерактивного дебаггера,
    # автоперезагрузчик) иногда намертво зависает при запуске из фонового
    # процесса на Windows и порт вообще не открывается. Для реальной
    # отладки трейсбек всё равно виден в консоли/логах — debug тут не нужен.
    app.run(host="0.0.0.0", port=port, debug=False)
