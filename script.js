const ORIGIN_POINT = 30000;
const TOTAL_POINT = 100000;

let games = JSON.parse(localStorage.getItem("mahjongGames")) || [];
let dateRates = JSON.parse(localStorage.getItem("mahjongDateRates")) || {};
let dateNotes = JSON.parse(localStorage.getItem("mahjongDateNotes")) || {};
let selectedDate = localStorage.getItem("mahjongSelectedDate") || "";
let remoteDocRef = null;
let isApplyingRemote = false;
let isFirebaseReady = false;
let remoteSaveTimer = null;
let activeTab = "input";
let localEditUntil = 0;
let lastPointerDownAt = 0;
let pendingScoreNext = null;

window.addEventListener("pointerdown", () => { lastPointerDownAt = Date.now(); }, { passive: true });
function wasRecentPointerAction() { return Date.now() - lastPointerDownAt < 500; }
function markLocalEditing() { localEditUntil = Date.now() + 3000; }
function isLocalEditWindow() { return Date.now() < localEditUntil; }
function isUserEditing() {
  if (isLocalEditWindow()) return true;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  return ["input", "textarea", "select"].includes(tag);
}
function resetIOSZoomAfterInput() {
  if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
  setTimeout(() => window.scrollTo(window.scrollX, window.scrollY), 60);
}

