import json
from pathlib import Path

ITEMS_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "items.json"

with open(ITEMS_PATH, encoding="utf-8") as _f:
    _data = json.load(_f)

RECIPES = {r["key"]: r for r in _data["recipes"]}
RECIPE_KEYS = list(RECIPES.keys())
POOL_KEYS = {p["key"] for p in _data["pool"]}


def answer_variants(recipe):
    return recipe.get("answers") or [recipe["components"]]


def selection_matches(variant, selected):
    need = {c["key"]: c["count"] for c in variant}
    if len(need) != len(selected):
        return False
    return all(selected.get(key) == count for key, count in need.items())


def is_correct(recipe, selected):
    return any(selection_matches(variant, selected) for variant in answer_variants(recipe))
