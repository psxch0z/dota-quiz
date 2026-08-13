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
    remaining: [],
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

  function refillRemaining() {
    state.remaining = shuffle(state.recipes);
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

  function saveSession() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        score: state.score,
        currentKey: state.current ? state.current.key : null,
        easyOptions: state.easyOptions,
        remainingKeys: state.remaining.map((r) => r.key),
        selected: Array.from(state.selected.entries()),
        locked: state.locked,
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

  function startMode(mode) {
    state.mode = mode;
    state.score = 0;
    els.search.hidden = mode === "easy";
    refillRemaining();
    nextQuestion();
    showGame();
  }

  function nextQuestion() {
    state.locked = false;
    state.selected = new Map();
    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    els.nextBtn.hidden = true;
    els.checkBtn.hidden = false;
    els.checkBtn.disabled = false;
    els.score.textContent = state.score;
    els.best.textContent = state.best;

    if (state.remaining.length === 0) refillRemaining();
    state.current = state.remaining.pop();
    state.easyOptions = state.mode === "easy" ? buildEasyOptions(state.current) : [];

    showTarget(state.current);
    renderPool();
    renderTray();
    saveSession();
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

  function checkAnswer() {
    if (state.locked || !state.current) return;
    state.locked = true;

    const variants = answerVariants(state.current);
    const correct = variants.some((v) => variantMatchesSelection(v, state.selected));

    const need = new Map(
      (correct
        ? variants.find((v) => variantMatchesSelection(v, state.selected))
        : bestMatchingVariant(variants, state.selected)
      ).map((c) => [c.key, c.count])
    );
    markTrayCorrectness(need);

    if (correct) {
      state.score += 10;
      if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem("dq_best", String(state.best));
      }
      submitScore(state.mode, state.score);
      els.feedback.textContent = "Верно! Точный рецепт.";
      els.feedback.className = "feedback ok";
    } else {
      state.score = 0;
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

  function restoreSession(session) {
    const current = recipeByKey(session.currentKey);
    if (!current) return false;

    state.mode = session.mode === "easy" ? "easy" : "hard";
    state.current = current;
    state.easyOptions = Array.isArray(session.easyOptions) ? session.easyOptions : [];
    if (state.mode === "easy" && state.easyOptions.includes(current.key)) {
      // self-heal sessions saved before decoys excluded the target itself
      state.easyOptions = buildEasyOptions(current);
    }
    state.remaining = session.remainingKeys
      .map((k) => recipeByKey(k))
      .filter(Boolean);
    state.selected = new Map(session.selected || []);
    state.score = Number(session.score) || 0;
    state.locked = Boolean(session.locked);

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
      els.feedback.textContent = session.feedbackText || "";
      els.feedback.className = session.feedbackClass || "feedback";
      els.checkBtn.hidden = true;
      els.nextBtn.hidden = false;
      const variants = answerVariants(state.current);
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
    return true;
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

  function submitScore(mode, score) {
    if (!state.user) return;
    fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, score }),
    }).catch(() => {
      // тихо игнорируем — локальный прогресс всё равно сохранён
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

      const session = loadSession();
      const screen = localStorage.getItem(SCREEN_KEY);
      const canResume = isPageReload() && screen === "game" && session;
      if (!canResume || !restoreSession(session)) {
        showMenu();
      }
    })
    .catch((err) => {
      els.targetName.textContent = "Не удалось загрузить данные";
      els.menu.hidden = true;
      els.game.hidden = false;
      console.error(err);
    });
})();