function isFirebaseConfigFilled(config) { return !!(config && config.apiKey && config.projectId && config.appId); }
function initFirebaseSync() {
  const config = window.MAHJONG_FIREBASE_CONFIG;
  if (!isFirebaseConfigFilled(config) || !window.firebase) return;
  try {
    firebase.initializeApp(config);
    const db = firebase.firestore();
    const docId = window.MAHJONG_FIREBASE_DOC_ID || "default";
    remoteDocRef = db.collection("mahjongScoreApps").doc(docId);
    isFirebaseReady = true;
    remoteDocRef.onSnapshot(snapshot => {
      if (!snapshot.exists) { persistRemoteData(); return; }
      if (isUserEditing()) return;
      const data = snapshot.data() || {};
      isApplyingRemote = true;
      games = Array.isArray(data.games) ? normalizeGames(data.games) : [];
      dateRates = data.dateRates && typeof data.dateRates === "object" ? data.dateRates : {};
      dateNotes = data.dateNotes && typeof data.dateNotes === "object" ? data.dateNotes : {};
      localStorage.setItem("mahjongGames", JSON.stringify(games));
      localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
      localStorage.setItem("mahjongDateNotes", JSON.stringify(dateNotes));
      ensureSelectedDate();
      renderAll();
      isApplyingRemote = false;
    }, error => {
      console.error("Firebase sync error:", error);
      alert("共有データの読み込みに失敗しました。Firebase設定またはFirestoreルールを確認してください。");
    });
  } catch (error) {
    console.error("Firebase initialization error:", error);
    alert("Firebaseの初期化に失敗しました。firebase-config.jsの設定を確認してください。");
  }
}
function persistRemoteData() {
  if (remoteSaveTimer) { clearTimeout(remoteSaveTimer); remoteSaveTimer = null; }
  if (!isFirebaseReady || !remoteDocRef || isApplyingRemote) return;
  return remoteDocRef.set({ games, dateRates, dateNotes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
    .catch(error => {
      console.error("Firebase save error:", error);
      alert("共有データの保存に失敗しました。ネットワークまたはFirestoreルールを確認してください。");
    });
}
function scheduleRemoteSave() {
  if (!isFirebaseReady || !remoteDocRef || isApplyingRemote) return;
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => persistRemoteData(), 800);
}
function saveGames(options = {}) {
  localStorage.setItem("mahjongGames", JSON.stringify(games));
  if (options.immediate) persistRemoteData(); else scheduleRemoteSave();
}
function saveRates(options = {}) {
  localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
  if (options.immediate) persistRemoteData(); else scheduleRemoteSave();
}
function saveNotes(options = {}) {
  localStorage.setItem("mahjongDateNotes", JSON.stringify(dateNotes));
  if (options.immediate) persistRemoteData(); else scheduleRemoteSave();
}

function normalizeGames(list) {
  return list.map((game, index) => ({
    id: game.id || Date.now() + index,
    createdAt: game.createdAt || game.id || Date.now() + index,
    date: game.date || todayString(),
    players: Array.isArray(game.players) ? game.players.slice(0, 4).map(p => ({ name: p.name || "", score: p.score ?? "" })) : ["","","" ,""].map(() => ({ name:"", score:"" }))
  }));
}
function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return NaN;
  return Number(cleaned);
}
function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signedClass(value) { return Number(value) < 0 ? "negative" : ""; }
function signedText(value, digits = 0) { return Number.isFinite(Number(value)) ? formatNumber(value, digits) : ""; }
function goshaRokunyu(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 0) return Math.floor(value + 0.4);
  return -Math.floor(Math.abs(value) + 0.4);
}
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function sortDatesDesc(dates) {
  return [...dates].filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)));
}
function sortDatesAsc(dates) {
  return [...dates].sort((a, b) => String(a).localeCompare(String(b)));
}
function formatDateJapanese(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(date || "");
  return `${match[1]}年${match[2]}月${match[3]}日`;
}
function uniqueDates() {
  return sortDatesDesc([...new Set(games.map(g => g.date || todayString()))]);
}
function ensureSelectedDate() {
  games = normalizeGames(games);
  const dates = uniqueDates();
  if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates[0] || todayString();
  localStorage.setItem("mahjongSelectedDate", selectedDate);
}
function selectedDateGames() {
  return games
    .map((game, index) => ({ game, index }))
    .filter(item => (item.game.date || todayString()) === selectedDate)
    .sort((a, b) => (b.game.createdAt || b.game.id || 0) - (a.game.createdAt || a.game.id || 0));
}
function getLastPlayersForDate(date) {
  const list = games.filter(g => (g.date || todayString()) === date)
    .sort((a, b) => (b.createdAt || b.id || 0) - (a.createdAt || a.id || 0));
  if (list.length > 0) return list[0].players.map(p => p.name || "");
  if (games.length > 0) return games[games.length - 1].players.map(p => p.name || "");
  return ["", "", "", ""];
}
function hasAnyScoreInput(game) {
  if (!game || !Array.isArray(game.players)) return false;
  return game.players.some(player => String(player.score ?? "").replace(/,/g, "").trim() !== "");
}
function ensureCalculatedGame(game) {
  const players = game.players.map((player, index) => {
    const score = parseNumber(player.score);
    const diff1000 = Number.isFinite(score) ? goshaRokunyu((score - ORIGIN_POINT) / 1000) : 0;
    return { ...player, score, originalIndex: index, diff1000, rank: "", result: 0 };
  });
  const entered = players.filter(p => Number.isFinite(p.score));
  const sorted = [...entered].sort((a, b) => b.score !== a.score ? b.score - a.score : a.originalIndex - b.originalIndex);
  sorted.forEach((p, i) => { players[p.originalIndex].rank = i + 1; });
  let lowerTotal = 0;
  players.forEach(p => {
    if (p.rank === 2) p.result = p.diff1000 + 5;
    if (p.rank === 3) p.result = p.diff1000 - 5;
    if (p.rank === 4) p.result = p.diff1000 - 10;
    if ([2,3,4].includes(p.rank)) lowerTotal += p.result;
  });
  players.forEach(p => { if (p.rank === 1) p.result = -lowerTotal; });
  const total = entered.reduce((sum, p) => sum + p.score, 0);
  const hasAnyScore = entered.length > 0;
  const isComplete = entered.length === 4;
  const isValidTotal = isComplete && total === TOTAL_POINT;
  return { players, total, hasAnyScore, isComplete, isValidTotal };
}

