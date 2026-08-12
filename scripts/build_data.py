"""
Строит data/items.json из raw dotaconstants items.json (OpenDota).
Запуск: python scripts/build_data.py
Источник raw-файла: https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json

Особенности исходных данных, которые здесь компенсируются:
- Поле "components" у многих предметов НЕ включает сам рецепт (свиток),
  хотя в игре он покупается отдельно и входит в стоимость. Мы восстанавливаем
  этот факт по разнице между ценой предмета и суммой цен его материальных
  составляющих (RECIPE_COST_THRESHOLD golda -> считаем, что рецепт нужен).
- У части предметов рецепт указан явно, но под своим именем (recipe_xxx) или
  как пустая строка "" (баг датасета). Все такие варианты сводятся к ОДНОМУ
  универсальному ключу "recipe" ("Рецепт") в пуле выбора.
- Предметы, у которых после этой очистки остаётся только ОДИН материальный
  компонент (по сути "тот же предмет прошлого тира + рецепт", без реальной
  комбинации из разных вещей), не включаются как цели угадывания — это не
  даёт содержательного вопроса.
"""
import json
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "items_raw.json"
OUT_PATH = ROOT / "public" / "data" / "items.json"

CDN = "https://cdn.cloudflare.steamstatic.com"

EXCLUDED_QUAL = {"neutral"}
RECIPE_COST_THRESHOLD = 20  # золота; разница выше этого — считаем, что нужен рецепт
RECIPE_KEY = "recipe"
RECIPE_NAME = "Рецепт"
RECIPE_IMG = "/apps/dota2/images/dota_react/items/recipe.png"

# dotaconstants — снапшот игровых файлов и иногда хранит legacy-записи предметов,
# которых давно нет в актуальной игре (со старым, давно неактуальным рецептом).
# Проверено вручную:
# - iron_talon: имел рецепт (Quelling Blade + Ring of Protection) только в самых
#   первых версиях предмета; после нескольких переработок предмет полностью
#   удалён из игры в патче 7.39 (2025-05-21) — актуального рецепта не существует.
EXCLUDED_KEYS = {"iron_talon"}


def load_raw():
    with open(RAW_PATH, encoding="utf-8") as f:
        return json.load(f)


def is_candidate(key, v):
    if key in EXCLUDED_KEYS:
        return False
    if not v.get("components"):
        return False
    if v.get("qual") in EXCLUDED_QUAL:
        return False
    if not v.get("dname") or not v.get("img"):
        return False
    return True


def is_recipe_token(c):
    return c == "" or c == RECIPE_KEY or c.startswith("recipe_")


def display_name(key, v):
    name = v.get("dname")
    # disambiguate tiered items sharing the same display name (necronomicon_2/3)
    if key.endswith("_2") and not name.rstrip().endswith("2"):
        return f"{name} 2"
    if key.endswith("_3") and not name.rstrip().endswith("3"):
        return f"{name} 3"
    return name


def make_entry(key, v):
    return {
        "key": key,
        "id": v.get("id"),
        "name": display_name(key, v),
        "img": CDN + v["img"],
        "cost": v.get("cost"),
        "qual": v.get("qual"),
    }


def split_components(raw, v):
    """Returns (material_counter, has_explicit_recipe)."""
    materials = Counter()
    has_recipe = False
    for c in v["components"]:
        if is_recipe_token(c):
            has_recipe = True
            continue
        if c not in raw:
            continue
        materials[c] += 1
    return materials, has_recipe


def needs_recipe(v, materials, raw, has_explicit_recipe):
    if has_explicit_recipe:
        return True
    cost = v.get("cost") or 0
    material_cost = sum((raw[c].get("cost") or 0) * n for c, n in materials.items())
    return (cost - material_cost) > RECIPE_COST_THRESHOLD


def main():
    raw = load_raw()

    recipes = []
    pool_keys = set()
    uses_recipe = False

    for key, v in raw.items():
        if not is_candidate(key, v):
            continue

        materials, has_explicit_recipe = split_components(raw, v)
        # skip if any material referenced isn't resolvable at all (data corruption)
        if len(materials) == 0:
            continue
        # a single material + recipe is just a tier-upgrade, not a real
        # combination question -> skip as a target
        if len(materials) < 2:
            continue

        recipe_needed = needs_recipe(v, materials, raw, has_explicit_recipe)

        entry = make_entry(key, v)
        entry["components"] = [{"key": c, "count": n} for c, n in materials.items()]
        if recipe_needed:
            entry["components"].append({"key": RECIPE_KEY, "count": 1})
            uses_recipe = True

        recipes.append(entry)
        pool_keys.update(materials.keys())

    pool = []
    for key in sorted(pool_keys, key=lambda k: raw[k].get("dname") or k):
        v = raw[key]
        if not v.get("dname") or not v.get("img"):
            continue
        pool.append(make_entry(key, v))

    if uses_recipe:
        pool.append(
            {
                "key": RECIPE_KEY,
                "id": None,
                "name": RECIPE_NAME,
                "alt": "recipe",
                "img": CDN + RECIPE_IMG,
                "cost": None,
                "qual": None,
            }
        )
        pool.sort(key=lambda p: p["name"])

    recipes.sort(key=lambda r: (r["cost"] or 0))

    OUT_PATH.parent.mkdir(exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"recipes": recipes, "pool": pool}, f, ensure_ascii=False, indent=1)

    print(f"recipes: {len(recipes)}, pool items: {len(pool)}")


if __name__ == "__main__":
    main()
