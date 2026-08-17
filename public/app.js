(() => {
  "use strict";

  const STORAGE_KEY = "dq_session";
  const SCREEN_KEY = "dq_screen";
  const RECIPE_KEY = "recipe";
  const EASY_SLOT_COUNT = 8;

  const els = {
    menu: document.getElementById("menu"),
    game: document.getElementById("game"),
    menuBtn: document.getElementById("menuBtn"),
    targetImg: document.getElementById("targetImg"),
    targetName: document.getElementById("targetName"),
    targetCost: document.getElementById("targetCost"),
    tray: document.getElementById("tray"),
    trayEmpty: document.getElementById("trayEmpty"),
    trayWarning: document.getElementById("trayWarning"),
    poolGrid: document.getElementById("poolGrid"),
    search: document.getElementById("search"),
    recipeBtn: document.getElementById("recipeBtn"),
    checkBtn: document.getElementById("checkBtn"),
    clearBtn: document.getElementById("clearBtn"),
    nextBtn: document.getElementById("nextBtn"),
    feedback: document.getElementById("feedback"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    steamLoginBtn: document.getElementById("steamLoginBtn"),
    userChip: document.getElementById("userChip"),
    userAvatar: document.getElementById("userAvatar"),
    userName: document.getElementById("userName"),
    logoutBtn: document.getElementById("logoutBtn"),
    leaderboardBtn: document.getElementById("leaderboardBtn"),
    leaderboardPanel: document.getElementById("leaderboardPanel"),
    lbTabs: document.getElementById("lbTabs"),
    lbList: document.getElementById("lbList"),
  };

  const state = {
    pool: [],
    recipes: [],
    current: null,
    mode: "hard", // "easy" | "hard"
    easyOptions: [], // keys, only used in easy mode
    selected: new Map(), // key -> count
    locked: false,
    score: 0,
    best: Number(localStorage.getItem("dq_best") || 0),
    user: null,
    lbMode: "easy",
  };

  // Счёт и правильность ответа — не клиентская самооценка. Раунд ведёт
  // сервер (подписанная сессия), клиент только запрашивает вопрос и
  // присылает выбор компонентов на проверку — см. server/app.py.
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) throw new Error(data.error || `http_${res.status}`);
    return data;
  }

  async function apiGet(url) {
    const res = await fetch(url, { cache: "no-store" });
    return res.json();
  }

  els.best.textContent = state.best;

  function poolByKey(key) {
    return state.pool.find((p) => p.key === key);
  }

  function recipeByKey(key) {
    return state.recipes.find((r) => r.key === key);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function answerVariants(recipe) {
    return recipe.answers && recipe.answers.length ? recipe.answers : [recipe.components];
  }

  // Если разным вариантам рецепта нужно разное количество одного и того же
  // компонента, берём максимум — этого хватит на выбор любого варианта.
  function maxAnswerCounts(recipe) {
    const counts = new Map();
    for (const variant of answerVariants(recipe)) {
      for (const c of variant) {
        if (c.key === RECIPE_KEY) continue;
        if (c.count > (counts.get(c.key) || 0)) counts.set(c.key, c.count);
      }
    }
    return counts;
  }

  function buildEasyOptions(recipe) {
    const maxCounts = maxAnswerCounts(recipe);
    // Повторяющийся компонент показываем отдельной иконкой на каждую копию
    // (а не одной иконкой со счётчиком) — как было в оригинальной игре.
    const realSlots = [];
    for (const [key, count] of maxCounts.entries()) {
      for (let i = 0; i < count; i++) realSlots.push(key);
    }
    const decoyPool = state.pool.filter(
      (p) => p.key !== RECIPE_KEY && p.key !== recipe.key && !maxCounts.has(p.key)
    );
    const decoysNeeded = Math.max(0, EASY_SLOT_COUNT - realSlots.length);
    const decoys = shuffle(decoyPool).slice(0, decoysNeeded);
    return shuffle([...realSlots, ...decoys.map((p) => p.key)]);
  }

  function slotOccurrenceIndices(keys) {
    const seen = new Map();
    return keys.map((k) => {
      const idx = seen.get(k) || 0;
      seen.set(k, idx + 1);
      return idx;
    });
  }

  // Здесь хранится только косметика UI (что нажато, текст фидбека) — для
  // мгновенного восстановления экрана при перезагрузке. Источник истины по
  // очкам и текущему вопросу — серверная сессия (см. tryResume).
  function saveSession() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentKey: state.current ? state.current.key : null,
        easyOptions: state.easyOptions,
        selected: Array.from(state.selected.entries()),
        feedbackText: els.feedback.textContent,
        feedbackClass: els.feedback.className,
      })
    );
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function showMenu() {
    els.menu.hidden = false;
    els.game.hidden = true;
    els.menuBtn.hidden = true;
    localStorage.setItem(SCREEN_KEY, "menu");
  }

  function showGame() {
    els.menu.hidden = true;
    els.game.hidden = false;
    els.menuBtn.hidden = false;
    localStorage.setItem(SCREEN_KEY, "game");
  }

  function showTarget(item) {
    els.targetImg.src = item.img;
    els.targetImg.alt = item.name;
    els.targetName.textContent = item.name;
    els.targetCost.textContent = item.cost ? `Цена сборки: ${item.cost}` : "";
  }

  async function startMode(mode) {
    state.mode = mode;
    els.search.hidden = mode === "easy";
    showGame();
    els.targetName.textContent = "Загрузка...";
    els.checkBtn.disabled = true;
    try {
      const data = await apiPost("/api/round/start", { mode });
      applyRoundQuestion(data.recipe_key, data.score);
    } catch (err) {
      els.targetName.textContent = "Не удалось начать раунд";
      console.error(err);
    }
  }

  // Показывает вопрос, который выдал сервер (recipe_key), и синхронизирует
  // локальный счёт с тем, что реально записано в серверной сессии.
  function applyRoundQuestion(recipeKey, score) {
    const recipe = recipeByKey(recipeKey);
    if (!recipe) return false;

    state.locked = false;
    state.selected = new Map();
    state.current = recipe;
    state.score = score;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem("dq_best", String(state.best));
    }
    state.easyOptions = state.mode === "easy" ? buildEasyOptions(recipe) : [];

    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    els.nextBtn.hidden = true;
    els.checkBtn.hidden = false;
    els.checkBtn.disabled = false;
    els.score.textContent = state.score;
    els.best.textContent = state.best;

    showTarget(recipe);
    renderPool();
    renderTray();
    saveSession();
    return true;
  }

  async function nextQuestion() {
    els.nextBtn.disabled = true;
    try {
      const data = await apiPost("/api/round/next", {});
      applyRoundQuestion(data.recipe_key, data.score);
    } catch (err) {
      console.error(err);
      showWarning("Не удалось загрузить следующий вопрос");
    } finally {
      els.nextBtn.disabled = false;
    }
  }

  function shakeElement(el) {
    el.classList.remove("shake");
    void el.offsetWidth; // форсируем reflow, чтобы анимация перезапустилась
    el.classList.add("shake");
    el.addEventListener("animationend", () => el.classList.remove("shake"), { once: true });
  }

  let warningTimer = null;
  function showWarning(text) {
    els.trayWarning.textContent = text;
    els.trayWarning.hidden = false;
    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => {
      els.trayWarning.hidden = true;
    }, 1600);
  }

  function totalSelectedCount() {
    let total = 0;
    for (const n of state.selected.values()) total += n;
    return total;
  }

  function handlePoolItemClick(item, div, occurrencesInList) {
    if (state.locked) return;
    const c = state.selected.get(item.key) || 0;
    if (c >= occurrencesInList) {
      shakeElement(div);
      return;
    }
    if (state.mode === "easy" && totalSelectedCount() >= requiredSlotCount(state.current)) {
      shakeElement(div);
      showWarning("Уже выбрано столько компонентов, сколько нужно — сначала убери лишний");
      return;
    }
    state.selected.set(item.key, c + 1);
    renderPool();
    renderTray();
    saveSession();
  }

  function renderPool() {
    els.poolGrid.innerHTML = "";

    const isEasy = state.mode === "easy";

    let items;
    if (isEasy) {
      items = state.easyOptions.map((k) => poolByKey(k)).filter(Boolean);
    } else {
      // В общем списке — ровно одна иконка на предмет (как обычный поиск).
      // Несколько одинаковых компонентов добавляются повторным кликом по
      // ней же и превращаются в отдельные фишки только в блоке "Твой рецепт".
      const q = els.search.value.trim().toLowerCase();
      items = state.pool.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        return Boolean(p.alt) && p.alt.toLowerCase().includes(q);
      });
    }

    const occurrenceIndices = slotOccurrenceIndices(items.map((it) => it.key));

    items.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = "pool-item";
      div.title = item.name;
      const count = state.selected.get(item.key) || 0;
      const filled = occurrenceIndices[idx] < count;
      if (filled) div.classList.add("selected");
      div.innerHTML = `<img src="${item.img}" alt="${item.name}" loading="lazy">`;

      // Сколько раз можно кликнуть этот предмет: в лёгком режиме — по числу
      // слотов под него в строке. В хард-режиме лимита нет вообще — иначе
      // сам факт "блокировки после N кликов" был бы подсказкой о том,
      // сколько именно единиц компонента нужно в рецепте.
      const clickLimit = isEasy
        ? state.easyOptions.filter((k) => k === item.key).length
        : Infinity;

      div.addEventListener("click", () => handlePoolItemClick(item, div, clickLimit));
      els.poolGrid.appendChild(div);
    });

    renderRecipeBtn();
  }

  function renderRecipeBtn() {
    if (state.mode !== "easy") {
      els.recipeBtn.hidden = true;
      return;
    }
    const item = poolByKey(RECIPE_KEY);
    if (!item) {
      els.recipeBtn.hidden = true;
      return;
    }
    els.recipeBtn.hidden = false;
    els.recipeBtn.title = item.name;
    const count = state.selected.get(RECIPE_KEY) || 0;
    els.recipeBtn.classList.toggle("selected", count > 0);
    els.recipeBtn.innerHTML = `<img src="${item.img}" alt="${item.name}" loading="lazy">`;
  }

  function makeTrayChip(item, key) {
    const div = document.createElement("div");
    div.className = "tray-chip";
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <span class="remove-hint">✕</span>
    `;
    div.dataset.key = key;
    div.title = item.name;
    div.addEventListener("click", () => {
      if (state.locked) return;
      const c = state.selected.get(key) || 0;
      if (c <= 1) state.selected.delete(key);
      else state.selected.set(key, c - 1);
      renderPool();
      renderTray();
      saveSession();
    });
    return div;
  }

  function requiredSlotCount(recipe) {
    const variant = answerVariants(recipe)[0];
    return variant.reduce((sum, c) => sum + c.count, 0);
  }

  function makePlaceholderSlot() {
    const div = document.createElement("div");
    div.className = "tray-chip tray-placeholder";
    div.textContent = "?";
    return div;
  }

  function renderTray() {
    els.tray.innerHTML = "";
    const isEasy = state.mode === "easy";

    if (isEasy && state.current) {
      // Как в оригинальной игре: сразу видно, сколько всего компонентов
      // нужно (пустые "?"), они заполняются по мере выбора.
      let filled = 0;
      for (const [key, count] of state.selected.entries()) {
        const item = poolByKey(key);
        if (!item) continue;
        for (let i = 0; i < count; i++) {
          els.tray.appendChild(makeTrayChip(item, key));
          filled++;
        }
      }
      const remaining = Math.max(0, requiredSlotCount(state.current) - filled);
      for (let i = 0; i < remaining; i++) {
        els.tray.appendChild(makePlaceholderSlot());
      }
      return;
    }

    if (state.selected.size === 0) {
      els.tray.appendChild(els.trayEmpty);
      return;
    }
    // Дубликат — это отдельная фишка на каждую единицу, без бейджа-счётчика.
    for (const [key, count] of state.selected.entries()) {
      const item = poolByKey(key);
      if (!item) continue;
      for (let i = 0; i < count; i++) {
        els.tray.appendChild(makeTrayChip(item, key));
      }
    }
  }

  function variantMatchesSelection(variant, selected) {
    const need = new Map(variant.map((c) => [c.key, c.count]));
    if (need.size !== selected.size) return false;
    for (const [k, n] of need.entries()) {
      if (selected.get(k) !== n) return false;
    }
    return true;
  }

  function componentName(c) {
    const it = poolByKey(c.key);
    const name = it ? it.name : c.key;
    return c.count > 1 ? `${name} x${c.count}` : name;
  }

  // Описывает все варианты рецепта одной строкой: общие для всех вариантов
  // компоненты — через запятую, а то, чем варианты отличаются друг от друга
  // (обычно один статовый компонент) — через "/". Например для Power Treads:
  // "Boots of Speed, Gloves of Haste, Belt of Strength/Band of Elvenskin/Robe of the Magi".
  function describeVariants(variants) {
    const common = variants[0].filter((c) =>
      variants.every((v) => v.some((vc) => vc.key === c.key && vc.count === c.count))
    );
    const commonKeys = new Set(common.map((c) => c.key));
    const diffTexts = Array.from(
      new Set(
        variants
          .map((v) => v.filter((c) => !commonKeys.has(c.key)).map(componentName).join(" + "))
          .filter(Boolean)
      )
    );

    const commonText = common.map(componentName).join(", ");
    if (diffTexts.length <= 1) {
      return [commonText, ...diffTexts].filter(Boolean).join(", ");
    }
    return commonText ? `${commonText}, ${diffTexts.join("/")}` : diffTexts.join("/");
  }

  // Для подсветки трея при неверном ответе — выбираем вариант рецепта,
  // с которым выбор игрока совпадает больше всего.
  function bestMatchingVariant(variants, selected) {
    let best = variants[0];
    let bestScore = -1;
    for (const variant of variants) {
      const need = new Map(variant.map((c) => [c.key, c.count]));
      let score = 0;
      for (const [k, n] of need.entries()) {
        if (selected.get(k) === n) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = variant;
      }
    }
    return best;
  }

  // Правильность ответа и очки решает сервер (POST /api/round/answer) — он
  // сверяет выбор с собственной копией рецептов и сам пишет в лидерборд.
  // Локально мы только красиво подсвечиваем трей и текст фидбека.
  async function checkAnswer() {
    if (state.locked || !state.current) return;
    state.locked = true;
    els.checkBtn.disabled = true;

    const selectedObj = {};
    for (const [key, count] of state.selected.entries()) selectedObj[key] = count;

    let result;
    try {
      result = await apiPost("/api/round/answer", { selected: selectedObj });
    } catch (err) {
      state.locked = false;
      els.checkBtn.disabled = false;
      console.error(err);
      showWarning("Не удалось отправить ответ — попробуй ещё раз");
      return;
    }

    const variants = answerVariants(state.current);
    const need = new Map(
      (result.correct
        ? variants.find((v) => variantMatchesSelection(v, state.selected))
        : bestMatchingVariant(variants, state.selected)
      ).map((c) => [c.key, c.count])
    );
    markTrayCorrectness(need);

    state.score = result.score;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem("dq_best", String(state.best));
    }

    if (result.correct) {
      els.feedback.textContent = "Верно! Точный рецепт.";
      els.feedback.className = "feedback ok";
    } else {
      const correctNames = describeVariants(variants);
      els.feedback.textContent = `Неверно. Правильный рецепт: ${correctNames}`;
      els.feedback.className = "feedback bad";
    }

    els.score.textContent = state.score;
    els.best.textContent = state.best;

    els.checkBtn.hidden = true;
    els.nextBtn.hidden = false;
    saveSession();
  }

  function markTrayCorrectness(need) {
    for (const chipEl of els.tray.children) {
      const key = chipEl.dataset.key;
      if (!key) continue;
      const needed = need.get(key) || 0;
      const got = state.selected.get(key) || 0;
      chipEl.style.borderColor = needed === got && needed > 0 ? "var(--green)" : "var(--red)";
    }
  }

  els.checkBtn.addEventListener("click", checkAnswer);
  els.nextBtn.addEventListener("click", nextQuestion);
  els.clearBtn.addEventListener("click", () => {
    if (state.locked) return;
    state.selected = new Map();
    renderPool();
    renderTray();
    saveSession();
  });
  els.search.addEventListener("input", renderPool);
  els.recipeBtn.addEventListener("click", () => {
    const recipeItem = poolByKey(RECIPE_KEY);
    if (recipeItem) handlePoolItemClick(recipeItem, els.recipeBtn, 1);
  });
  els.menuBtn.addEventListener("click", showMenu);
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => startMode(card.dataset.mode));
  });

  // Источник истины при восстановлении после перезагрузки — серверная
  // сессия (GET /api/round/state): она знает актуальный счёт и текущий
  // рецепт. localStorage используется только для косметики (что было
  // нажато, текст фидбека), и то лишь если совпадает с тем же рецептом.
  async function tryResume() {
    const screen = localStorage.getItem(SCREEN_KEY);
    if (!(isPageReload() && screen === "game")) {
      showMenu();
      return;
    }

    let roundState;
    try {
      roundState = await apiGet("/api/round/state");
    } catch {
      roundState = { active: false };
    }

    const current = roundState.active ? recipeByKey(roundState.recipe_key) : null;
    if (!current) {
      showMenu();
      return;
    }

    const local = loadSession();
    const localMatches = Boolean(local && local.currentKey === roundState.recipe_key);

    state.mode = roundState.mode === "easy" ? "easy" : "hard";
    state.current = current;
    state.score = Number(roundState.score) || 0;
    state.locked = Boolean(roundState.answered);
    state.easyOptions =
      localMatches && Array.isArray(local.easyOptions) && local.easyOptions.length
        ? local.easyOptions
        : state.mode === "easy"
        ? buildEasyOptions(current)
        : [];
    state.selected = new Map(localMatches ? local.selected || [] : []);

    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem("dq_best", String(state.best));
    }

    els.search.hidden = state.mode === "easy";

    showTarget(state.current);
    renderPool();
    renderTray();

    els.score.textContent = state.score;
    els.best.textContent = state.best;

    if (state.locked) {
      const variants = answerVariants(state.current);
      if (localMatches && local.feedbackText) {
        els.feedback.textContent = local.feedbackText;
        els.feedback.className = local.feedbackClass || "feedback";
      } else {
        els.feedback.textContent = roundState.last_correct
          ? "Верно! Точный рецепт."
          : `Неверно. Правильный рецепт: ${describeVariants(variants)}`;
        els.feedback.className = "feedback " + (roundState.last_correct ? "ok" : "bad");
      }
      els.checkBtn.hidden = true;
      els.nextBtn.hidden = false;
      const matched = variants.find((v) => variantMatchesSelection(v, state.selected));
      const need = new Map(
        (matched || bestMatchingVariant(variants, state.selected)).map((c) => [c.key, c.count])
      );
      markTrayCorrectness(need);
    } else {
      els.feedback.textContent = "";
      els.feedback.className = "feedback";
      els.checkBtn.hidden = false;
      els.nextBtn.hidden = true;
    }

    showGame();
  }

  function updateAuthUI() {
    if (state.user) {
      els.steamLoginBtn.hidden = true;
      els.userChip.hidden = false;
      els.userAvatar.hidden = !state.user.avatar_url;
      els.userAvatar.src = state.user.avatar_url || "";
      els.userName.textContent = state.user.persona_name;
    } else {
      els.steamLoginBtn.hidden = false;
      els.userChip.hidden = true;
    }
  }

  function loadMe() {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        state.user = data.user || null;
        updateAuthUI();
      })
      .catch(() => {
        state.user = null;
        updateAuthUI();
      });
  }

  function loadLeaderboard(mode) {
    els.lbList.innerHTML = '<li class="lb-empty">Загрузка...</li>';
    fetch(`/api/leaderboard?mode=${encodeURIComponent(mode)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => renderLeaderboard(data.leaderboard || []))
      .catch(() => {
        els.lbList.innerHTML = '<li class="lb-empty">Не удалось загрузить лидерборд</li>';
      });
  }

  function renderLeaderboard(rows) {
    els.lbList.innerHTML = "";
    if (rows.length === 0) {
      els.lbList.innerHTML = '<li class="lb-empty">Пока никто не попал в топ</li>';
      return;
    }
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      li.innerHTML = `
        <span class="lb-rank">${i + 1}</span>
        <img class="lb-avatar" src="${row.avatar_url || ""}" alt="">
        <span class="lb-name">${row.persona_name}</span>
        <span class="lb-score">${row.best_score}</span>
      `;
      els.lbList.appendChild(li);
    });
  }

  els.logoutBtn.addEventListener("click", () => {
    fetch("/auth/logout", { method: "POST" }).then(() => {
      state.user = null;
      updateAuthUI();
    });
  });

  els.leaderboardBtn.addEventListener("click", () => {
    const opening = els.leaderboardPanel.hidden;
    els.leaderboardPanel.hidden = !opening;
    if (opening) loadLeaderboard(state.lbMode);
  });

  els.lbTabs.querySelectorAll(".lb-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.lbMode = tab.dataset.mode;
      els.lbTabs.querySelectorAll(".lb-tab").forEach((t) => t.classList.toggle("active", t === tab));
      loadLeaderboard(state.lbMode);
    });
  });

  function isPageReload() {
    try {
      const [entry] = performance.getEntriesByType("navigation");
      if (entry) return entry.type === "reload";
    } catch {
      // ignore
    }
    return Boolean(performance.navigation && performance.navigation.type === 1);
  }

  loadMe();

  fetch("data/items.json", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      state.pool = data.pool;
      state.recipes = data.recipes;
      tryResume();
    })
    .catch((err) => {
      els.targetName.textContent = "Не удалось загрузить данные";
      els.menu.hidden = true;
      els.game.hidden = false;
      console.error(err);
    });
})();