function switchTab(tab, options = {}) {
  activeTab = tab;
  document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
  document.getElementById(`tab${tab === "input" ? "Input" : tab === "personal" ? "Personal" : "Date"}`).classList.add("active");
  document.getElementById(`${tab}Panel`).classList.add("active");
  updatePanelPosition(options.animate !== false);
  renderAll();
  if (options.scrollTop !== false) scrollToTopSoon();
}
function scrollToTopSoon() {
  setTimeout(() => {
    const panel = document.getElementById(`${activeTab}Panel`);
    if (panel) panel.scrollTop = 0;
  }, 0);
}
function getActiveTabIndex() {
  return TAB_ORDER.indexOf(activeTab);
}
function setTrackTranslate(px, animate = false) {
  const track = document.getElementById("panelTrack");
  if (!track) return;
  track.classList.toggle("is-animating", !!animate);
  track.style.transform = `translate3d(${px}px, 0, 0)`;
}
function updatePanelPosition(animate = false) {
  const area = document.getElementById("scrollArea");
  const index = getActiveTabIndex();
  if (!area || index < 0) return;
  setTrackTranslate(-index * area.clientWidth, animate);
}
function openNewDatePicker() {
  const row = document.getElementById("newDateRow");
  const picker = document.getElementById("newDatePicker");
  if (!row || !picker) return;
  row.hidden = false;
  picker.value = selectedDate || todayString();

  // iPhone Safariでは非表示inputのshowPickerが反応しないことがあるため、
  // 日付入力欄を画面内に表示してからフォーカスする。
  setTimeout(() => {
    try {
      picker.focus({ preventScroll: true });
      if (picker.showPicker) picker.showPicker();
    } catch (e) {
      picker.focus();
    }
  }, 0);
}
function closeNewDatePicker() {
  const row = document.getElementById("newDateRow");
  const picker = document.getElementById("newDatePicker");
  if (picker) {
    picker.blur();
    picker.value = "";
  }
  if (row) row.hidden = true;
}
function createDateSheet(date) {
  const picker = document.getElementById("newDatePicker");
  if (picker) picker.blur();
  if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
  if (!date) return;
  selectedDate = date;
  localStorage.setItem("mahjongSelectedDate", selectedDate);
  if (!uniqueDates().includes(date)) {
    const names = getLastPlayersForDate(date);
    games.push({ id: Date.now(), createdAt: Date.now(), date, players: names.map(name => ({ name, score: "" })) });
    saveGames({ immediate: true });
  }
  closeNewDatePicker();
  switchTab("input");
  renderAll();
  scrollToTopSoon();
}
function selectDateSheet(date) {
  if (!date) return;
  selectedDate = date;
  localStorage.setItem("mahjongSelectedDate", selectedDate);
  renderGames();
  scrollToTopSoon();
}
function addGameToSelectedDate() {
  ensureSelectedDate();
  const newest = selectedDateGames()[0];
  if (newest && !hasAnyScoreInput(newest.game)) {
    alert("未入力の対局があります。点数を入力してから、次の対局を追加してください。");
    scrollToTopSoon();
    return;
  }
  const names = getLastPlayersForDate(selectedDate);
  games.push({ id: Date.now(), createdAt: Date.now(), date: selectedDate, players: names.map(name => ({ name, score: "" })) });
  saveGames({ immediate: true });
  renderAll();
  scrollToTopSoon();
}
function deleteGame(gameIndex) {
  if (!confirm("この対局を削除しますか？")) return;
  games.splice(gameIndex, 1);
  saveGames({ immediate: true });
  ensureSelectedDate();
  renderAll();
}

