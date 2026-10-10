"use strict";
const recordEvents = new Map();
const pendingEvents = new Set();
const recordBoard = String(window.MAHJONG_FIREBASE_DOC_ID || "default");
const recordProject = window.MAHJONG_FIREBASE_CONFIG?.projectId || "local";
const recordPrefix = `mahjong-v11:${recordProject}:${recordBoard}:event:`;
const recordClient = newRecordId();
let recordClock = 0;
let recordCollection = null;
let syncReady = false;
let syncRunning = false;
let syncError = "";
let storageError = "";
let projectionDue = false;
let retryDelay = 2000;
let syncRetryTimer = null;

function newRecordId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("このブラウザは安全な記録IDを作成できません。新しいブラウザをお使いください。");
}

function updateSaveStatus() {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  const configured = !!window.MAHJONG_FIREBASE_CONFIG?.projectId;
  el.textContent = storageError || syncError || (pendingEvents.size
    ? `端末に保存済み・共有へ未送信 ${pendingEvents.size}件${navigator.onLine === false ? "（オフライン）" : ""}`
    : configured ? (syncReady ? "共有に保存済み" : "共有保存先を確認中…") : "この端末に保存済み");
  el.classList.toggle("save-warning", !!storageError || !!syncError || pendingEvents.size > 0);
}

function acceptStoredEvent(raw) {
  const entry = JSON.parse(raw);
  if (!MahjongStore.validEvent(entry.event)) throw new Error("保存形式が不正です");
  const e = entry.event;
  const old = recordEvents.get(e.id);
  if (old && JSON.stringify(canonicalEvent(old)) !== JSON.stringify(canonicalEvent(e))) throw new Error("同じIDの履歴が一致しません");
  recordEvents.set(e.id, e);
  recordClock = Math.max(recordClock, e.clock);
  if (entry.pending) pendingEvents.add(e.id);
  else pendingEvents.delete(e.id);
}

function initRecordStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(recordPrefix)) continue;
      try { acceptStoredEvent(localStorage.getItem(key)); }
      catch (error) { storageError = "読めない履歴があります。元データを保持しています。バックアップを書き出してください。"; }
    }
  } catch (error) { storageError = "端末の保存領域を読み込めません。ブラウザの設定を確認してください。"; }
  applyRecordProjection(true);
  window.addEventListener("storage", event => {
    if (!event.key?.startsWith(recordPrefix) || !event.newValue) return;
    try { acceptStoredEvent(event.newValue); requestRecordProjection(); scheduleRemoteSave(); }
    catch (error) { storageError = "別タブの保存を読み込めません。バックアップを書き出してください。"; }
    updateSaveStatus();
  });
  window.addEventListener("online", () => { retryDelay = 2000; flushRecordQueue(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushRecordQueue();
  });
  // Every input is already durable. This timer only postpones repainting while typing.
  setInterval(() => { if (projectionDue && !isUserEditing()) applyRecordProjection(); }, 500);
  updateSaveStatus();
}

function persistEvent(e, pending) {
  try {
    localStorage.setItem(recordPrefix + e.id, JSON.stringify({ event: e, pending }));
    return true;
  } catch (error) {
    storageError = "端末への保存に失敗しました。空き容量を確保し、バックアップを書き出してください。";
    updateSaveStatus();
    return false;
  }
}

function enqueueRecord(kind, target, value, field = "") {
  const e = { version: 11, id: newRecordId(), client: recordClient,
    clock: recordClock + 1, time: Date.now(), kind, target: String(target), field, value: MahjongStore.clone(value) };
  if (!MahjongStore.validEvent(e)) { alert("入力が長すぎるか、保存形式が不正です。"); return false; }
  if (!persistEvent(e, !!window.MAHJONG_FIREBASE_CONFIG?.projectId)) {
    alert("入力を端末に保存できませんでした。直前の保存済み内容を表示します。");
    applyRecordProjection(true);
    return false;
  }
  recordClock = e.clock;
  recordEvents.set(e.id, e);
  if (window.MAHJONG_FIREBASE_CONFIG?.projectId) pendingEvents.add(e.id);
  updateSaveStatus();
  scheduleRemoteSave();
  return true;
}

function editRecordGame(index, field, value) {
  const g = games[index];
  if (!g) return false;
  value = String(value);
  if (MahjongStore.getField(g, field) === value) return true;
  if (!enqueueRecord("edit", g.id, value, field)) return false;
  const parts = field.split(".");
  if (parts[0] === "players") g.players[Number(parts[1])][parts[2]] = value;
  else g[field] = value;
  return true;
}

function requestRecordProjection() {
  projectionDue = true;
  if (!isUserEditing()) applyRecordProjection();
}

