const ORIGIN_POINT = 30000;
const TOTAL_POINT = 100000;
const PAGE_SIZE = 5;

let games = JSON.parse(localStorage.getItem("mahjongGames")) || [];
let dateRates = JSON.parse(localStorage.getItem("mahjongDateRates")) || {};
let remoteDocRef = null;
let isApplyingRemote = false;
let isFirebaseReady = false;
let remoteSaveTimer = null;
let currentPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
let dateCurrentPage = 1;
let activeTab = "input";
let localEditUntil = 0;

function markLocalEditing() {
  localEditUntil = Date.now() + 3000;
}

function isLocalEditWindow() {
  return Date.now() < localEditUntil;
}

function isFirebaseConfigFilled(config) {
  return !!(config && config.apiKey && config.projectId && config.appId);
}

function initFirebaseSync() {
  const config = window.MAHJONG_FIREBASE_CONFIG;
  if (!isFirebaseConfigFilled(config) || !window.firebase) {
    return;
  }

  try {
    firebase.initializeApp(config);
    const db = firebase.firestore();
    const docId = window.MAHJONG_FIREBASE_DOC_ID || "default";
    remoteDocRef = db.collection("mahjongScoreApps").doc(docId);
    isFirebaseReady = true;

    remoteDocRef.onSnapshot(snapshot => {
      if (!snapshot.exists) {
        persistRemoteData();
        return;
      }

      const data = snapshot.data() || {};
      // 入力中にFirestoreの同期で画面全体を再描画すると、
      // 1文字入力した時点でフォーカスが外れてしまうため、入力中は反映を保留します。
      if (isUserEditing()) {
        return;
      }

      isApplyingRemote = true;
      games = Array.isArray(data.games) ? data.games : [];
      dateRates = data.dateRates && typeof data.dateRates === "object" ? data.dateRates : {};
      localStorage.setItem("mahjongGames", JSON.stringify(games));
      localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
      currentPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
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
  if (remoteSaveTimer) {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = null;
  }
  if (!isFirebaseReady || !remoteDocRef || isApplyingRemote) return;
  return remoteDocRef.set({
    games,
    dateRates,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(error => {
    console.error("Firebase save error:", error);
    alert("共有データの保存に失敗しました。ネットワークまたはFirestoreルールを確認してください。");
  });
}

function scheduleRemoteSave() {
  if (!isFirebaseReady || !remoteDocRef || isApplyingRemote) return;
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    persistRemoteData();
  }, 800);
}

function saveGames(options = {}) {
  localStorage.setItem("mahjongGames", JSON.stringify(games));
  if (options.immediate) persistRemoteData();
  else scheduleRemoteSave();
}

function saveRates(options = {}) {
  localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
  if (options.immediate) persistRemoteData();
  else scheduleRemoteSave();
}

function isUserEditing() {
  if (isLocalEditWindow()) return true;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  return ["input", "textarea", "select"].includes(tag);
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });

  const totalStatusEl = gameEl.querySelector("[data-total-status]");
  if (totalStatusEl) {
    const showWarning = calculated.hasAnyScore && !calculated.isValidTotal;
    totalStatusEl.textContent = showWarning ? `合計 ${formatNumber(calculated.total)} / ${formatNumber(TOTAL_POINT)}` : "";
  }
}

function signedClass(value) {
  return Number(value) < 0 ? "negative" : "";
}

function signedText(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return formatNumber(num, digits);
}

function goshaRokunyu(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 0) return Math.floor(value + 0.4);
  return -Math.floor(Math.abs(value) + 0.4);
}

function ensureCalculatedGame(game) {
  const players = game.players.map((player, index) => {
    const score = parseNumber(player.score);
    const diff1000 = Number.isFinite(score) ? goshaRokunyu((score - ORIGIN_POINT) / 1000) : 0;
    return { ...player, score, originalIndex: index, diff1000, rank: "", result: 0 };
  });

  const entered = players.filter(p => Number.isFinite(p.score));
  const sorted = [...entered].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });
  sorted.forEach((p, i) => { players[p.originalIndex].rank = i + 1; });

  // 新ルール: 2位=差分+5、3位=差分-5、4位=差分-10、1位=2〜4位の総和のマイナス
  let lowerTotal = 0;
  players.forEach(p => {
    if (p.rank === 2) p.result = p.diff1000 + 5;
    if (p.rank === 3) p.result = p.diff1000 - 5;
    if (p.rank === 4) p.result = p.diff1000 - 10;
    if ([2, 3, 4].includes(p.rank)) lowerTotal += p.result;
  });
  players.forEach(p => {
    if (p.rank === 1) p.result = -lowerTotal;
  });

  const total = entered.reduce((sum, p) => sum + p.score, 0);
  const hasAnyScore = entered.length > 0;
  const isComplete = entered.length === 4;
  const isValidTotal = isComplete && total === TOTAL_POINT;
  return { players, total, hasAnyScore, isComplete, isValidTotal };
}