function updateName(gameIndex, playerIndex, value) {
  markLocalEditing();
  games[gameIndex].players[playerIndex].name = value;
  localStorage.setItem("mahjongGames", JSON.stringify(games));
}
function commitName(gameIndex, playerIndex, value) {
  resetIOSZoomAfterInput();
  markLocalEditing();
  games[gameIndex].players[playerIndex].name = value;
  saveGames({ immediate: true });
  renderSummary();
  renderDateSummary();
}
function updateScoreValue(gameIndex, playerIndex, input, shouldFormat = false) {
  markLocalEditing();
  const raw = input.value.replace(/,/g, "");
  games[gameIndex].players[playerIndex].score = raw;
  localStorage.setItem("mahjongGames", JSON.stringify(games));
  updateSingleGameCalculations(gameIndex);
  if (shouldFormat) {
    formatScoreInput(input, gameIndex, playerIndex);
    saveGames({ immediate: true });
    renderSummary();
    renderDateSummary();
  }
}
function formatScoreInput(input, gameIndex, playerIndex) {
  const num = parseNumber(games[gameIndex].players[playerIndex].score);
  if (Number.isFinite(num)) input.value = formatNumber(num);
}
function updateSingleGameCalculations(gameIndex) {
  const game = games[gameIndex];
  if (!game) return;
  const calculated = ensureCalculatedGame(game);
  const gameEl = document.querySelector(`[data-game-index="${gameIndex}"]`);
  if (!gameEl) return;
  calculated.players.forEach((p, playerIndex) => {
    const scoreInput = gameEl.querySelector(`[data-score-index="${playerIndex}"]`);
    const diffEl = gameEl.querySelector(`[data-diff-index="${playerIndex}"]`);
    const rankEl = gameEl.querySelector(`[data-rank-index="${playerIndex}"]`);
    const resultEl = gameEl.querySelector(`[data-result-index="${playerIndex}"]`);
    if (scoreInput) {
      const scoreNum = parseNumber(games[gameIndex].players[playerIndex].score);
      scoreInput.classList.toggle("negative-input", Number.isFinite(scoreNum) && scoreNum < 0);
    }
    if (diffEl) { diffEl.textContent = signedText(p.diff1000); diffEl.className = `readonly-cell ${signedClass(p.diff1000)}`; }
    if (rankEl) rankEl.textContent = p.rank ? `${p.rank}位` : "";
    if (resultEl) { resultEl.textContent = signedText(p.result); resultEl.className = `readonly-cell ${signedClass(p.result)}`; }
  });
  const totalStatusEl = gameEl.querySelector("[data-total-status]");
  if (totalStatusEl) {
    const showWarning = calculated.hasAnyScore && !calculated.isValidTotal;
    totalStatusEl.textContent = showWarning ? `合計 ${formatNumber(calculated.total)} / ${formatNumber(TOTAL_POINT)}` : "";
  }
}
function handleTabMove(event, kind) {
  if (event.key !== "Tab") return;
  const inputs = [...document.querySelectorAll(`input[data-tab-kind="${kind}"]`)];
  const index = inputs.indexOf(event.target);
  if (index === -1) return;
  event.preventDefault();
  const nextIndex = event.shiftKey ? index - 1 : index + 1;
  if (inputs[nextIndex]) inputs[nextIndex].focus();
}
function focusNextInputOfKind(currentInput, kind, backwards = false) {
  const inputs = [...document.querySelectorAll(`input[data-tab-kind="${kind}"]`)];
  const index = inputs.indexOf(currentInput);
  if (index === -1) return false;
  const nextIndex = backwards ? index - 1 : index + 1;
  if (inputs[nextIndex]) { inputs[nextIndex].focus(); if (kind === "score") inputs[nextIndex].select(); return true; }
  return false;
}
function handleScoreBlur(gameIndex, playerIndex, input) {
  updateScoreValue(gameIndex, playerIndex, input, true);
  resetIOSZoomAfterInput();
  if (pendingScoreNext === input) {
    pendingScoreNext = null;
    setTimeout(() => focusNextInputOfKind(input, "score", false), 40);
    return;
  }
  if (!wasRecentPointerAction()) {
    setTimeout(() => {
      const currentActive = document.activeElement;
      if (currentActive && currentActive.dataset && currentActive.dataset.tabKind === "score") return;
      focusNextInputOfKind(input, "score", false);
    }, 30);
  }
}
function handleScoreKeydown(event, gameIndex, playerIndex) {
  if (event.key === "Tab") { handleTabMove(event, "score"); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    updateScoreValue(gameIndex, playerIndex, event.target, true);
    const moved = focusNextInputOfKind(event.target, "score", event.shiftKey);
    if (!moved) event.target.blur();
    resetIOSZoomAfterInput();
  }
}