function applyRecordProjection(force = false) {
  if (!force && isUserEditing()) { projectionDue = true; return; }
  const model = MahjongStore.project(recordEvents.values());
  games = model.games;
  dateRates = model.rates;
  dateNotes = model.notes;
  projectionDue = false;
  renderAll();
  renderRecordTools(model);
}

function initFirebaseSync() {
  const config = window.MAHJONG_FIREBASE_CONFIG;
  if (!config?.projectId) { updateSaveStatus(); return; }
  if (!window.firebase) {
    syncError = "共有保存を開始できません。通信を確認して再読み込みしてください。入力は端末に保持します。";
    updateSaveStatus(); return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    recordCollection = firebase.firestore().collection("mahjongScoreAppsV11").doc(recordBoard).collection("events");
    recordCollection.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      for (const doc of snapshot.docs) {
        const e = doc.data();
        if (e.id !== doc.id || !MahjongStore.validEvent(e)) {
          storageError = "形式が不正な共有履歴を保留しました。保存済みの記録は保持しています。"; continue;
        }
        const old = recordEvents.get(e.id);
        if (old && JSON.stringify(canonicalEvent(old)) !== JSON.stringify(canonicalEvent(e))) {
          storageError = "共有履歴の内容が一致しません。端末の記録は保持しています。"; continue;
        }
        const wasPending = pendingEvents.has(e.id);
        recordEvents.set(e.id, e);
        recordClock = Math.max(recordClock, e.clock);
        const confirmed = !snapshot.metadata.fromCache && !doc.metadata.hasPendingWrites;
        if (confirmed) pendingEvents.delete(e.id);
        if (!old || wasPending !== pendingEvents.has(e.id)) persistEvent(e, pendingEvents.has(e.id));
      }
      // An empty/removed server snapshot NEVER clears the local event journal.
      syncReady = !snapshot.metadata.fromCache;
      if (syncReady) {
        const remoteIds = new Set(snapshot.docs.map(doc => doc.id));
        for (const e of recordEvents.values()) if (!remoteIds.has(e.id)) {
          const wasPending = pendingEvents.has(e.id);
          pendingEvents.add(e.id);
          if (!wasPending) persistEvent(e, true);
        }
        syncError = "";
      }
      requestRecordProjection();
      updateSaveStatus();
      if (syncReady) flushRecordQueue();
    }, error => {
      syncReady = false;
      syncError = "共有履歴を読み込めません。Firebaseのルール・通信を確認後、再読み込みしてください。入力は端末に保持します。";
      console.error(error); updateSaveStatus();
    });
  } catch (error) {
    syncError = "共有保存を開始できません。Firebase設定を確認してください。入力は端末に保持します。";
    console.error(error); updateSaveStatus();
  }
}

function scheduleRemoteSave() {
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(flushRecordQueue, 800);
}