function getLastPlayers() {
  if (games.length === 0) return ["", "", "", ""];
  const last = games[games.length - 1];
  return last.players.map(p => p.name || "");
}

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hasAnyScoreInput(game) {
  if (!game || !Array.isArray(game.players)) return false;
  return game.players.some(player => String(player.score ?? "").replace(/,/g, "").trim() !== "");
}

function addGame() {
  const latestGame = games[games.length - 1];
  if (latestGame && !hasAnyScoreInput(latestGame)) {
    alert("未入力の対局があります。点数を入力してから、次の対局を追加してください。");
    currentPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
    switchTab("input");
    return;
  }

  const names = getLastPlayers();
  games.push({
    id: Date.now(),
    date: todayString(),
    memo: "",
    players: names.map(name => ({ name, score: "" }))
  });
  saveGames({ immediate: true });
  currentPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  switchTab("input");
}

function deleteGame(gameIndex) {
  if (!confirm("この対局を削除しますか？")) return;
  games.splice(gameIndex, 1);
  saveGames({ immediate: true });
  currentPage = Math.min(currentPage, Math.max(1, Math.ceil(games.length / PAGE_SIZE)));
  renderAll();
}

function clearAll() {
  if (!confirm("すべての対局データを削除しますか？")) return;
  games = [];
  saveGames({ immediate: true });
  currentPage = 1;
  renderAll();
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
  document.getElementById(`tab${tab === "input" ? "Input" : tab === "personal" ? "Personal" : "Date"}`).classList.add("active");
  document.getElementById(`${tab}Panel`).classList.add("active");
  renderAll();
}

function setPage(page) {
  const maxPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), maxPage);
  renderGames();
}

function setDatePage(page) {
  const maxPage = Math.max(1, Math.ceil(getDateSummaries().length / PAGE_SIZE));
  dateCurrentPage = Math.min(Math.max(1, page), maxPage);
  sessionStorage.setItem("mahjongDatePageTouched", "1");
  renderDateSummary();
}

function updateName(gameIndex, playerIndex, value) {
  markLocalEditing();
  games[gameIndex].players[playerIndex].name = value;
  localStorage.setItem("mahjongGames", JSON.stringify(games));
}

function commitName(gameIndex, playerIndex, value) {
  markLocalEditing();
  games[gameIndex].players[playerIndex].name = value;
  saveGames({ immediate: true });
  renderSummary();
  dateCurrentPage = Math.max(1, Math.ceil(getDateSummaries().length / PAGE_SIZE));
  renderDateSummary();
}

function updateDate(gameIndex, value) {
  markLocalEditing();
  games[gameIndex].date = value;
  saveGames();
  dateCurrentPage = Math.max(1, Math.ceil(getDateSummaries().length / PAGE_SIZE));
  renderDateSummary();
}

function updateMemo(gameIndex, value) {
  markLocalEditing();
  games[gameIndex].memo = value;
  localStorage.setItem("mahjongGames", JSON.stringify(games));
}

function commitMemo(gameIndex, value) {
  markLocalEditing();
  games[gameIndex].memo = value;
  saveGames({ immediate: true });
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
      scoreInput.classList.remove("score-invalid");
      const scoreNum = parseNumber(games[gameIndex].players[playerIndex].score);
      scoreInput.classList.toggle("negative-input", Number.isFinite(scoreNum) && scoreNum < 0);
    }
    if (diffEl) {
      diffEl.textContent = signedText(p.diff1000);
      diffEl.className = `readonly-cell ${signedClass(p.diff1000)}`;
    }
    if (rankEl) rankEl.textContent = p.rank ? `${p.rank}位` : "";
    if (resultEl) {
      resultEl.textContent = signedText(p.result);
      resultEl.className = `readonly-cell ${signedClass(p.result)}`;
    }
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