function getGameNumberForDate(gameIndex) {
  const target = games[gameIndex];
  if (!target) return gameIndex + 1;
  const targetDate = target.date || todayString();
  const sameDate = games.map((g, i) => ({ g, i })).filter(x => (x.g.date || todayString()) === targetDate)
    .sort((a,b) => (a.g.createdAt || a.g.id || 0) - (b.g.createdAt || b.g.id || 0));
  return sameDate.findIndex(x => x.i === gameIndex) + 1;
}
function renderSheetSelect() {
  const select = document.getElementById("dateSheetSelect");
  const dates = uniqueDates();
  if (!dates.includes(selectedDate) && selectedDate) dates.push(selectedDate);
  const sortedDates = sortDatesDesc(dates);
  select.innerHTML = sortedDates.map(date => `<option value="${escapeAttr(date)}" ${date === selectedDate ? "selected" : ""}>${escapeHtml(formatDateJapanese(date))}</option>`).join("");
}
function renderGames() {
  ensureSelectedDate();
  renderSheetSelect();
  const container = document.getElementById("games");
  container.innerHTML = "";
  const list = selectedDateGames();
  if (list.length === 0) {
    container.innerHTML = `<div class="compact-card">この対局日のデータがありません。「対局追加」から始めてください。</div>`;
    return;
  }
  list.forEach(({ game, index: gameIndex }, displayIndex) => {
    const calculated = ensureCalculatedGame(game);
    const totalWarning = calculated.hasAnyScore && !calculated.isValidTotal ? `合計 ${formatNumber(calculated.total)} / ${formatNumber(TOTAL_POINT)}` : "";
    const div = document.createElement("div");
    div.className = "game";
    div.dataset.gameIndex = gameIndex;
    let html = `
      <div class="game-head">
        <div class="game-meta">
          <span class="date-chip">${escapeHtml(formatDateJapanese(game.date || selectedDate))}</span>
          <span class="game-title">対局 ${formatNumber(getGameNumberForDate(gameIndex))}</span>
        </div>
        <div class="game-actions">
          <span class="total-status" data-total-status>${totalWarning}</span>
          <button class="danger" onclick="deleteGame(${gameIndex})">削除</button>
        </div>
      </div>
      <div class="player-grid">
        <div class="header-cell">名前</div><div class="header-cell">点数</div><div class="header-cell">順位</div><div class="header-cell">差分</div><div class="header-cell">成績</div>
    `;
    const playerRows = calculated.players.map((p, playerIndex) => {
      const rawScore = games[gameIndex].players[playerIndex].score;
      const parsedRawScore = parseNumber(rawScore);
      const displayScore = Number.isFinite(parsedRawScore) ? formatNumber(parsedRawScore) : "";
      const scoreClass = Number.isFinite(parsedRawScore) && parsedRawScore < 0 ? "negative-input" : "";
      const row = playerIndex + 2;
      return { p, playerIndex, displayScore, scoreClass, row };
    });
    html += playerRows.map(({ p, playerIndex, row }) => `
      <input style="grid-column:1; grid-row:${row};" type="text" data-tab-kind="name" enterkeyhint="next" value="${escapeHtml(p.name || "")}" placeholder="名前"
        oninput="updateName(${gameIndex}, ${playerIndex}, this.value)" onblur="commitName(${gameIndex}, ${playerIndex}, this.value)" onkeydown="handleTabMove(event, 'name')">
    `).join("");
    html += playerRows.map(({ playerIndex, displayScore, scoreClass, row }) => `
      <input style="grid-column:2; grid-row:${row};" type="text" autocomplete="off" autocorrect="off" data-tab-kind="score" data-score-index="${playerIndex}" enterkeyhint="next" class="${scoreClass}"
        value="${displayScore}" placeholder="30,000" onfocus="this.value=this.value.replace(/,/g,'')" oninput="updateScoreValue(${gameIndex}, ${playerIndex}, this, false)"
        onbeforeinput="if(event.inputType==='insertLineBreak'){ pendingScoreNext=this; }" onblur="handleScoreBlur(${gameIndex}, ${playerIndex}, this)" onkeydown="handleScoreKeydown(event, ${gameIndex}, ${playerIndex})">
    `).join("");
    html += playerRows.map(({ p, playerIndex, row }) => `<div style="grid-column:3; grid-row:${row};" class="readonly-cell rank-cell" data-rank-index="${playerIndex}">${p.rank ? `${p.rank}位` : ""}</div>`).join("");
    html += playerRows.map(({ p, playerIndex, row }) => `<div style="grid-column:4; grid-row:${row};" class="readonly-cell ${signedClass(p.diff1000)}" data-diff-index="${playerIndex}">${signedText(p.diff1000)}</div>`).join("");
    html += playerRows.map(({ p, playerIndex, row }) => `<div style="grid-column:5; grid-row:${row};" class="readonly-cell ${signedClass(p.result)}" data-result-index="${playerIndex}">${signedText(p.result)}</div>`).join("");
    html += `</div>`;
    div.innerHTML = html;
    container.appendChild(div);
  });
}

