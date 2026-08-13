import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session

import db
import steam_auth

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
load_dotenv(ROOT / ".env")

STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")
SITE_URL = os.environ.get("SITE_URL", "http://localhost:8420").rstrip("/")
VALID_MODES = {"easy", "hard"}

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


@app.route("/api/score", methods=["POST"])
def api_score():
    steamid = session.get("steamid")
    if not steamid:
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    mode = data.get("mode")
    score = data.get("score")

    if mode not in VALID_MODES:
        return jsonify({"error": "invalid_mode"}), 400
    if not isinstance(score, int) or score < 0:
        return jsonify({"error": "invalid_score"}), 400

    updated = db.submit_score(steamid, mode, score)
    return jsonify({"ok": True, "updated": updated})


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