function handleScoreKeydown(event, gameIndex, playerIndex) {
  handleTabMove(event, "score");
  if (event.key === "Enter") {
    event.preventDefault();
    updateScoreValue(gameIndex, playerIndex, event.target, true);
    event.target.blur();
  }
}

function getGameNumberForDate(gameIndex) {
  const target = games[gameIndex];
  if (!target) return gameIndex + 1;
  const targetDate = target.date || "日付なし";
  let count = 0;
  for (let i = 0; i <= gameIndex; i++) {
    const date = games[i].date || "日付なし";
    if (date === targetDate) count += 1;
  }
  return count;
}

function renderPager(targetId) {
  const maxPage = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  const target = document.getElementById(targetId);
  target.innerHTML = `
    <button onclick="setPage(1)" ${currentPage === 1 ? "disabled" : ""}>最初</button>
    <button onclick="setPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>前へ</button>
    <span class="page-info">${formatNumber(currentPage)} / ${formatNumber(maxPage)}</span>
    <button onclick="setPage(${currentPage + 1})" ${currentPage === maxPage ? "disabled" : ""}>次へ</button>
    <button onclick="setPage(${maxPage})" ${currentPage === maxPage ? "disabled" : ""}>最後</button>
  `;
}

function renderGames() {
  renderPager("pagerTop");
  renderPager("pagerBottom");
  const container = document.getElementById("games");
  container.innerHTML = "";

  if (games.length === 0) {
    container.innerHTML = `<div class="compact-card">対局データがありません。「対局追加」から始めてください。</div>`;
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageGames = games.slice(start, start + PAGE_SIZE);

  pageGames.forEach((game, offset) => {
    const gameIndex = start + offset;
    const calculated = ensureCalculatedGame(game);
    const totalWarning = calculated.hasAnyScore && !calculated.isValidTotal
      ? `合計 ${formatNumber(calculated.total)} / ${formatNumber(TOTAL_POINT)}`
      : "";

    const div = document.createElement("div");
    div.className = "game";
    div.dataset.gameIndex = gameIndex;

    let html = `
      <div class="game-head">
        <div class="game-meta">
          <input class="date-input" type="date" value="${game.date || ""}" onchange="updateDate(${gameIndex}, this.value)">
          <span class="game-title">対局 ${formatNumber(getGameNumberForDate(gameIndex))}</span>
        </div>
        <input class="game-memo" type="text" value="${escapeHtml(game.memo || "")}" placeholder="メモ" oninput="updateMemo(${gameIndex}, this.value)" onblur="commitMemo(${gameIndex}, this.value)">
        <div class="game-actions">
          <span class="total-status" data-total-status>${totalWarning}</span>
          <button class="danger" onclick="deleteGame(${gameIndex})">削除</button>
        </div>
      </div>
      <div class="player-grid">
        <div class="header-cell">名前</div>
        <div class="header-cell">点数</div>
        <div class="header-cell">順位</div>
        <div class="header-cell">差分</div>
        <div class="header-cell">成績</div>
    `;

    calculated.players.forEach((p, playerIndex) => {
      const rawScore = games[gameIndex].players[playerIndex].score;
      const parsedRawScore = parseNumber(rawScore);
      const displayScore = Number.isFinite(parsedRawScore) ? formatNumber(parsedRawScore) : "";
      const scoreClass = Number.isFinite(parsedRawScore) && parsedRawScore < 0 ? "negative-input" : "";
      html += `
        <input type="text" data-tab-kind="name" value="${escapeHtml(p.name || "")}" placeholder="名前"
          oninput="updateName(${gameIndex}, ${playerIndex}, this.value)"
          onblur="commitName(${gameIndex}, ${playerIndex}, this.value)"
          onkeydown="handleTabMove(event, 'name')">
        <input type="text" inputmode="numeric" data-tab-kind="score" data-score-index="${playerIndex}" class="${scoreClass}"
          value="${displayScore}" placeholder="30,000"
          onfocus="this.value = this.value.replace(/,/g, '')"
          oninput="updateScoreValue(${gameIndex}, ${playerIndex}, this, false)"
          onblur="updateScoreValue(${gameIndex}, ${playerIndex}, this, true)"
          onkeydown="handleScoreKeydown(event, ${gameIndex}, ${playerIndex})">
        <div class="readonly-cell rank-cell" data-rank-index="${playerIndex}">${p.rank ? `${p.rank}位` : ""}</div>
        <div class="readonly-cell ${signedClass(p.diff1000)}" data-diff-index="${playerIndex}">${signedText(p.diff1000)}</div>
        <div class="readonly-cell ${signedClass(p.result)}" data-result-index="${playerIndex}">${signedText(p.result)}</div>
      `;
    });

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
      if (!summary[name]) {
        summary[name] = { name, count: 0, total: 0, ranks: {1:0,2:0,3:0,4:0} };
      }
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
    return `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${formatNumber(p.count)}</td>
        <td class="${signedClass(p.total)}">${signedText(p.total)}</td>
        <td class="${signedClass(avg)}">${signedText(avg, 2)}</td>
        <td>${formatNumber(p.ranks[1])}</td>
        <td>${formatNumber(p.ranks[2])}</td>
        <td>${formatNumber(p.ranks[3])}</td>
        <td>${formatNumber(p.ranks[4])}</td>
      </tr>
    `;
  }).join("");
  document.getElementById("summaryBody").innerHTML = rows || `<tr><td colspan="8">データがありません</td></tr>`;
}

function updateRate(date, value) {
  markLocalEditing();
  dateRates[date] = value.replace(/,/g, "");
  localStorage.setItem("mahjongDateRates", JSON.stringify(dateRates));
}

function commitRate(date, input) {
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
    const date = game.date || "日付なし";
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

  return Object.keys(byDate).sort().map(date => ({
    date,
    players: Object.values(byDate[date]).sort((a, b) => b.total - a.total)
  }));
}

function renderDatePager(targetId, totalDates) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const maxPage = Math.max(1, Math.ceil(totalDates / PAGE_SIZE));
  dateCurrentPage = Math.min(Math.max(1, dateCurrentPage), maxPage);
  target.innerHTML = `
    <button onclick="setDatePage(1)" ${dateCurrentPage === 1 ? "disabled" : ""}>最初</button>
    <button onclick="setDatePage(${dateCurrentPage - 1})" ${dateCurrentPage === 1 ? "disabled" : ""}>前へ</button>
    <span class="page-info">${formatNumber(dateCurrentPage)} / ${formatNumber(maxPage)}</span>
    <button onclick="setDatePage(${dateCurrentPage + 1})" ${dateCurrentPage === maxPage ? "disabled" : ""}>次へ</button>
    <button onclick="setDatePage(${maxPage})" ${dateCurrentPage === maxPage ? "disabled" : ""}>最後</button>
  `;
}