function buildPersonalSummary() {
  const summary = {};
  games.forEach(game => {
    const calculated = ensureCalculatedGame(game);
    calculated.players.forEach(p => {
      const name = (p.name || "").trim();
      if (!name || !p.rank) return;
      if (!summary[name]) summary[name] = { name, count: 0, total: 0, ranks: {1:0,2:0,3:0,4:0} };
      summary[name].count += 1;
      summary[name].total += p.result;
      summary[name].ranks[p.rank] += 1;
    });
  });
  return Object.values(summary).sort((a,b) => b.total - a.total);
}
function renderSummary() {
  const rows = buildPersonalSummary().map(p => {
    const avg = p.count ? p.total / p.count : 0;
    return `<tr><td>${escapeHtml(p.name)}</td><td>${formatNumber(p.count)}</td><td class="${signedClass(p.total)}">${signedText(p.total)}</td><td class="${signedClass(avg)}">${signedText(avg,2)}</td><td>${formatNumber(p.ranks[1])}</td><td>${formatNumber(p.ranks[2])}</td><td>${formatNumber(p.ranks[3])}</td><td>${formatNumber(p.ranks[4])}</td></tr>`;
  }).join("");
  document.getElementById("summaryBody").innerHTML = rows || `<tr><td colspan="8">データがありません</td></tr>`;
}
function updateRate(date, value) {
  markLocalEditing();
  dateRates[date] = value.replace(/,/g, "");
  localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
}
function commitRate(date, input) {
  resetIOSZoomAfterInput();
  markLocalEditing();
  updateRate(date, input.value);
  const rate = parseNumber(dateRates[date]) || 0;
  input.value = Number.isFinite(rate) ? formatNumber(rate) : "";
  saveRates({ immediate: true });
  renderDateSummary();
}
function getDateSummaries() {
  const byDate = {};
  games.forEach(game => {
    const date = game.date || todayString();
    if (!byDate[date]) byDate[date] = {};
    const calculated = ensureCalculatedGame(game);
    calculated.players.forEach(p => {
      const name = (p.name || "").trim();
      if (!name || !p.rank) return;
      if (!byDate[date][name]) byDate[date][name] = { name, count: 0, total: 0 };
      byDate[date][name].count += 1;
      byDate[date][name].total += p.result;
    });
  });
  return sortDatesDesc(Object.keys(byDate)).map(date => ({ date, players: Object.values(byDate[date]).sort((a,b) => b.total - a.total) }));
}

function updateDateNote(date, value) {
  markLocalEditing();
  dateNotes[date] = value;
  saveNotes();
}
function commitDateNote(date, input) {
  markLocalEditing();
  dateNotes[date] = input.value;
  saveNotes({ immediate: true });
  resetIOSZoomAfterInput();
}

