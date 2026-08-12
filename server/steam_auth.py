"""
Вход через Steam по протоколу OpenID 2.0.

У Steam нет привычного OAuth с client_id/client_secret и регистрацией
callback-адреса — любой сайт может инициировать вход, указав свой
return_to URL. Подлинность ответа проверяется отдельным запросом
(check_authentication) обратно к Steam.

Документация: https://partner.steamgames.com/doc/features/auth#website
"""
import requests

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
STEAM_API_SUMMARY_URL = (
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"
)


def build_login_url(return_to, realm):
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    req = requests.PreparedRequest()
    req.prepare_url(STEAM_OPENID_URL, params)
    return req.url


def verify_callback(args):
    """
    args — словарь query-параметров из callback-запроса (request.args).
    Возвращает steamid64 (строка) при успехе, иначе None.
    """
    if args.get("openid.mode") != "id_res":
        return None

    verify_params = dict(args)
    verify_params["openid.mode"] = "check_authentication"

    resp = requests.post(STEAM_OPENID_URL, data=verify_params, timeout=10)
    if "is_valid:true" not in resp.text:
        return None

    claimed_id = args.get("openid.claimed_id", "")
    # ожидаемый формат: https://steamcommunity.com/openid/id/<steamid64>
    if "/openid/id/" not in claimed_id:
        return None
    steamid = claimed_id.rsplit("/", 1)[-1]
    if not steamid.isdigit():
        return None
    return steamid


def fetch_player_summary(steamid, api_key):
    resp = requests.get(
        STEAM_API_SUMMARY_URL,
        params={"key": api_key, "steamids": steamid},
        timeout=10,
    )
    resp.raise_for_status()
    players = resp.json().get("response", {}).get("players", [])
    if not players:
        return None
    player = players[0]
    return {
        "persona_name": player.get("personaname", f"Player {steamid}"),
        "avatar_url": player.get("avatarfull") or player.get("avatar"),
    }