function renderDateSummary() {
  const summaries = getDateSummaries();
  if (dateCurrentPage === 1 && summaries.length > PAGE_SIZE) {
    const saved = sessionStorage.getItem("mahjongDatePageTouched");
    if (!saved) dateCurrentPage = Math.max(1, Math.ceil(summaries.length / PAGE_SIZE));
  }

  renderDatePager("datePagerTop", summaries.length);
  renderDatePager("datePagerBottom", summaries.length);

  const start = (dateCurrentPage - 1) * PAGE_SIZE;
  const pageDates = summaries.slice(start, start + PAGE_SIZE);

  const html = pageDates.map(({ date, players }) => {
    const rateRaw = dateRates[date] ?? "";
    const rate = parseNumber(rateRaw) || 0;
    const rows = players.map(p => {
      const rated = p.total * rate;
      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${formatNumber(p.count)}</td>
          <td class="${signedClass(p.total)}">${signedText(p.total)}</td>
          <td class="${signedClass(rated)}">${signedText(rated)}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="date-card">
        <div class="date-head">
          <h3>${escapeHtml(date)}</h3>
          <label class="rate-box">レート
            <input type="text" inputmode="decimal" value="${rateRaw ? formatNumber(parseNumber(rateRaw)) : ""}"
              onfocus="this.value = this.value.replace(/,/g, '')"
              oninput="updateRate('${escapeAttr(date)}', this.value)"
              onblur="commitRate('${escapeAttr(date)}', this)"
              onkeydown="if(event.key === 'Enter'){ event.preventDefault(); commitRate('${escapeAttr(date)}', this); this.blur(); }">
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>名前</th><th>回数</th><th>日付内合計</th><th>合計×レート</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("dateSummary").innerHTML = html || `<div class="compact-card">データがありません</div>`;
}

function renderAll() {
  renderGames();
  renderSummary();
  renderDateSummary();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[s]));
}

function escapeAttr(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
}

renderAll();
initFirebaseSync();