function renderDateSummary() {
  const summaries = getDateSummaries();
  const html = summaries.map(({ date, players }) => {
    const rateRaw = dateRates[date] ?? "";
    const rate = parseNumber(rateRaw) || 0;
    const rows = players.map(p => {
      const rated = p.total * rate;
      return `<tr><td>${escapeHtml(p.name)}</td><td>${formatNumber(p.count)}</td><td class="${signedClass(p.total)}">${signedText(p.total)}</td><td class="${signedClass(rated)}">${signedText(rated)}</td></tr>`;
    }).join("");
    const noteRaw = dateNotes[date] ?? "";
    return `<div class="date-card"><div class="date-head"><h3>${escapeHtml(formatDateJapanese(date))}</h3><label class="rate-box">レート<input type="text" inputmode="decimal" value="${rateRaw ? formatNumber(parseNumber(rateRaw)) : ""}" onfocus="this.value=this.value.replace(/,/g,'')" oninput="updateRate('${escapeAttr(date)}', this.value)" onblur="commitRate('${escapeAttr(date)}', this)" onkeydown="if(event.key==='Enter'){event.preventDefault();commitRate('${escapeAttr(date)}',this);this.blur();}"></label></div><div class="table-wrap"><table><thead><tr><th>名前</th><th>回数</th><th>日付内合計</th><th>合計×レート</th></tr></thead><tbody>${rows}</tbody></table></div><textarea class="date-note" rows="2" placeholder="メモ" oninput="updateDateNote('${escapeAttr(date)}', this.value)" onblur="commitDateNote('${escapeAttr(date)}', this)">${escapeHtml(noteRaw)}</textarea></div>`;
  }).join("");
  document.getElementById("dateSummary").innerHTML = html || `<div class="compact-card">データがありません</div>`;
}
function renderAll() { ensureSelectedDate(); renderGames(); renderSummary(); renderDateSummary(); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[s])); }
function escapeAttr(value) { return String(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }


const TAB_ORDER = ["input", "date", "personal"];
let swipeStartX = 0;
let swipeStartY = 0;
let swipeLastX = 0;
let swipeStartTime = 0;
let swipeMode = "";
let swipeBaseX = 0;
let swipeWidth = 0;
let swipeTracking = false;

function isSwipeIgnoredTarget(target) {
  if (!target) return false;
  const el = target.closest ? target.closest("input, textarea, select, button, a, .table-wrap") : null;
  return !!el;
}
function clampSwipeDelta(dx) {
  const index = getActiveTabIndex();
  if (index <= 0 && dx > 0) return dx * 0.28;
  if (index >= TAB_ORDER.length - 1 && dx < 0) return dx * 0.28;
  return dx;
}
function finishSwipe(dx, elapsed) {
  const index = getActiveTabIndex();
  let nextIndex = index;
  const enoughDistance = Math.abs(dx) > Math.min(120, swipeWidth * 0.24);
  const enoughFlick = Math.abs(dx) > 55 && elapsed < 360;
  if ((enoughDistance || enoughFlick) && Math.abs(dx) > 35) {
    nextIndex = dx < 0 ? index + 1 : index - 1;
  }
  nextIndex = Math.max(0, Math.min(TAB_ORDER.length - 1, nextIndex));
  if (nextIndex !== index) {
    activeTab = TAB_ORDER[nextIndex];
    document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
    document.getElementById(`tab${activeTab === "input" ? "Input" : activeTab === "personal" ? "Personal" : "Date"}`).classList.add("active");
    document.getElementById(`${activeTab}Panel`).classList.add("active");
    updatePanelPosition(true);
    renderAll();
    scrollToTopSoon();
  } else {
    updatePanelPosition(true);
  }
}
function initSwipeTabs() {
  const area = document.getElementById("scrollArea");
  if (!area) return;
  area.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) return;
    if (isUserEditing() || isSwipeIgnoredTarget(event.target)) return;
    const touch = event.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeLastX = swipeStartX;
    swipeStartTime = Date.now();
    swipeMode = "pending";
    swipeWidth = area.clientWidth || window.innerWidth;
    swipeBaseX = -getActiveTabIndex() * swipeWidth;
    swipeTracking = true;
    const track = document.getElementById("panelTrack");
    if (track) track.classList.remove("is-animating");
  }, { passive: true });

  area.addEventListener("touchmove", event => {
    if (!swipeTracking || !swipeStartTime || event.touches.length !== 1) return;
    if (isUserEditing()) {
      swipeTracking = false;
      updatePanelPosition(true);
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    swipeLastX = touch.clientX;

    if (swipeMode === "pending") {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        swipeMode = "vertical";
        swipeTracking = false;
        updatePanelPosition(true);
        return;
      }
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        swipeMode = "horizontal";
      } else {
        return;
      }
    }
    if (swipeMode !== "horizontal") return;
    event.preventDefault();
    const adjustedDx = clampSwipeDelta(dx);
    setTrackTranslate(swipeBaseX + adjustedDx, false);
  }, { passive: false });

  area.addEventListener("touchend", event => {
    if (!swipeStartTime) return;
    const elapsed = Date.now() - swipeStartTime;
    const dx = swipeLastX - swipeStartX;
    const mode = swipeMode;
    swipeStartTime = 0;
    swipeTracking = false;
    swipeMode = "";
    if (mode === "horizontal") finishSwipe(dx, elapsed);
    else updatePanelPosition(true);
  }, { passive: true });

  area.addEventListener("touchcancel", () => {
    swipeStartTime = 0;
    swipeTracking = false;
    swipeMode = "";
    updatePanelPosition(true);
  }, { passive: true });

  window.addEventListener("resize", () => updatePanelPosition(false));
  updatePanelPosition(false);
}

renderAll();
initSwipeTabs();
initFirebaseSync();
