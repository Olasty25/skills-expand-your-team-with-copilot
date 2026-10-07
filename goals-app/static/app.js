/* Cele+ — logika aplikacji: cele, XP, wykresy i asystent głosowy */
(() => {
  "use strict";

  const STORAGE_KEY = "celeplus.v1";
  const CATEGORIES = ["Zdrowie", "Nauka", "Projekty", "Sport", "Praca", "Rozwój", "Inne"];
  const PERIOD_LABEL = { day: "Dzień", week: "Tydzień", month: "Miesiąc", year: "Rok" };
  const PERIOD_TITLE = { day: "Dzisiaj", week: "Ten tydzień", month: "Ten miesiąc", year: "Ten rok" };
  const XP_FOR = { day: 10, week: 30, month: 80, year: 200 };
  const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

  // ---------- Daty i klucze okresów ----------
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7) };
  }

  function periodKey(period, d = new Date()) {
    switch (period) {
      case "day": return dayKey(d);
      case "week": { const w = isoWeek(d); return `${w.year}-W${pad(w.week)}`; }
      case "month": return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      default: return String(d.getFullYear());
    }
  }

  function periodSubtitle(period) {
    const d = new Date();
    if (period === "day") return d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
    if (period === "week") {
      const monday = addDays(d, -((d.getDay() + 6) % 7));
      const sunday = addDays(monday, 6);
      const f = (x) => x.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
      return `${f(monday)} – ${f(sunday)}`;
    }
    if (period === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return String(d.getFullYear());
  }

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // ---------- Stan ----------
  let state = load();
  let activePeriod = "day";
  const charts = {};

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.goals)) return s;
      }
    } catch (_) { /* brak dostępu do localStorage */ }
    return { goals: [] };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ignoruj */ }
  }

  function currentGoals(period) {
    return state.goals.filter((g) => (!period || g.period === period) && g.periodKey === periodKey(g.period));
  }

  // Cele cykliczne: jeśli seria nie ma instancji w bieżącym okresie, tworzymy nową.
  function rollRecurring() {
    const series = new Map();
    for (const g of state.goals) {
      if (!g.recurring) continue;
      const prev = series.get(g.seriesId);
      if (!prev || g.createdAt > prev.createdAt) series.set(g.seriesId, g);
    }
    let added = false;
    for (const g of series.values()) {
      const key = periodKey(g.period);
      if (g.periodKey !== key) {
        state.goals.push({ ...g, id: uid(), periodKey: key, current: 0, done: false, doneAt: null, log: [], createdAt: Date.now() });
        added = true;
      }
    }
    if (added) save();
  }

  // ---------- Operacje na celach ----------
  function addGoal({ title, period = "day", category = "Rozwój", target = null, unit = null, recurring = false }) {
    title = String(title || "").trim();
    if (!title) return null;
    if (!PERIOD_LABEL[period]) period = "day";
    if (!CATEGORIES.includes(category)) category = "Inne";
    const t = Number(target);
    const goal = {
      id: uid(), seriesId: uid(), title, period, category,
      target: t > 0 ? t : null, unit: t > 0 ? (unit || "").trim() || null : null,
      current: 0, done: false, doneAt: null, recurring: !!recurring,
      periodKey: periodKey(period), createdAt: Date.now(), log: [],
    };
    state.goals.push(goal);
    save();
    return goal;
  }

  const findGoal = (id) => state.goals.find((g) => g.id === id);

  function setDone(goal, done) {
    goal.done = done;
    goal.doneAt = done ? Date.now() : null;
    if (done && goal.target && goal.current < goal.target) goal.current = goal.target;
    save();
    if (done) toast(`+${XP_FOR[goal.period]} XP · ${goal.title} ✔`);
  }

  function addProgress(goal, amount) {
    amount = Number(amount);
    if (!goal || !isFinite(amount) || amount === 0) return;
    goal.current = Math.max(0, +(goal.current + amount).toFixed(2));
    goal.log.push({ t: Date.now(), amount });
    if (goal.target && goal.current >= goal.target && !goal.done) setDone(goal, true);
    else save();
  }

  function deleteGoal(goal) {
    state.goals = state.goals.filter((g) => g !== goal);
    if (goal.recurring) {
      // usunięcie bieżącej instancji kończy serię, żeby nie wróciła w następnym okresie
      state.goals.forEach((g) => { if (g.seriesId === goal.seriesId) g.recurring = false; });
    }
    save();
  }

  // ---------- XP i statystyki ----------
  function xpOf(goal) {
    let xp = goal.done ? XP_FOR[goal.period] : 0;
    xp += Math.min(goal.log.length, 5) * 2; // drobne punkty za raportowanie postępu
    return xp;
  }
  const totalXp = () => state.goals.reduce((s, g) => s + xpOf(g), 0);

  function levelInfo(xp) {
    // każdy kolejny poziom wymaga o 50 XP więcej niż poprzedni
    let level = 1, need = 100, rest = xp;
    while (rest >= need) { rest -= need; level++; need += 50; }
    return { level, rest, need };
  }

  function doneCountByDay() {
    const map = {};
    for (const g of state.goals) {
      if (g.done && g.doneAt) {
        const k = dayKey(new Date(g.doneAt));
        map[k] = (map[k] || 0) + 1;
      }
    }
    return map;
  }

  function streak() {
    const map = doneCountByDay();
    let d = new Date(), n = 0;
    if (!map[dayKey(d)]) d = addDays(d, -1); // dzisiejszy dzień jeszcze trwa
    while (map[dayKey(d)]) { n++; d = addDays(d, -1); }
    return n;
  }

  function lastDays(n) {
    const out = [], today = new Date();
    for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
    return out;
  }

  function progressOf(goal) {
    if (goal.done) return 1;
    if (goal.target) return Math.min(1, goal.current / goal.target);
    return 0;
  }

  // ---------- Renderowanie ----------
  const $ = (sel) => document.querySelector(sel);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("pl-PL");

  function render() {
    renderStats();
    renderGoals();
    if ($("#view-stats").classList.contains("active")) renderCharts();
  }

  function renderStats() {
    const xp = totalXp();
    const { level, rest, need } = levelInfo(xp);
    $("#stat-level").textContent = level;
    $("#stat-xp").textContent = `${xp} XP · ${need - rest} XP do poziomu ${level + 1}`;
    $("#xp-fill").style.width = `${(rest / need) * 100}%`;
    $("#stat-streak").textContent = streak();
    const today = currentGoals("day");
    $("#stat-today").textContent = `${today.filter((g) => g.done).length}/${today.length}`;

    const since = dayKey(addDays(new Date(), -29));
    const recent = state.goals.filter((g) => dayKey(new Date(g.createdAt)) >= since);
    const closed = recent.filter((g) => g.done || g.periodKey !== periodKey(g.period));
    const rate = closed.length ? Math.round((closed.filter((g) => g.done).length / closed.length) * 100) : 0;
    $("#stat-rate").textContent = `${rate}%`;

    document.querySelectorAll("#period-tabs .chip").forEach((chip) => {
      const p = chip.dataset.period;
      const open = currentGoals(p).filter((g) => !g.done).length;
      chip.innerHTML = "";
      chip.append(PERIOD_LABEL[p]);
      if (open) {
        const c = document.createElement("span");
        c.className = "count";
        c.textContent = open;
        chip.append(c);
      }
    });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderGoals() {
    const title = $("#period-title");
    title.textContent = PERIOD_TITLE[activePeriod];
    title.append(el("small", null, periodSubtitle(activePeriod)));

    const list = $("#goal-list");
    list.innerHTML = "";
    const goals = currentGoals(activePeriod).sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);

    if (!goals.length) {
      const empty = el("div", "empty");
      empty.innerHTML = "Brak celów na ten okres.<br>Naciśnij <b>mikrofon</b> i powiedz, co chcesz osiągnąć — albo dodaj cel ręcznie.";
      list.append(empty);
      return;
    }

    for (const g of goals) {
      const row = el("div", "goal" + (g.done ? " done" : ""));
      row.dataset.id = g.id;

      const check = el("button", "check-btn", g.done ? "✓" : "");
      check.title = g.done ? "Cofnij" : "Oznacz jako wykonany";
      check.onclick = () => { setDone(g, !g.done); render(); };

      const body = el("div");
      body.append(el("div", "goal-title", g.title));
      const meta = el("div", "goal-meta");
      meta.append(el("span", "tag", g.category));
      if (g.recurring) meta.append(el("span", null, "🔁 cykliczny"));
      meta.append(el("span", null, `+${XP_FOR[g.period]} XP`));
      body.append(meta);

      if (g.target) {
        const p = el("div", "progress");
        const track = el("div", "progress-track");
        const fill = el("div", "progress-fill");
        fill.style.width = `${progressOf(g) * 100}%`;
        track.append(fill);
        p.append(track, el("span", "progress-label", `${fmt(g.current)} / ${fmt(g.target)} ${g.unit || ""}`.trim()));
        body.append(p);
      }

      const actions = el("div", "goal-actions");
      if (g.target && !g.done) {
        const form = el("form", "add-progress");
        const input = el("input");
        input.type = "number"; input.step = "any"; input.placeholder = `+${g.unit || ""}`;
        input.setAttribute("aria-label", "Dodaj postęp");
        const btn = el("button", "icon-btn", "+");
        btn.type = "submit";
        form.append(input, btn);
        form.onsubmit = (e) => { e.preventDefault(); addProgress(g, input.value); render(); };
        actions.append(form);
      }
      const del = el("button", "icon-btn", "✕");
      del.title = "Usuń cel";
      del.onclick = () => { if (confirm(`Usunąć cel „${g.title}”?`)) { deleteGoal(g); render(); } };
      actions.append(del);

      row.append(check, body, actions);
      list.append(row);
    }
  }

  function flash(id) {
    requestAnimationFrame(() => {
      const row = document.querySelector(`.goal[data-id="${id}"]`);
      if (row) { row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1300); }
    });
  }

  // ---------- Wykresy ----------
  const ORANGE = "#f97316", ORANGE_DARK = "#c2410c";
  const GRID = "#f3ebe3", TICK = "#8a827c";

  function baseOptions(extra = {}) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1f1a17", padding: 10, cornerRadius: 10, displayColors: false,
          titleFont: { family: "Plus Jakarta Sans", weight: "700" }, bodyFont: { family: "Plus Jakarta Sans" },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: TICK, maxRotation: 0, autoSkipPadding: 12, font: { family: "Plus Jakarta Sans" } }, border: { color: GRID } },
        y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { color: TICK, precision: 0, font: { family: "Plus Jakarta Sans" } } },
      },
      ...extra,
    };
  }

  function upsertChart(id, config) {
    if (typeof Chart === "undefined") return;
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart(document.getElementById(id), config);
  }

  const shortDay = (d) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });

  function renderCharts() {
    const days = lastDays(30);
    const labels = days.map(shortDay);

    // 1. Skumulowane XP
    const xpByDay = {};
    let xpBefore = 0;
    const firstKey = dayKey(days[0]);
    for (const g of state.goals) {
      if (!g.done || !g.doneAt) continue;
      const k = dayKey(new Date(g.doneAt));
      if (k < firstKey) xpBefore += xpOf(g);
      else xpByDay[k] = (xpByDay[k] || 0) + xpOf(g);
    }
    let acc = xpBefore;
    const xpSeries = days.map((d) => (acc += xpByDay[dayKey(d)] || 0));
    upsertChart("chart-xp", {
      type: "line",
      data: { labels, datasets: [{ label: "XP", data: xpSeries, borderColor: ORANGE, backgroundColor: makeGradient("chart-xp"), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: ORANGE }] },
      options: baseOptions({ plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} XP łącznie` } } } }),
    });

    // 2. Skuteczność celów dziennych
    const rate = days.map((d) => {
      const goals = state.goals.filter((g) => g.period === "day" && g.periodKey === dayKey(d));
      return goals.length ? Math.round((goals.filter((g) => g.done).length / goals.length) * 100) : null;
    });
    upsertChart("chart-rate", {
      type: "line",
      data: { labels, datasets: [{ label: "Skuteczność", data: rate, borderColor: ORANGE, backgroundColor: ORANGE, borderWidth: 2, tension: 0.3, spanGaps: true, pointRadius: 3, pointHoverRadius: 6 }] },
      options: baseOptions({
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => v + "%" } } },
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y}% celów wykonanych` } } },
      }),
    });

    // 3. Bieżące okresy — średni postęp
    const periods = ["day", "week", "month", "year"];
    const avg = periods.map((p) => {
      const goals = currentGoals(p);
      return goals.length ? Math.round((goals.reduce((s, g) => s + progressOf(g), 0) / goals.length) * 100) : 0;
    });
    const counts = periods.map((p) => currentGoals(p));
    upsertChart("chart-periods", {
      type: "bar",
      data: { labels: periods.map((p) => PERIOD_LABEL[p]), datasets: [{ label: "Postęp", data: avg, backgroundColor: ORANGE, hoverBackgroundColor: ORANGE_DARK, borderRadius: 4, maxBarThickness: 56 }] },
      options: baseOptions({
        scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: (v) => v + "%" } } },
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: {
          label: (c) => `${c.parsed.y}% średniego postępu`,
          afterLabel: (c) => { const g = counts[c.dataIndex]; return `${g.filter((x) => x.done).length} z ${g.length} celów wykonanych`; },
        } } },
      }),
    });

    // 4. Kategorie
    const catCounts = CATEGORIES.map((c) => state.goals.filter((g) => g.done && g.category === c).length);
    upsertChart("chart-categories", {
      type: "bar",
      data: { labels: CATEGORIES, datasets: [{ label: "Wykonane", data: catCounts, backgroundColor: ORANGE, hoverBackgroundColor: ORANGE_DARK, borderRadius: 4, maxBarThickness: 22 }] },
      options: baseOptions({
        indexAxis: "y",
        interaction: { mode: "nearest", axis: "y", intersect: false },
        scales: {
          x: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { color: TICK, precision: 0 } },
          y: { grid: { display: false }, border: { color: GRID }, ticks: { color: "#57514c", font: { family: "Plus Jakarta Sans", weight: "600" } } },
        },
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${c.parsed.x} wykonanych celów` } } },
      }),
    });

    renderMetricChart();
    renderHeatmap();
  }

  function makeGradient(canvasId) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    g.addColorStop(0, "rgba(249,115,22,0.30)");
    g.addColorStop(1, "rgba(249,115,22,0.02)");
    return g;
  }

  function metricSeries() {
    // grupujemy cele mierzalne po tytule i jednostce (ignorując spacje, np. „120g” = „120 g”)
    const groups = new Map();
    for (const g of state.goals) {
      if (!g.target) continue;
      const key = `${g.title.toLowerCase().replace(/\s+/g, "")}|${g.unit}`;
      if (!groups.has(key)) groups.set(key, { key, title: g.title, unit: g.unit, period: g.period, items: [] });
      groups.get(key).items.push(g);
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  }

  function renderMetricChart() {
    const select = $("#metric-select");
    const series = metricSeries();
    const prev = select.value;
    select.innerHTML = "";
    if (!series.length) {
      select.append(new Option("Brak celów mierzalnych — dodaj cel z wartością, np. 120 g białka", ""));
      select.disabled = true;
      upsertChart("chart-metric", { type: "bar", data: { labels: [], datasets: [] }, options: baseOptions() });
      return;
    }
    select.disabled = false;
    for (const s of series) select.append(new Option(`${s.title} (${PERIOD_LABEL[s.period].toLowerCase()})`, s.key));
    if (series.some((s) => s.key === prev)) select.value = prev;
    const s = series.find((x) => x.key === select.value);
    const items = s.items.sort((a, b) => a.periodKey.localeCompare(b.periodKey)).slice(-14);
    const labels = items.map((g) => (g.period === "day" ? shortDay(parseDay(g.periodKey)) : g.periodKey));
    upsertChart("chart-metric", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { type: "line", label: "Cel", data: items.map((g) => g.target), borderColor: "#57514c", borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
          { type: "bar", label: "Wynik", data: items.map((g) => g.current), backgroundColor: items.map((g) => (g.current >= g.target ? ORANGE : "#fdba74")), borderRadius: 4, maxBarThickness: 28 },
        ],
      },
      options: baseOptions({
        plugins: {
          ...baseOptions().plugins,
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 12, boxHeight: 12, color: "#57514c", font: { family: "Plus Jakarta Sans" } } },
          tooltip: { ...baseOptions().plugins.tooltip, displayColors: true, callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} ${s.unit || ""}` } },
        },
      }),
    });
  }

  function renderHeatmap() {
    const box = $("#heatmap");
    box.innerHTML = "";
    const map = doneCountByDay();
    const today = new Date();
    const start = addDays(today, -(7 * 25) - ((today.getDay() + 6) % 7)); // poniedziałek 26 tygodni temu
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const n = map[dayKey(d)] || 0;
      const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
      const cell = el("i", `h${level}`);
      cell.title = `${d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}: ${n} wykonanych celów`;
      box.append(cell);
    }
  }

  // ---------- Asystent AI ----------
  const chat = $("#chat");
  const speakToggle = $("#speak-toggle");

  function addMsg(text, who, extra) {
    const m = el("div", `msg ${who}`, text);
    if (extra) m.append(extra);
    chat.append(m);
    chat.scrollTop = chat.scrollHeight;
    return m;
  }

  function speak(text) {
    if (!speakToggle.checked || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pl-PL";
    const pl = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith("pl"));
    if (pl) u.voice = pl;
    speechSynthesis.speak(u);
  }

  async function askAssistant(text) {
    text = text.trim();
    if (!text) return;
    addMsg(text, "user");
    const thinking = addMsg("Myślę…", "bot interim");
    try {
      const goals = state.goals
        .filter((g) => g.periodKey === periodKey(g.period))
        .map((g) => ({ id: g.id, title: g.title, period: g.period, target: g.target, unit: g.unit, current: g.current, done: g.done }));
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, today: dayKey(new Date()), goals }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      thinking.remove();
      const summary = applyActions(data.actions || []);
      addMsg(data.reply, "bot", summary);
      speak(data.reply);
    } catch (err) {
      thinking.remove();
      addMsg("Nie mogę połączyć się z serwerem asystenta. Uruchom aplikację poleceniem „uvicorn app:app” i spróbuj ponownie.", "bot");
      console.error(err);
    }
  }

  function applyActions(actions) {
    const lines = [];
    let switchTo = null, flashId = null;
    for (const a of actions) {
      if (a.type === "add_goal") {
        const g = addGoal(a);
        if (g) { lines.push(`➕ ${g.title} · ${PERIOD_LABEL[g.period].toLowerCase()}`); switchTo = switchTo || g.period; flashId = g.id; }
      } else {
        const g = findGoal(a.goal_id);
        if (!g) continue;
        if (a.type === "update_progress") { addProgress(g, a.amount); lines.push(`📊 ${g.title}: ${fmt(g.current)}/${fmt(g.target || 0)} ${g.unit || ""}`); switchTo = switchTo || g.period; flashId = g.id; }
        if (a.type === "complete_goal") { if (!g.done) setDone(g, true); lines.push(`✅ ${g.title}`); switchTo = switchTo || g.period; flashId = g.id; }
        if (a.type === "delete_goal") { lines.push(`🗑️ ${g.title}`); deleteGoal(g); }
      }
    }
    if (switchTo) setPeriod(switchTo);
    render();
    if (flashId) flash(flashId);
    if (!lines.length) return null;
    const ul = el("ul", "actions-list");
    lines.forEach((l) => ul.append(el("li", null, l)));
    return ul;
  }

  // Rozpoznawanie mowy (Web Speech API)
  const micBtn = $("#mic-btn");
  const micHint = $("#mic-hint");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, listening = false, interimMsg = null, finalText = "";

  if (SR) {
    recognition = new SR();
    recognition.lang = "pl-PL";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { listening = true; finalText = ""; micBtn.classList.add("listening"); micHint.textContent = "Słucham… (kliknij, aby zakończyć)"; };
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      const shown = (finalText + " " + interim).trim();
      if (!interimMsg) interimMsg = addMsg(shown, "user interim");
      else interimMsg.textContent = shown;
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Brak dostępu do mikrofonu — zezwól w przeglądarce.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast(`Błąd rozpoznawania mowy: ${e.error}`);
    };
    recognition.onend = () => {
      listening = false;
      micBtn.classList.remove("listening");
      micHint.textContent = "Naciśnij i mów";
      if (interimMsg) { interimMsg.remove(); interimMsg = null; }
      if (finalText.trim()) askAssistant(finalText);
    };
    micBtn.onclick = () => {
      if (listening) { recognition.stop(); return; }
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      try { recognition.start(); } catch (_) { /* już działa */ }
    };
  } else {
    micBtn.disabled = true;
    micHint.textContent = "Twoja przeglądarka nie obsługuje mowy — użyj Chrome/Edge lub wpisz polecenie";
  }

  $("#chat-form").onsubmit = (e) => {
    e.preventDefault();
    const input = $("#chat-text");
    askAssistant(input.value);
    input.value = "";
  };

  fetch("/api/status").then((r) => r.json()).then((s) => {
    const claude = s.ai === "claude";
    $("#ai-badge").textContent = claude ? "Claude AI" : "tryb lokalny";
    $("#ai-mode").textContent = claude ? "Rozumie naturalną mowę po polsku" : "Ustaw ANTHROPIC_API_KEY, by włączyć Claude";
  }).catch(() => { $("#ai-badge").textContent = "offline"; });

  // ---------- Nawigacja i formularze ----------
  function setPeriod(p) {
    activePeriod = p;
    document.querySelectorAll("#period-tabs .chip").forEach((c) => c.classList.toggle("active", c.dataset.period === p));
    renderGoals();
  }

  document.querySelectorAll("#period-tabs .chip").forEach((chip) => (chip.onclick = () => setPeriod(chip.dataset.period)));

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab.dataset.view}`));
      if (tab.dataset.view === "stats") renderCharts();
    };
  });

  const catSelect = document.querySelector("#add-form select[name=category]");
  CATEGORIES.forEach((c) => catSelect.append(new Option(c, c)));
  catSelect.value = "Rozwój";

  $("#add-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const g = addGoal({
      title: f.get("title"), period: f.get("period"), category: f.get("category"),
      target: f.get("target"), unit: f.get("unit"), recurring: f.get("recurring") === "on",
    });
    if (g) {
      e.target.reset();
      catSelect.value = "Rozwój";
      setPeriod(g.period);
      render();
      flash(g.id);
      toast("Dodano cel 🎯");
    }
  };

  $("#metric-select").onchange = renderMetricChart;

  $("#export-btn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cele-${dayKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("#reset-btn").onclick = () => {
    if (!confirm("Na pewno usunąć wszystkie cele i historię?")) return;
    state = { goals: [] };
    save();
    render();
  };

  $("#demo-btn").onclick = () => {
    if (state.goals.length && !confirm("Dodać przykładowe dane do istniejących celów?")) return;
    seedDemo();
    render();
    toast("Wczytano przykładowe dane z 60 dni");
  };

  function seedDemo() {
    const today = new Date();
    const protein = uid(), study = uid(), steps = uid();
    for (let i = 60; i >= 1; i--) {
      const d = addDays(today, -i);
      const at = (h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.getTime(); };
      const trend = (60 - i) / 60; // z czasem coraz lepiej
      const p = Math.round(70 + Math.random() * 40 + trend * 30);
      state.goals.push({ id: uid(), seriesId: protein, title: "Zjem 120 g białka", period: "day", category: "Zdrowie", target: 120, unit: "g", current: Math.min(p, 150), done: p >= 120, doneAt: p >= 120 ? at(20) : null, recurring: false, periodKey: dayKey(d), createdAt: at(7), log: [{ t: at(13), amount: p }] });
      const studied = Math.random() < 0.45 + trend * 0.4;
      state.goals.push({ id: uid(), seriesId: study, title: "Godzina nauki do olimpiady AI", period: "day", category: "Nauka", target: null, unit: null, current: 0, done: studied, doneAt: studied ? at(18) : null, recurring: false, periodKey: dayKey(d), createdAt: at(7), log: [] });
      const s = Math.round(5000 + Math.random() * 6000 + trend * 2000);
      state.goals.push({ id: uid(), seriesId: steps, title: "Zrobię 10000 kroków", period: "day", category: "Sport", target: 10000, unit: "kroków", current: s, done: s >= 10000, doneAt: s >= 10000 ? at(21) : null, recurring: false, periodKey: dayKey(d), createdAt: at(7), log: [{ t: at(21), amount: s }] });
    }
    for (let w = 8; w >= 1; w--) {
      const d = addDays(today, -7 * w);
      const ok = Math.random() < 0.7;
      state.goals.push({ id: uid(), seriesId: uid(), title: "Rozwiążę 3 zadania olimpijskie", period: "week", category: "Nauka", target: 3, unit: "zadań", current: ok ? 3 : 2, done: ok, doneAt: ok ? addDays(d, 5).getTime() : null, recurring: false, periodKey: periodKey("week", d), createdAt: d.getTime(), log: [] });
    }
    const m1 = new Date(today.getFullYear(), today.getMonth() - 1, 3);
    state.goals.push({ id: uid(), seriesId: uid(), title: "Zbuduję zasilacz do projektu", period: "month", category: "Projekty", target: null, unit: null, current: 0, done: true, doneAt: addDays(m1, 20).getTime(), recurring: false, periodKey: periodKey("month", m1), createdAt: m1.getTime(), log: [] });

    addGoal({ title: "Zjem 120 g białka", period: "day", category: "Zdrowie", target: 120, unit: "g" }).current = 45;
    addGoal({ title: "Godzina nauki do olimpiady AI", period: "day", category: "Nauka" });
    addGoal({ title: "Nauczę się sieci neuronowych do olimpiady AI", period: "week", category: "Nauka" });
    addGoal({ title: "Zbuduję część elektroniczną robota", period: "month", category: "Projekty", target: 5, unit: "modułów" }).current = 2;
    addGoal({ title: "Przeczytam 20 książek", period: "year", category: "Rozwój", target: 20, unit: "książek" }).current = 13;
    save();
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Start ----------
  rollRecurring();
  render();
  let lastDay = dayKey(new Date());
  setInterval(() => { // nowy dzień = nowe cele cykliczne
    if (dayKey(new Date()) === lastDay) return;
    lastDay = dayKey(new Date());
    rollRecurring();
    render();
  }, 60 * 1000);
})();