async function flushRecordQueue() {
  if (!syncReady || !recordCollection || syncRunning || navigator.onLine === false) return;
  syncRunning = true;
  try {
    for (const id of [...pendingEvents].sort((a, b) => MahjongStore.compare(recordEvents.get(a), recordEvents.get(b)))) {
      const e = recordEvents.get(id), ref = recordCollection.doc(id);
      // Read-before-create makes retries idempotent, without allowing any updates.
      await firebase.firestore().runTransaction(async tx => {
        const existing = await tx.get(ref);
        if (existing.exists) {
          const stored = existing.data();
          if (stored.id !== e.id || JSON.stringify(canonicalEvent(stored)) !== JSON.stringify(canonicalEvent(e))) {
            throw new Error("既存の履歴と一致しません");
          }
        } else tx.set(ref, e);
      });
      pendingEvents.delete(id);
      persistEvent(e, false);
      updateSaveStatus();
    }
    syncError = "";
    retryDelay = 2000;
  } catch (error) {
    syncError = `共有保存に失敗しました。端末に保持しています（未送信 ${pendingEvents.size}件）。接続・Firebaseルールを確認してください。`;
    console.error(error);
    clearTimeout(syncRetryTimer);
    syncRetryTimer = setTimeout(flushRecordQueue, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  } finally {
    syncRunning = false;
    updateSaveStatus();
  }
}

function canonicalEvent(e) {
  return { version: e.version, id: e.id, client: e.client, clock: e.clock, time: e.time,
    kind: e.kind, target: e.target, field: e.field, value: e.kind === "create" ? {
      id: e.value.id, date: e.value.date, memo: e.value.memo,
      players: e.value.players.map(p => ({ name: p.name, score: p.score }))
    } : e.value };
}

function renderRecordTools(model = MahjongStore.project(recordEvents.values())) {
  const trash = document.getElementById("trashList");
  if (!trash) return;
  trash.innerHTML = model.trash.map(g => `<div class="record-row"><span>${escapeHtml(g.date)} ${escapeHtml(g.players.map(p => p.name || "未記入").join("・"))}</span><button onclick="restoreRecord('${g.id}')">戻す</button></div>`).join("") || "ごみ箱は空です。";
  document.getElementById("trashCount").textContent = model.trash.length;
  const labels = { create: "対局追加", edit: "入力変更", archive: "ごみ箱への移動・復元", rate: "レート変更", note: "メモ変更" };
  document.getElementById("historyList").innerHTML = model.ordered.slice(-100).reverse().map(e => {
    const g = model.records.get(e.target)?.game;
    let detail = g ? `${g.date} ${g.players.map(p => p.name).filter(Boolean).join("・")}` : e.target;
    if (e.kind === "edit") detail += ` ${e.field === "date" ? "日付" : e.field === "memo" ? "メモ" : `${Number(e.field.split(".")[1]) + 1}人目の${e.field.endsWith("name") ? "名前" : "点数"}`} → ${e.value}`;
    if (e.kind === "rate") detail += ` → ${e.value}`;
    if (e.kind === "note") detail += ` → ${e.value}`;
    if (e.kind === "archive") detail += e.value ? " ごみ箱へ" : " 復元";
    return `<div class="record-row"><span><small>${escapeHtml(new Date(e.time).toLocaleString("ja-JP"))} ${labels[e.kind]}</small><br>${escapeHtml(detail)}</span><button onclick="undoRecordEvent('${e.id}')">取り消す</button></div>`;
  }).join("") || "変更履歴はありません。";
}

function restoreRecord(id) {
  if (enqueueRecord("archive", id, false)) applyRecordProjection(true);
}

function undoRecordEvent(id) {
  const ordered = MahjongStore.project(recordEvents.values()).ordered;
  const index = ordered.findIndex(e => e.id === id), e = ordered[index];
  if (!e || !confirm("この変更を取り消しますか？ 後から同じ項目を編集している場合、その項目はこの変更前の内容に戻ります。履歴は残ります。")) return;
  const before = MahjongStore.project(ordered.slice(0, index));
  if (e.kind === "edit") enqueueRecord("edit", e.target, MahjongStore.getField(before.records.get(e.target)?.game, e.field), e.field);
  if (e.kind === "rate") enqueueRecord("rate", e.target, before.rates[e.target] || "");
  if (e.kind === "note") enqueueRecord("note", e.target, before.notes[e.target] || "");
  if (e.kind === "archive") enqueueRecord("archive", e.target, before.records.get(e.target)?.archived || false);
  if (e.kind === "create") enqueueRecord("archive", e.target, true);
  applyRecordProjection(true);
}

function exportRecordBackup() {
  const raw = [];
  try { for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(recordPrefix)) raw.push({ key, value: localStorage.getItem(key) });
  } } catch (error) { /* Valid in-memory records can still be exported. */ }
  const backup = { version: 11, project: recordProject, board: recordBoard,
    exportedAt: new Date().toISOString(), events: [...recordEvents.values()], raw };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = `mahjong-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importRecordBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("20MB以下のファイルを選んでください。");
    const backup = JSON.parse(await file.text());
    if (backup.version !== 11 || backup.project !== recordProject || backup.board !== recordBoard ||
        !Array.isArray(backup.events) || !backup.events.every(MahjongStore.validEvent)) throw new Error("この成績表のv11バックアップではありません。");
    const incoming = new Map();
    for (const e of backup.events) {
      const old = incoming.get(e.id) || recordEvents.get(e.id);
      if (old && JSON.stringify(canonicalEvent(old)) !== JSON.stringify(canonicalEvent(e))) throw new Error("同じIDの履歴が一致しません。");
      incoming.set(e.id, canonicalEvent(e));
    }
    if (!confirm("バックアップの履歴を追加します。現在の履歴は削除されません。続けますか？")) return;
    let added = 0;
    for (const e of incoming.values()) {
      if (recordEvents.has(e.id)) continue;
      if (!persistEvent(e, !!window.MAHJONG_FIREBASE_CONFIG?.projectId)) throw new Error("端末の容量不足で取り込みを中断しました。取り込み済みの履歴は保持しています。");
      recordEvents.set(e.id, e); recordClock = Math.max(recordClock, e.clock);
      if (window.MAHJONG_FIREBASE_CONFIG?.projectId) pendingEvents.add(e.id);
      added++;
    }
    applyRecordProjection(true); updateSaveStatus(); scheduleRemoteSave();
    alert(`${added}件の履歴を追加しました。ごみ箱の対局は「戻す」で復元できます。`);
  } catch (error) { applyRecordProjection(true); updateSaveStatus(); alert(`取り込みできませんでした：${error.message}`); }
  finally { input.value = ""; }
}
