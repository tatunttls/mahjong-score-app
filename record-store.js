/* Append-only operations. No snapshot replaces the set of known records. */
(function (root) {
  "use strict";
  const fields = ["date", "memo", ...Array.from({ length: 4 }, (_, i) =>
    [`players.${i}.name`, `players.${i}.score`]).flat()];
  const clone = value => JSON.parse(JSON.stringify(value));
  function validGame(g) {
    return !!g && typeof g === "object" && typeof g.id === "string" &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(g.id) && typeof g.date === "string" &&
      g.date.length <= 40 && typeof g.memo === "string" && g.memo.length <= 2000 &&
      Array.isArray(g.players) && g.players.length === 4 && g.players.every(p =>
        p && typeof p.name === "string" && p.name.length <= 200 &&
        typeof p.score === "string" && p.score.length <= 40);
  }
  function validEvent(e) {
    if (!e || e.version !== 11 || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id || "") ||
        typeof e.client !== "string" || e.client.length > 100 || !Number.isSafeInteger(e.clock) || e.clock < 1 ||
        !Number.isSafeInteger(e.time) || e.time <= 0 || typeof e.field !== "string" ||
        !(["rate", "note"].includes(e.kind) ? /^(\d{4}-\d{2}-\d{2}|日付なし)$/.test(e.target || "") :
          /^[a-zA-Z0-9_-]{1,100}$/.test(e.target || ""))) return false;
    if (e.kind === "create") return e.field === "" && validGame(e.value) && e.value.id === e.target;
    if (e.kind === "archive") return e.field === "" && typeof e.value === "boolean";
    if (e.kind === "rate") return e.field === "" && typeof e.value === "string" && e.value.length <= 40;
    if (e.kind === "note") return e.field === "" && typeof e.value === "string" && e.value.length <= 2000;
    if (e.kind === "edit") return fields.includes(e.field) && typeof e.value === "string" &&
      e.value.length <= (e.field === "memo" ? 2000 : e.field.endsWith("name") ? 200 : 40);
    return false;
  }
  function compare(a, b) { return a.clock - b.clock || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function getField(g, field) {
    if (!g) return "";
    const p = field.split(".");
    return p[0] === "players" ? g.players[Number(p[1])][p[2]] : g[field];
  }
  function project(events) {
    const records = new Map(), rates = Object.create(null), notes = Object.create(null), ordered = [...events].filter(validEvent).sort(compare);
    // Create seeds are immutable; a late/duplicate import cannot reset edited fields.
    for (const e of ordered) if (e.kind === "create" && !records.has(e.target)) {
      records.set(e.target, { game: { ...clone(e.value), createdAt: e.time }, archived: false, created: e.clock, seed: e.id });
    }
    for (const e of ordered) {
      if (e.kind === "rate") { rates[e.target] = e.value; continue; }
      if (e.kind === "note") { notes[e.target] = e.value; continue; }
      const r = records.get(e.target);
      if (!r) continue;
      if (e.kind === "archive") r.archived = e.value;
      if (e.kind === "edit") {
        const p = e.field.split(".");
        if (p[0] === "players") r.game.players[Number(p[1])][p[2]] = e.value;
        else r.game[e.field] = e.value;
      }
    }
    const sorted = [...records.values()].sort((a, b) => a.created - b.created || a.seed.localeCompare(b.seed));
    return { games: sorted.filter(r => !r.archived).map(r => r.game),
      trash: sorted.filter(r => r.archived).map(r => r.game), rates, notes, records, ordered };
  }
  const api = { fields, validGame, validEvent, project, compare, getField, clone };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MahjongStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
