'use strict';
// Shared high score board. Scores live in the arcade-scores Supabase project, so everyone who
// plays sees the same list. The page loads this with <script src="leaderboard.js" data-game="...">
// and sets the --lb-* colours and fonts in its own CSS. The same file is in both game repos.
//
// Leaderboard.open({ score, cheated, onClose }) asks for a name when there is a score to save,
// then shows the All Time and This Week lists. Leaderboard.open({ onClose }) only shows the lists.

const Leaderboard = (() => {
  const API = 'https://ffkwudvifwapjcunzbce.supabase.co/rest/v1/rpc/';
  // The publishable key is meant to be public. The database only lets it save a score or read the lists.
  const KEY = 'sb_publishable_IMzJKKRNE3fzLC4a7-WmgQ_Euc5pSFr';
  const SHOW = 10;
  const GAME = (document.currentScript && document.currentScript.dataset.game) || '';

  let root = null, onClose = null, period = 'all', mine = null, note = '', open = false;
  const el = {};

  function call(fn, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    return fetch(API + fn, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    }).then(async (res) => {
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.message) || 'The scoreboard could not be reached');
      return data;
    }).finally(() => clearTimeout(timer));
  }

  function savedName() {
    try { return localStorage.getItem('arcade-name') || localStorage.getItem('jetpack-name') || ''; } catch (e) { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem('arcade-name', name); } catch (e) { /* private window */ }
  }

  const CSS = `
  .lb { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
    padding: 16px; background: rgba(0, 0, 0, 0.62); font-family: var(--lb-font, system-ui, sans-serif); }
  .lb[hidden] { display: none; }
  .lb-card { width: min(100%, 380px); max-height: calc(100vh - 32px); overflow-y: auto; padding: 22px 22px 18px;
    background: var(--lb-panel, #161220); color: var(--lb-ink, #eee); border: 2px solid var(--lb-edge, #333);
    border-radius: 12px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6); }
  .lb h2 { margin: 0 0 12px; text-align: center; font: var(--lb-title-weight, 400) var(--lb-title-size, 34px) var(--lb-title-font, inherit);
    color: var(--lb-title, var(--lb-accent, #fc6)); letter-spacing: 0.02em; line-height: 1.1; }
  .lb-final { margin: 0 0 14px; text-align: center; color: var(--lb-muted, #999); font-size: 15px; }
  .lb-final b { color: var(--lb-accent, #fc6); font-size: 22px; font-variant-numeric: tabular-nums; }
  .lb label { display: block; margin-bottom: 6px; font-size: 13px; color: var(--lb-muted, #999); }
  .lb input { width: 100%; padding: 10px 12px; font: 600 18px var(--lb-font, inherit); text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--lb-ink, #eee); background: var(--lb-bg, #0b0910);
    border: 2px solid var(--lb-edge, #333); border-radius: 8px; outline: none; }
  .lb input:focus { border-color: var(--lb-accent, #fc6); }
  .lb-row { display: flex; gap: 10px; margin-top: 12px; }
  .lb button { font: 600 15px var(--lb-font, inherit); border-radius: 8px; cursor: pointer; }
  .lb-primary { flex: 1; padding: 11px 14px; color: var(--lb-on-accent, #111); background: var(--lb-accent, #fc6); border: 0; }
  .lb-primary:disabled { opacity: 0.6; cursor: default; }
  .lb-secondary { padding: 11px 14px; color: var(--lb-ink, #eee); background: transparent; border: 2px solid var(--lb-edge, #333); }
  .lb-primary:focus-visible, .lb-secondary:focus-visible, .lb-tabs button:focus-visible { outline: 2px solid var(--lb-ink, #eee); outline-offset: 2px; }
  .lb-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin-bottom: 10px;
    background: var(--lb-bg, #0b0910); border-radius: 9px; }
  .lb-tabs button { padding: 8px; color: var(--lb-muted, #999); background: transparent; border: 0; border-radius: 6px; }
  .lb-tabs button[aria-selected="true"] { color: var(--lb-ink, #eee); background: var(--lb-edge, #333); }
  .lb-list { list-style: none; margin: 0; padding: 0; min-height: 120px; font-variant-numeric: tabular-nums; }
  .lb-list li { display: grid; grid-template-columns: 2.6em 1fr auto; gap: 8px; align-items: center;
    padding: 6px 8px; border-radius: 6px; font-size: 15px; }
  .lb-list li:nth-child(odd) { background: rgba(255, 255, 255, 0.03); }
  .lb-list .lb-rank { color: var(--lb-muted, #999); text-align: right; }
  .lb-list .lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.04em; }
  .lb-list .lb-score { font-weight: 600; }
  .lb-list li.lb-mine { background: var(--lb-mine, rgba(255, 204, 102, 0.18)); color: var(--lb-accent, #fc6); }
  .lb-list li.lb-mine .lb-rank { color: inherit; }
  .lb-list li.lb-gap { display: block; text-align: center; color: var(--lb-muted, #999); background: none; padding: 0; }
  .lb-msg { margin: 10px 0 0; min-height: 1.2em; text-align: center; font-size: 13px; color: var(--lb-muted, #999); }
  .lb-msg:empty { display: none; }
  .lb-board .lb-primary { width: 100%; margin-top: 14px; }
  `;

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'lb';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'lb-title');
    root.innerHTML = `
      <div class="lb-card">
        <h2 id="lb-title">High Scores</h2>
        <form class="lb-entry" novalidate>
          <p class="lb-final">Your score <b></b></p>
          <label for="lb-name">Your name for the board</label>
          <input id="lb-name" name="name" maxlength="12" autocomplete="nickname" autocapitalize="characters"
            spellcheck="false" enterkeyhint="done">
          <div class="lb-row">
            <button type="submit" class="lb-primary">Save score</button>
            <button type="button" class="lb-secondary lb-skip">Skip</button>
          </div>
          <p class="lb-msg lb-entry-msg" role="status"></p>
        </form>
        <div class="lb-board">
          <div class="lb-tabs" role="tablist">
            <button type="button" role="tab" data-period="all">All Time</button>
            <button type="button" role="tab" data-period="week">This Week</button>
          </div>
          <ol class="lb-list" aria-live="polite"></ol>
          <p class="lb-msg lb-board-msg" role="status"></p>
          <button type="button" class="lb-primary lb-close">Play again</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    for (const [k, sel] of Object.entries({
      entry: '.lb-entry', final: '.lb-final b', name: '#lb-name', save: '.lb-entry .lb-primary',
      skip: '.lb-skip', entryMsg: '.lb-entry-msg', board: '.lb-board', list: '.lb-list',
      boardMsg: '.lb-board-msg', close: '.lb-close',
    })) el[k] = root.querySelector(sel);
    el.tabs = [...root.querySelectorAll('.lb-tabs button')];

    el.entry.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    el.skip.addEventListener('click', () => showBoard());
    el.close.addEventListener('click', close);
    el.tabs.forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; load(); }));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!el.entry.hidden) showBoard(); else close(); }
      else if (el.entry.hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        period = period === 'all' ? 'week' : 'all';
        load();
        el.tabs.find((b) => b.dataset.period === period).focus();
      }
    });
    // keep the game from reacting to anything typed or tapped while the board is up
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  async function submit() {
    const name = el.name.value.trim().replace(/\s+/g, ' ');
    if (!name) { el.entryMsg.textContent = 'Type a name first.'; el.name.focus(); return; }
    el.save.disabled = el.skip.disabled = true;
    el.entryMsg.textContent = 'Saving…';
    try {
      const row = await call('submit_score', { p_game: GAME, p_name: name, p_score: el.score });
      saveName(name);
      mine = row;
      showBoard();
    } catch (err) {
      el.entryMsg.textContent = `Your score didn't save. ${err.message === 'Failed to fetch' || err.name === 'AbortError'
        ? 'Check your connection and try again.' : err.message}`;
    } finally {
      el.save.disabled = el.skip.disabled = false;
    }
  }

  function showBoard() {
    el.entry.hidden = true;
    el.board.hidden = false;
    load();
    el.close.focus();
  }

  function row(entry, rank) {
    const li = document.createElement('li');
    if (mine && entry.id === mine.id) li.className = 'lb-mine';
    for (const [cls, text] of [['lb-rank', `${rank}.`], ['lb-name', entry.name], ['lb-score', String(entry.score)]]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      li.appendChild(span);
    }
    return li;
  }

  let loading = 0;
  async function load() {
    const ask = ++loading, which = period;
    el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.period === which)));
    el.list.replaceChildren();
    el.boardMsg.textContent = 'Loading…';
    let rows;
    try {
      rows = await call('get_leaderboard', { p_game: GAME, p_period: which, p_limit: SHOW });
    } catch (err) {
      if (ask === loading) el.boardMsg.textContent = "Couldn't reach the scoreboard. Check your connection and try again.";
      return;
    }
    if (ask !== loading) return;
    el.boardMsg.textContent = note || (rows.length ? '' : (which === 'week' ? 'No scores yet this week.' : 'No scores yet.'));
    rows.forEach((r) => el.list.appendChild(row(r, r.rank)));
    const myRank = mine && (which === 'week' ? mine.week_rank : mine.all_rank);
    if (myRank > rows.length && rows.length >= SHOW) {
      const gap = document.createElement('li');
      gap.className = 'lb-gap';
      gap.textContent = '⋯';
      el.list.appendChild(gap);
      el.list.appendChild(row(mine, myRank));
    }
    if (mine && myRank) el.boardMsg.textContent = `You're #${myRank} ${which === 'week' ? 'this week' : 'of all time'}.`;
  }

  function close() {
    if (!open) return;
    open = false;
    root.hidden = true;
    const done = onClose;
    onClose = null;
    if (done) done();
  }

  return {
    open({ score = 0, cheated = false, onClose: then = null, closeLabel = 'Play again' } = {}) {
      if (!root) build();
      open = true;
      onClose = then;
      mine = null;
      note = score > 0 && cheated ? "Scores from a game with cheats on don't go on the board." : '';
      period = 'all';
      el.score = score;
      el.close.textContent = closeLabel;
      el.entryMsg.textContent = '';
      root.hidden = false;
      if (score > 0 && !cheated) {
        el.entry.hidden = false;
        el.board.hidden = true;
        el.final.textContent = String(score);
        el.name.value = savedName().slice(0, 12);
        el.name.focus();
        el.name.select();
      } else {
        showBoard();
      }
    },
    isOpen: () => open,
    // the top score, for a title screen
    best: () => call('get_leaderboard', { p_game: GAME, p_period: 'all', p_limit: 1 }).then((r) => r[0] || null),
  };
})();
