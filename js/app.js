/* Lehrgang Wissenschaftliches Schreiben – interaktive Version
   Statische Seite, Daten in content.js, Antworten im localStorage. */
(() => {
'use strict';

const D = window.LEHRGANG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripTags = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
const fx = h => String(h).replace(/<sup class="fn"/g, '<sup class="fn" tabindex="0" role="button" title="Fussnote anzeigen"');
const SA_LABEL = { ja: 'ja', teils: 'teilweise', nein: 'noch nicht' };
const STATUS_LABEL = { offen: 'offen', verbessern: 'verbessern', teilweise: 'teilweise', sicher: 'sicher' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/* ---------- Index über alle Inhalte ---------- */
const EXERCISES = [];   // {ex, ch}
const QUESTIONS = {};   // id -> {q, ex, ch, idx}
D.chapters.forEach(ch => ch.blocks.forEach(b => {
  if (b.type !== 'exercise') return;
  EXERCISES.push({ ex: b, ch });
  b.questions.forEach((q, idx) => { QUESTIONS[q.id] = { q, ex: b, ch, idx }; });
}));

/* ---------- Speicher (localStorage, mit Fallback im Arbeitsspeicher) ---------- */
const PREFIX = 'nksa-wiss-schreiben:v1:';
const NAME_KEY = '_name';
let storageOK = true;
try { localStorage.setItem(PREFIX + '_t', '1'); localStorage.removeItem(PREFIX + '_t'); } catch (e) { storageOK = false; }
const mem = new Map();
const Store = {
  get(id) {
    try {
      const raw = storageOK ? localStorage.getItem(PREFIX + id) : mem.get(id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  put(id, obj) {
    const raw = JSON.stringify(obj);
    try { storageOK ? localStorage.setItem(PREFIX + id, raw) : mem.set(id, raw); }
    catch (e) { alert('Die Antwort konnte nicht gespeichert werden (Speicher voll oder gesperrt).'); }
  },
  del(id) { storageOK ? localStorage.removeItem(PREFIX + id) : mem.delete(id); },
  keys() {
    const all = storageOK ? Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)) : Array.from(mem.keys());
    return all.filter(k => !k.startsWith('_'));
  },
  update(id, fn) {
    const st = this.get(id) || {};
    fn(st);
    const empty = !('v' in st) && !st.sa && !st.shown && !Object.keys(st.chk || {}).length && !Object.keys(st.rs || {}).length;
    empty ? this.del(id) : this.put(id, st);
    return empty ? null : st;
  },
  clearAll() { this.keys().forEach(k => this.del(k)); },
  getName() { return (storageOK ? localStorage.getItem(PREFIX + NAME_KEY) : mem.get(NAME_KEY)) || ''; },
  setName(n) { storageOK ? localStorage.setItem(PREFIX + NAME_KEY, n) : mem.set(NAME_KEY, n); }
};

/* ---------- Antwort- und Statuslogik ---------- */
const choiceCorrect = q => Array.isArray(q.solution) ? q.solution : (q.solution && q.solution.correct) || null;
const autoCheck = q => (q.type === 'choice' && !!choiceCorrect(q)) || (q.type === 'yesno' && !!q.solution);
const hasSolution = q => q.solution !== null && q.solution !== undefined && q.solution !== false;

function hasAnswer(q, st) {
  const v = st && st.v;
  if (v === undefined || v === null) return false;
  switch (q.type) {
    case 'text': return v.trim() !== '';
    case 'choice': return v.length > 0;
    case 'yesno': return Object.values(v).some(r => r.a || (r.b && r.b.trim()));
    case 'rank': return Array.isArray(v) && v.length > 0;
    case 'mark': return v.length > 0;
    case 'matrix': return Object.values(v.cells || {}).some(Boolean);
    case 'words': return Object.values(v).some(w => (w.n || '').trim() || (w.s || '').trim());
    case 'done': return !!(v.done || (v.note || '').trim());
  }
  return false;
}

const rowIds = q => (q.type === 'choice' ? q.items : q.rows).map(r => r.id);
const chkOf = st => (st && st.chk) || {};
const allChecked = (q, st) => rowIds(q).every(id => id in chkOf(st));
const rowIsRight = (q, st, id) => {
  if (q.type === 'choice') return choiceCorrect(q).includes(id) === new Set((st && st.v) || []).has(id);
  const r = q.rows.find(x => x.id === id);
  return (((st && st.v) || {})[id] || {}).a === r.solution;
};
// Antwort im Sinn der Bewertung (Begründungen bei Ja/Nein zählen nicht)
function scorable(q, st) {
  if (q.type === 'yesno') return !!st && !!st.v && Object.values(st.v).some(r => r.a);
  if (q.type === 'choice' && autoCheck(q)) return hasAnswer(q, st) || Object.keys(chkOf(st)).length > 0;
  return hasAnswer(q, st);
}

function evalCheck(q, st) {
  const res = {}; let wrong = 0;
  if (q.type === 'choice') {
    const sel = new Set(st.v || []);
    q.items.forEach(it => { const good = choiceCorrect(q).includes(it.id) === sel.has(it.id); res[it.id] = good; if (!good) wrong++; });
  } else {
    q.rows.forEach(r => { const a = ((st.v || {})[r.id] || {}).a; const good = a === r.solution; res[r.id] = good; if (!good) wrong++; });
  }
  return { ok: wrong === 0, wrong, res };
}

// offen / verbessern (Antwort vorhanden, aber nicht als «ja»/«teilweise» eingeschätzt, «noch nicht» oder Fehler) / teilweise / sicher
function qStatus(q) {
  const st = Store.get(q.id);
  if (!st || !scorable(q, st)) return 'offen';
  if (q.type === 'done') return st.v.done ? 'sicher' : 'teilweise';
  if (!hasSolution(q)) return 'teilweise';
  if (autoCheck(q)) return allChecked(q, st) && rowIds(q).every(id => chkOf(st)[id] === 1) ? 'sicher' : 'verbessern';
  if (st.sa === 'ja') return 'sicher';
  if (st.sa === 'teils') return 'teilweise';
  return 'verbessern';
}

function exStatus(ex) {
  const s = ex.questions.map(qStatus);
  if (s.every(x => x === 'offen')) return 'offen';
  if (s.every(x => x === 'sicher')) return 'sicher';
  if (s.includes('verbessern')) return 'verbessern';
  return 'teilweise';
}

/* ---------- Eingabe-Widgets: HTML ---------- */
function rankOrder(q, st) {
  const ids = q.items.map(i => i.id);
  const saved = st && Array.isArray(st.v) ? st.v.filter(id => ids.includes(id)) : [];
  return saved.concat(ids.filter(id => !saved.includes(id)));
}
const CELL = {
  '': { sym: '', cls: '0', label: 'offen' }, '+': { sym: '✓', cls: 'p', label: 'erfüllt' },
  '~': { sym: '~', cls: 't', label: 'teilweise' }, '-': { sym: '✗', cls: 'm', label: 'nicht erfüllt' }
};
const CELL_NEXT = { '': '+', '+': '~', '~': '-', '-': '' };
const item = (q, id) => q.items.find(i => i.id === id);

const mkKey = q => '_mk:' + q.markers.map(m => m.id).join(',');
function activeMarker(q) {
  const st = Store.get(mkKey(q));
  return st && q.markers.some(m => m.id === st.m) ? st.m : '';
}
function setActiveMarker(q, id) { id ? Store.put(mkKey(q), { m: id }) : Store.del(mkKey(q)); }

function markBase(q) {
  return q.paras.map(p => {
    const tag = p.kind === 'h' ? 'h4' : p.kind === 'h2' ? 'h5' : 'p';
    return `<${tag}>${fx(p.html)}</${tag}>`;
  }).join('');
}

// Zeilenlösung (nur bei prüfbaren Aufgaben): Knopf unterhalb der Zeile, Text darunter
function rowSolutionHTML(q, id) {
  if (q.type === 'choice') {
    const right = choiceCorrect(q).includes(id), notes = Array.isArray(q.solution) ? {} : (q.solution.notes || {});
    return `<b>${esc(right ? q.yes : q.no)}</b>${notes[id] ? ' – ' + fx(notes[id]) : ''}`;
  }
  const r = q.rows.find(x => x.id === id);
  return `<b>${r.solution === 'ja' ? 'Ja, belegen' : 'Nein, kein Beleg nötig'}</b>${r.note ? ' – ' + fx(r.note) : ''}`;
}
function rowFoot(q, st, id) {
  const open = (q.type === 'yesno' && st && st.shown) || (st && st.rs && st.rs[id]);
  return `<div class="row-foot"><button type="button" class="link-btn" data-act="row-show" data-row="${id}" aria-expanded="${!!open}">${open ? '▾ Musterlösung verbergen' : '▸ Musterlösung'}</button>
    ${open ? `<div class="row-sol">${rowSolutionHTML(q, id)}</div>` : ''}</div>`;
}

const Widgets = {
  text(q, st) {
    const v = st && st.v || '';
    const start = q.start ? `<span class="ta-start">${fx(q.start)}</span>` : '';
    const crit = q.criteria ? `<ul class="criteria">${q.criteria.map(c => `<li>${c}</li>`).join('')}</ul>` : '';
    return `${crit}<label class="ta-wrap">${start}<textarea class="ta" data-role="text" rows="${q.rows || 5}" placeholder="Ihre Antwort …">${esc(v)}</textarea></label>`;
  },

  choice(q, st) {
    const sel = new Set(st && st.v || []);
    const auto = autoCheck(q), chk = chkOf(st);
    return `<div class="choice">${q.items.map(it => {
      const res = chk[it.id] === 1 ? 'res-ok' : chk[it.id] === 0 ? 'res-bad' : '';
      return `<div class="crow ${res}" data-row="${it.id}">
        <div class="crow-main"><label class="opt"><input type="checkbox" data-role="choice" value="${it.id}" ${sel.has(it.id) ? 'checked' : ''}><span>${fx(it.html)}</span></label>
        ${auto ? `<button type="button" class="btn btn-row" data-act="row-check" data-row="${it.id}">Prüfen</button>` : ''}</div>
        ${auto ? rowFoot(q, st, it.id) : ''}
      </div>`;
    }).join('')}</div>`;
  },

  yesno(q, st) {
    const v = st && st.v || {};
    const chk = chkOf(st);
    return `<div class="yn">${q.rows.map(r => {
      const cur = v[r.id] || {};
      const res = chk[r.id] === 1 ? 'res-ok' : chk[r.id] === 0 ? 'res-bad' : '';
      return `<div class="yn-row ${res}" data-row="${r.id}">
        <div class="yn-s">${fx(r.html)}</div>
        <div class="yn-a" role="radiogroup">
          <label><input type="radio" name="${q.id}-${r.id}" data-role="yn-a" data-row="${r.id}" value="ja" ${cur.a === 'ja' ? 'checked' : ''}> Ja</label>
          <label><input type="radio" name="${q.id}-${r.id}" data-role="yn-a" data-row="${r.id}" value="nein" ${cur.a === 'nein' ? 'checked' : ''}> Nein</label>
          <button type="button" class="btn btn-row" data-act="row-check" data-row="${r.id}">Prüfen</button>
        </div>
        <textarea class="yn-b" rows="2" data-role="yn-b" data-row="${r.id}" placeholder="Begründung (optional, wird nicht bewertet)">${esc(cur.b || '')}</textarea>
        ${rowFoot(q, st, r.id)}
      </div>`;
    }).join('')}</div>`;
  },

  rank(q, st) {
    const order = rankOrder(q, st);
    return `<div class="rank-wrap">
      <div class="rank-end">▲ ${esc(q.high)}</div>
      <ol class="rank" data-rank="${q.id}">${order.map(id => `<li draggable="true" data-id="${id}">
        <span class="grip" aria-hidden="true">⋮⋮</span><span class="rk-t">${fx(item(q, id).html)}</span>
        <span class="rk-btns"><button type="button" class="icon-btn" data-act="rk-up" aria-label="nach oben">↑</button><button type="button" class="icon-btn" data-act="rk-down" aria-label="nach unten">↓</button></span>
      </li>`).join('')}</ol>
      <div class="rank-end">▼ ${esc(q.low)}</div>
      <p class="hint">Ziehen Sie die Einträge in die gewünschte Reihenfolge oder nutzen Sie die Pfeiltasten-Buttons.</p>
    </div>`;
  },

  mark(q, st) {
    const active = activeMarker(q);
    const bar = q.markers.map(m => `<button type="button" class="mk-btn ${m.cls} ${active === m.id ? 'on' : ''}" data-act="mk" data-marker="${m.id}" aria-pressed="${active === m.id}"><span class="sw"></span>${esc(m.label)}</button>`).join('') +
      `<button type="button" class="mk-btn mk-erase" data-act="mk" data-marker="">Markierung entfernen</button>`;
    const fns = q.footnotes ? `<details class="fn-list" open><summary>Fussnoten</summary><ol>${q.footnotes.map(n => `<li value="${n}">${fx(D.footnotes[n] || '')}</li>`).join('')}</ol></details>` : '';
    return `<div class="mk-bar" role="toolbar" aria-label="Textmarker">${bar}</div>
      <div class="mk-text" data-role="mk" tabindex="0">${markBase(q)}</div>
      <p class="hint">Text auswählen und eine Farbe anklicken. Die zuletzt benutzte Farbe bleibt aktiv: Neue Auswahlen (mit der Maus) werden sofort so markiert. Ein erneuter Klick auf die aktive Farbe schaltet sie ab.</p>
      ${q.source ? `<p class="source">${q.source}</p>` : ''}${fns}`;
  },

  matrix(q, st) {
    const cells = (st && st.v && st.v.cells) || {};
    return `<div class="mx-scroll"><table class="mx"><thead><tr><th></th>${q.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${q.rows.map(r => `<tr><th scope="row">${r.html}</th>${q.cols.map((c, ci) => {
        const v = cells[r.id + '|' + ci] || '';
        return `<td><button type="button" class="cell c${CELL[v].cls}" data-act="cell" data-row="${r.id}" data-col="${ci}" aria-label="${esc(c)}: ${CELL[v].label}">${CELL[v].sym}</button></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">Klick wechselt: leer → ✓ erfüllt → ~ teilweise → ✗ nicht erfüllt → leer. Sie müssen nicht alle Texte einschätzen.</p>`;
  },

  words(q, st) {
    const v = st && st.v || {};
    return `<table class="wd"><thead><tr><th>Wort</th><th>Nomen</th><th>Satz mit dem Nomen</th></tr></thead><tbody>
      ${q.words.map(w => { const c = v[w.id] || {}; return `<tr><th scope="row">${w.html}</th>
        <td><input type="text" data-role="word-n" data-row="${w.id}" value="${esc(c.n || '')}"></td>
        <td><input type="text" data-role="word-s" data-row="${w.id}" value="${esc(c.s || '')}"></td></tr>`; }).join('')}
    </tbody></table>`;
  },

  done(q, st) {
    const v = st && st.v || {};
    return `<label class="opt done"><input type="checkbox" data-role="done" ${v.done ? 'checked' : ''}><span>Erledigt</span></label>
      <label class="ta-wrap"><span class="ta-start">Notizen (optional)</span><textarea class="ta" data-role="done-note" rows="3">${esc(v.note || '')}</textarea></label>`;
  }
};

/* ---------- Musterlösung ---------- */
function solutionHTML(q, st) {
  const s = q.solution;
  if (typeof s === 'string') return `<div class="sol-body">${fx(s)}</div>`;
  switch (q.type) {
    case 'mark': return `<div class="sol-body mk-text mk-sol">${markBase(Object.assign({}, q, { paras: s.paras }))}</div>${s.legend ? `<p class="legend-note">${s.legend}</p>` : ''}`;
    case 'choice': {
      const correct = Array.isArray(s) ? s : s.correct, notes = Array.isArray(s) ? {} : (s.notes || {});
      const li = i => `<li>${fx(i.html)}${notes[i.id] ? ` <em class="why">${fx(notes[i.id])}</em>` : ''}</li>`;
      return `<p>Richtig sind:</p><ul class="sol-list">${q.items.filter(i => correct.includes(i.id)).map(li).join('')}</ul>
        <details class="sol-more"><summary>Nicht richtig, mit Begründung</summary><ul class="sol-list">${q.items.filter(i => !correct.includes(i.id)).map(li).join('')}</ul></details>`;
    }
    case 'matrix': {
      const mine = (st && st.v && st.v.cells) || {};
      const rel = (a, b) => !b ? '' : a === b ? 'hit' : (a === '~' || b === '~') ? 'near' : 'miss';
      return `<div class="mx-scroll"><table class="mx mx-sol"><thead><tr><th></th>${q.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${q.rows.map(r => `<tr><th scope="row">${r.html}</th>${q.cols.map((c, ci) => {
          const exp = s.cells[r.id][ci], my = mine[r.id + '|' + ci] || '';
          return `<td class="${rel(exp, my)}">${CELL[exp].sym}${my && my !== exp ? `<small class="mine">Sie: ${CELL[my].sym}</small>` : ''}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        <ul class="sol-list">${s.comments.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
        <p class="legend-note">${esc(s.note)}</p>
        <p class="legend-note">Grün: gleich eingeschätzt; gelb: eine Stufe daneben (oft vertretbar).</p>`;
    }
    case 'yesno': return '<p>Die Lösung steht bei den einzelnen Aussagen.</p>';
    case 'rank': {
      const mine = rankOrder(q, st);
      const best = s.order.slice().reverse();
      return `<p class="legend-note">Reihenfolge von «${esc(q.high)}» (oben) bis «${esc(q.low)}» (unten).</p>
        <ol class="sol-rank">${best.map((o, i) => {
          const pos = st && Array.isArray(st.v) ? mine.indexOf(o.id) + 1 : 0;
          return `<li>${fx(item(q, o.id).html)}${o.note ? ` <em>(${esc(o.note)})</em>` : ''}${pos ? ` <span class="mypos">Ihre Position: ${pos}</span>` : ''}</li>`;
        }).join('')}</ol>`;
    }
  }
  return '';
}

/* ---------- Frage-Rendering ---------- */
function badgeFor(q, idx, total) {
  if (q.label && q.label.length <= 3) return q.label;
  return total > 1 ? String.fromCharCode(97 + idx) : '';
}

function pillFor(q, st) {
  if (!st) return null;
  if (autoCheck(q)) {
    const c = chkOf(st), n = Object.keys(c).length;
    if (n && n === rowIds(q).length) {
      const wrong = Object.values(c).filter(x => x === 0).length;
      return wrong ? ['bad', `Geprüft: ${wrong} ${wrong === 1 ? 'Fehler' : 'Fehler'}`] : ['ok', 'Geprüft: alles richtig'];
    }
    if (n) return ['neu', `${n} von ${rowIds(q).length} Zeilen geprüft`];
  }
  if (st.sa) return [{ ja: 'ok', teils: 'mid', nein: 'bad' }[st.sa], 'Einschätzung: ' + SA_LABEL[st.sa]];
  if (q.type === 'done' && st.v && st.v.done) return ['ok', 'Erledigt'];
  return null;
}

function actionsHTML(q, st) {
  const btns = [];
  if (autoCheck(q)) {
    const done = allChecked(q, st);
    btns.push(`<button type="button" class="btn" data-act="check" ${done ? 'disabled title="Alle Zeilen sind bereits einzeln geprüft"' : ''}>Alle prüfen</button>`);
  }
  if (hasSolution(q)) btns.push(`<button type="button" class="btn ${st && st.shown ? 'btn-on' : 'btn-soft'}" data-act="${st && st.shown ? 'hide' : 'show'}">${q.type === 'yesno' ? 'Alle Musterlösungen' : 'Musterlösung'} ${st && st.shown ? 'verbergen' : 'anzeigen'}</button>`);
  else if (q.type !== 'done') btns.push('<span class="muted">Musterlösung folgt.</span>');
  if (st) btns.push('<button type="button" class="btn btn-ghost" data-act="del">Löschen</button>');
  const pill = pillFor(q, st);
  return `<div class="q-actions">${btns.join('')}<span class="pill ${pill ? 'pill-' + pill[0] : ''}" data-role="pill">${pill ? pill[1] : ''}</span></div>`;
}

function solutionPanel(q, st) {
  if (!st || !st.shown || !hasSolution(q) || q.type === 'yesno') return '';
  let assess = '';
  if (!autoCheck(q) && q.type !== 'done') {
    const can = hasAnswer(q, st);
    assess = `<div class="selfassess"><b>Meine Antwort enthält das Wesentliche:</b>
      ${['ja', 'teils', 'nein'].map(k => `<button type="button" class="chip ${st.sa === k ? 'chip-' + k : ''}" data-act="sa" data-val="${k}" ${can ? '' : 'disabled'}>${SA_LABEL[k]}</button>`).join('')}
      ${can ? '' : '<span class="muted small">Zuerst eine Antwort eingeben.</span>'}</div>`;
  }
  return `<div class="solution"><div class="sol-label">Musterlösung</div>${solutionHTML(q, st)}${assess}</div>`;
}

function renderQuestion(info) {
  const { q, ex, idx } = info;
  const st = Store.get(q.id);
  const total = ex.questions.length;
  const badge = badgeFor(q, idx, total);
  const longLabel = q.label && q.label.length > 3 ? q.label : '';
  const head = (badge || longLabel) ? `<div class="q-head">${badge ? `<span class="badge">${esc(badge)}</span>` : ''}${longLabel ? `<h3 class="q-title">${esc(longLabel)}</h3>` : ''}</div>` : '';
  const prompt = q.prompt ? `<p class="q-prompt">${fx(q.prompt)}</p>` : '';
  const given = q.given ? `<blockquote class="given">${fx(q.given)}</blockquote>` : '';
  return `<section class="q q-${q.type}" id="q-${q.id}" data-q="${q.id}">
    ${head}${prompt}${given}${q.ask ? `<p class="q-ask">${fx(q.ask)}</p>` : ''}
    ${Widgets[q.type](q, st)}
    ${actionsHTML(q, st)}
    ${solutionPanel(q, st)}
  </section>`;
}

function postRender(root) {
  $$('.q-mark', root).forEach(el => applyMarks(el));
}

function applyMarks(qEl) {
  const q = QUESTIONS[qEl.dataset.q].q;
  const box = $('.mk-text[data-role="mk"]', qEl);
  const st = Store.get(q.id);
  box.innerHTML = markBase(q);
  const cls = Object.fromEntries(q.markers.map(m => [m.id, m.cls]));
  ((st && st.v) || []).forEach(m => wrapRange(box, m.s, m.e, cls[m.m]));
}

function wrapRange(root, s, e, cls) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; let pos = 0;
  for (let n; (n = tw.nextNode());) {
    const len = n.nodeValue.length;
    if (pos + len > s && pos < e) nodes.push([n, pos]);
    pos += len; if (pos >= e) break;
  }
  nodes.forEach(([n, p]) => {
    const a = Math.max(s - p, 0), b = Math.min(e - p, n.nodeValue.length);
    let mid = n;
    if (a > 0) mid = n.splitText(a);
    if (b - a < mid.nodeValue.length) mid.splitText(b - a);
    const m = document.createElement('mark'); m.className = cls;
    mid.parentNode.insertBefore(m, mid); m.appendChild(mid);
  });
}

function rerenderQuestion(id) {
  const el = $(`[data-q="${CSS.escape(id)}"]`);
  if (!el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderQuestion(QUESTIONS[id]);
  const fresh = tmp.firstElementChild;
  el.replaceWith(fresh);
  postRender(fresh.parentNode);
  onChange();
}

/* ---------- Seiten ---------- */
function blockHTML(b) {
  switch (b.type) {
    case 'p': return `<p>${fx(b.html)}</p>`;
    case 'h': return `<h${b.level || 4}>${b.html}</h${b.level || 4}>`;
    case 'ul': return `<ul>${b.items.map(i => `<li>${fx(i)}</li>`).join('')}</ul>`;
    case 'passage': return `<figure class="passage">${b.label ? `<figcaption>${b.label}</figcaption>` : ''}${(b.paras || []).map(p => `<p>${fx(p)}</p>`).join('')}${b.source ? `<p class="source">${b.source}</p>` : ''}</figure>`;
    case 'sources': return `<div class="sources"><b>${b.title}</b><ul>${b.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
    case 'intro': return `<section class="intro">${b.blocks.map(blockHTML).join('')}</section>`;
    case 'theory': return `<aside class="merke" id="th-${b.id}" data-anchor="th-${b.id}" aria-label="Merke: ${esc(b.title)}"><div class="merke-head"><span class="merke-tag">Merke:</span><h2>${esc(b.title)}</h2></div><div class="merke-body">${b.blocks.map(blockHTML).join('')}</div></aside>`;
    case 'exercise': return `<section class="ex" id="ex-${b.id}" data-anchor="ex-${b.id}" data-ex="${b.id}">
      <header class="ex-head"><span class="ex-no">${b.no}</span><h2>${esc(b.title)}</h2><span class="ex-status" data-exs="${b.id}"></span></header>
      ${b.task ? `<p class="task">${fx(b.task)}</p>` : ''}
      ${(b.blocks || []).map(blockHTML).join('')}
      ${b.questions.map(q => renderQuestion(QUESTIONS[q.id])).join('')}
    </section>`;
  }
  return '';
}

function legendHTML() {
  return `<ul class="legend" aria-label="Legende"><li><i class="lg lg-offen"></i>offen</li><li><i class="lg lg-verbessern"></i>verbessern</li><li><i class="lg lg-teilweise"></i>teilweise</li><li><i class="lg lg-sicher"></i>sicher</li></ul>`;
}

function progressCounts() {
  const c = { offen: 0, verbessern: 0, teilweise: 0, sicher: 0 };
  EXERCISES.forEach(({ ex }) => c[exStatus(ex)]++);
  return c;
}

function renderStart() {
  const cards = D.chapters.map((ch, i) => {
    const exs = EXERCISES.filter(e => e.ch === ch);
    return `<a class="card" href="#/${ch.id}"><span class="card-no">${ROMAN[i]}</span><span class="card-t">${esc(ch.title)}</span><span class="card-s" data-chprog="${ch.id}">${exs.length} Übungen</span></a>`;
  }).join('');
  return `<article class="page start">
    <p class="eyebrow">Neue Kantonsschule Aarau</p>
    <h1>${esc(D.meta.title)}</h1>
    <p class="lead">Interaktive Fassung des Lehrgangs «${esc(D.meta.subtitle)}». Die Texte und Aufgaben stammen unverändert aus dem Lehrgangsdokument.</p>
    <div class="cards">${cards}</div>
    <h2>So arbeiten Sie mit dem Lehrgang</h2>
    <ul class="howto">
      <li>Lesen Sie die Theorie und bearbeiten Sie die Aufgaben direkt auf der Seite. Die Antworten werden laufend gespeichert.</li>
      <li>Mit «Musterlösung anzeigen» vergleichen Sie Ihre Antwort. Bei freien Aufgaben schätzen Sie danach selbst ein, ob Ihre Antwort das Wesentliche enthält. Bei Auswahlaufgaben mit hinterlegter Lösung zeigt «Prüfen», was stimmt.</li>
      <li>In der Navigation sehen Sie Ihren Lernfortschritt:</li>
    </ul>
    ${legendHTML()}
    <p class="small muted">Ihre Antworten werden nur in diesem Browser auf diesem Gerät gespeichert (localStorage) und nirgends hochgeladen. Wenn Sie die Website-Daten des Browsers löschen, sind sie weg. Für die Abgabe nutzen Sie die <a href="#/zusammenfassung">Zusammenfassung</a> (drucken oder kopieren). Jede Antwort lässt sich einzeln oder alle gemeinsam wieder löschen.</p>
    ${storageOK ? '' : '<p class="warnbox">Der Browser blockiert den Speicher: Antworten gehen beim Schliessen der Seite verloren.</p>'}
  </article>`;
}

function renderChapter(ch) {
  const idx = D.chapters.indexOf(ch), no = ROMAN[idx], next = D.chapters[idx + 1];
  const nextBtn = next
    ? `<a class="btn btn-next" href="#/${next.id}"><span class="bn-k">Weiter zu Kapitel ${ROMAN[idx + 1]}</span><span class="bn-t">${esc(next.title)} →</span></a>`
    : `<a class="btn btn-next" href="#/zusammenfassung"><span class="bn-k">Kapitel abgeschlossen</span><span class="bn-t">Zu «Meine Antworten» →</span></a>`;
  return `<article class="page" data-chapter="${ch.id}"><p class="eyebrow">Kapitel ${no}</p><h1>${esc(ch.title)}</h1>${ch.blocks.map(blockHTML).join('')}<nav class="chapter-end" aria-label="Weiter">${nextBtn}</nav></article>`;
}

/* ---------- Zusammenfassung ---------- */
function plainAnswer(q, st) {
  const v = st.v;
  switch (q.type) {
    case 'text': return (q.start ? stripTags(q.start) + ' ' : '') + v;
    case 'choice': return q.items.filter(i => v.includes(i.id)).map(i => '• ' + stripTags(i.html)).join('\n');
    case 'yesno': return q.rows.filter(r => v[r.id] && (v[r.id].a || v[r.id].b)).map(r => `• ${stripTags(r.html)} → ${v[r.id].a === 'ja' ? 'Ja' : v[r.id].a === 'nein' ? 'Nein' : '–'}${v[r.id].b ? ' (' + v[r.id].b + ')' : ''}`).join('\n');
    case 'rank': return rankOrder(q, st).map((id, i) => `${i + 1}. ${stripTags(item(q, id).html)}`).join('\n');
    case 'mark': {
      const base = document.createElement('div'); base.innerHTML = markBase(q);
      const full = base.textContent;
      return v.map(m => `[${(q.markers.find(x => x.id === m.m) || {}).label}] «${full.slice(m.s, m.e)}»`).join('\n');
    }
    case 'matrix': {
      const cells = v.cells || {};
      return q.rows.map(r => `• ${stripTags(r.html)}: ` + q.cols.map((c, ci) => `${c} ${CELL[cells[r.id + '|' + ci] || ''].sym || '–'}`).join(', ')).join('\n');
    }
    case 'words': return q.words.filter(w => v[w.id] && ((v[w.id].n || '').trim() || (v[w.id].s || '').trim())).map(w => `• ${stripTags(w.html)} → ${v[w.id].n || '–'}: ${v[w.id].s || '–'}`).join('\n');
    case 'done': return (v.done ? 'Erledigt' : 'Nicht erledigt') + (v.note ? '\n' + v.note : '');
  }
  return '';
}

function questionTitle(info) {
  const { q, ex, idx } = info;
  const b = badgeFor(q, idx, ex.questions.length);
  const t = [b ? b + ')' : '', q.label && q.label.length > 3 ? q.label : ''].filter(Boolean).join(' ');
  const ctx = q.given ? stripTags(q.given) : q.prompt ? stripTags(q.prompt) : '';
  return [t, ctx.length > 140 ? ctx.slice(0, 140) + ' …' : ctx].filter(Boolean).join(' – ');
}

function summaryData() {
  const out = [];
  D.chapters.forEach(ch => {
    EXERCISES.filter(e => e.ch === ch).forEach(({ ex }) => {
      const items = ex.questions.map(q => ({ info: QUESTIONS[q.id], st: Store.get(q.id) })).filter(x => x.st && hasAnswer(x.info.q, x.st));
      if (items.length) out.push({ ex, items });
    });
  });
  return out;
}

function summaryStatusText(q, st) {
  const p = pillFor(q, st);
  return p ? p[1] : 'noch nicht eingeschätzt';
}

function summaryText() {
  const lines = [`${D.meta.title} – Meine Antworten`, `Name: ${Store.getName() || '–'}`, `Datum: ${new Date().toLocaleDateString('de-CH')}`, ''];
  summaryData().forEach(({ ex, items }) => {
    lines.push(`Übung ${ex.no}: ${ex.title}`);
    items.forEach(({ info, st }) => {
      lines.push('  ' + questionTitle(info));
      plainAnswer(info.q, st).split('\n').forEach(l => lines.push('    ' + l));
      lines.push(`    [${summaryStatusText(info.q, st)}]`);
    });
    lines.push('');
  });
  return lines.join('\n');
}

function renderSummary() {
  const data = summaryData();
  const body = data.length ? data.map(({ ex, items }) => `<section class="sum-ex"><h2><span class="ex-no">${ex.no}</span>${esc(ex.title)}</h2>
    ${items.map(({ info, st }) => `<div class="sum-q"><div class="sum-t">${esc(questionTitle(info))}</div><div class="sum-a">${esc(plainAnswer(info.q, st))}</div><div class="sum-s">${esc(summaryStatusText(info.q, st))}</div></div>`).join('')}</section>`).join('')
    : '<p class="muted">Noch keine Antworten vorhanden.</p>';
  return `<article class="page summary">
    <p class="eyebrow">Zusammenfassung</p><h1>Meine Antworten</h1>
    <div class="sum-bar no-print">
      <label>Name (für den Ausdruck) <input type="text" id="sumName" value="${esc(Store.getName())}"></label>
      <button type="button" class="btn" data-act="copy">Kopieren</button>
      <button type="button" class="btn" data-act="print">Drucken / als PDF</button>
      <button type="button" class="btn btn-danger" data-act="del-all">Alle Antworten löschen</button>
    </div>
    <p class="print-only sum-meta">Name: <span id="sumNameP">${esc(Store.getName() || '–')}</span> · Datum: ${new Date().toLocaleDateString('de-CH')}</p>
    ${body}
  </article>`;
}

/* ---------- Navigation ---------- */
function renderNav() {
  const nav = $('#nav');
  const sub = ex => ex.questions.length < 2 ? '' :
    `<span class="subdots" role="group" aria-label="Teilaufgaben">${ex.questions.map((q, i) =>
      `<a class="sub st-offen" href="#/${chapterOf(ex).id}/q-${q.id}" data-qid="${q.id}" title="Teilaufgabe ${esc(badgeFor(q, i, ex.questions.length) || i + 1)}">${esc(badgeFor(q, i, ex.questions.length) || i + 1)}</a>`).join('')}</span>`;
  nav.innerHTML = `<div class="nav-brand"><span class="brand-mark" aria-hidden="true"></span><div><div class="brand-t">${esc(D.meta.title)}</div><div class="brand-s">NKSA</div></div></div>
    <div class="nav-tools" role="group" aria-label="Antworten sichern">
      <button type="button" class="tool" data-act="export" title="Alle Antworten als Datei sichern">↓ Export</button>
      <button type="button" class="tool" data-act="import" title="Gesicherte Antworten wieder laden">↑ Import</button>
      <button type="button" class="tool" data-act="print" title="Zusammenfassung drucken oder als PDF speichern">⎙ Drucken</button>
    </div>
    <div class="nav-label">Inhalt</div>
    <ul class="nav-list">
      <li><a class="nav-top" href="#/start" data-route="start"><span class="dot">•</span>Start</a></li>
      ${D.chapters.map((ch, i) => `<li class="nav-chapter">
        <a class="nav-chap" href="#/${ch.id}" data-route="${ch.id}" aria-expanded="false"><span class="chap-no" aria-hidden="true">${ROMAN[i]}</span><span class="chap-t"><span class="chap-k">Kapitel ${ROMAN[i]}</span>${esc(ch.title)}</span><span class="chap-prog" data-chprog="${ch.id}"></span></a>
        <ul>${ch.blocks.filter(b => b.type === 'exercise').map(b =>
          `<li class="nav-exli"><a class="nav-ex" href="#/${ch.id}/ex-${b.id}" data-route="${ch.id}" data-anchor="ex-${b.id}" data-exn="${b.id}"><span class="circle">${b.no}</span><span class="nt">${esc(b.title)}</span></a>${sub(b)}</li>`).join('')}</ul>
      </li>`).join('')}
      <li><a class="nav-top" href="#/zusammenfassung" data-route="zusammenfassung"><span class="dot">•</span>Meine Antworten</a></li>
    </ul>
    <div class="nav-foot">
      <div class="meter" id="meter" aria-hidden="true"></div>
      ${legendHTML()}
      <button type="button" class="btn btn-ghost btn-sm" data-act="del-all">Alle Antworten löschen</button>
    </div>`;
}

function chapterOf(ex) { return EXERCISES.find(e => e.ex === ex).ch; }

function onChange() {
  EXERCISES.forEach(({ ex }) => {
    const s = exStatus(ex);
    const a = $(`.nav-ex[data-exn="${ex.id}"]`);
    if (a) a.className = 'nav-ex st-' + s + (a.classList.contains('active') ? ' active' : '');
    const h = $(`[data-exs="${ex.id}"]`);
    if (h) { h.className = 'ex-status st-' + s; h.textContent = s === 'offen' ? '' : STATUS_LABEL[s]; }
    ex.questions.forEach(q => {
      const sub = $(`.sub[data-qid="${CSS.escape(q.id)}"]`);
      if (sub) sub.className = 'sub st-' + qStatus(q);
    });
  });
  D.chapters.forEach(ch => {
    const exs = EXERCISES.filter(e => e.ch === ch);
    const done = exs.filter(e => exStatus(e.ex) === 'sicher').length;
    $$(`[data-chprog="${ch.id}"]`).forEach(el => { el.textContent = el.classList.contains('card-s') ? `${done} von ${exs.length} Übungen sicher` : `${done}/${exs.length}`; });
  });
  const c = progressCounts(), n = EXERCISES.length;
  const m = $('#meter');
  if (m) m.innerHTML = ['sicher', 'teilweise', 'verbessern'].map(k => `<span class="m-${k}" style="width:${(c[k] / n * 100).toFixed(1)}%"></span>`).join('');
}

/* ---------- Routing ---------- */
let currentRoute = null;
let printAfterRender = false;

function exportAnswers() {
  const answers = {};
  Store.keys().forEach(k => { answers[k] = Store.get(k); });
  const data = { app: 'nksa-wiss-schreiben', version: 1, exported: new Date().toISOString(), name: Store.getName(), answers };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `wiss-schreiben-antworten-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importAnswers(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { data = null; }
    if (!data || data.app !== 'nksa-wiss-schreiben' || typeof data.answers !== 'object') {
      alert('Diese Datei ist keine gültige Antwort-Datei dieses Lehrgangs.'); return;
    }
    const ids = Object.keys(data.answers).filter(id => QUESTIONS[id]);
    if (!ids.length) { alert('Die Datei enthält keine passenden Antworten.'); return; }
    if (!confirm(`${ids.length} Antworten aus der Datei laden? Vorhandene Antworten zu denselben Fragen werden überschrieben.`)) return;
    ids.forEach(id => Store.put(id, data.answers[id]));
    if (data.name && !Store.getName()) Store.setName(data.name);
    currentRoute = null; route();
  };
  reader.readAsText(file);
}

function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'start').split('/');
  let page = parts[0], anchor = parts[1] || '';
  if (!['start', 'zusammenfassung'].includes(page) && !D.chapters.some(c => c.id === page)) { page = 'start'; anchor = ''; }
  const main = $('#main');
  if (page !== currentRoute) {
    const ch = D.chapters.find(c => c.id === page);
    main.innerHTML = page === 'start' ? renderStart() : page === 'zusammenfassung' ? renderSummary() : renderChapter(ch);
    postRender(main);
    currentRoute = page;
    if (printAfterRender && page === 'zusammenfassung') { printAfterRender = false; setTimeout(() => window.print(), 250); }
    window.scrollTo(0, 0);
    observeSections();
  }
  $$('#nav a').forEach(a => a.classList.remove('current'));
  $$(`#nav [data-route="${page}"]`).forEach(a => { if (!a.dataset.anchor) a.classList.add('current'); });
  D.chapters.forEach(c => {
    const li = $(`.nav-chap[data-route="${c.id}"]`).closest('.nav-chapter');
    li.classList.toggle('open', c.id === page);
    $('.nav-chap', li).setAttribute('aria-expanded', String(c.id === page));
  });
  onChange();
  document.body.classList.remove('nav-open');
  $('#navToggle').setAttribute('aria-expanded', 'false');
  if (anchor) {
    const el = document.getElementById(anchor);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

let observer = null;
function observeSections() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      $$('#nav .active').forEach(a => a.classList.remove('active'));
      const a = $(`#nav [data-anchor="${en.target.dataset.anchor}"]`);
      if (a) a.classList.add('active');
    });
  }, { rootMargin: '-10% 0px -75% 0px' });
  $$('#main [data-anchor]').forEach(s => observer.observe(s));
}

/* ---------- Ereignisse ---------- */
function qInfo(el) {
  const qEl = el.closest('[data-q]');
  return qEl ? QUESTIONS[qEl.dataset.q] : null;
}

// Antwort ändern; ungültig gewordene Prüfung/Einschätzung zurücksetzen
// opts.row: nur diese Zeile verliert Prüfergebnis und Zeilenlösung; opts.keep: nichts zurücksetzen (z. B. optionale Begründungen)
function setValue(info, mutate, opts = {}) {
  const { q } = info;
  Store.update(q.id, s => {
    s.v = mutate(s.v);
    if (!opts.keep) {
      delete s.shown;
      if (opts.row) { if (s.chk) delete s.chk[opts.row]; if (s.rs) delete s.rs[opts.row]; }
      else { delete s.chk; delete s.rs; }
    }
    const rows = Object.keys(s.chk || {}).length + Object.keys(s.rs || {}).length;
    if (!hasAnswer(q, s) && !rows) { delete s.v; delete s.sa; delete s.chk; delete s.rs; }
  });
  if (autoCheck(q)) {
    if (opts.keep) onChange(); else rerenderQuestion(q.id);
    return;
  }
  const qEl = $(`[data-q="${CSS.escape(q.id)}"]`);
  if (qEl) syncActions(info);
  onChange();
}

function syncActions(info) {
  const qEl = $(`[data-q="${CSS.escape(info.q.id)}"]`);
  const tmp = document.createElement('div');
  tmp.innerHTML = actionsHTML(info.q, Store.get(info.q.id));
  $('.q-actions', qEl).replaceWith(tmp.firstElementChild);
  // Eine Bearbeitung schliesst eine geöffnete Musterlösung
  $$('.solution', qEl).forEach(el => el.remove());
}

function addMark(info, qEl, markerId) {
  const box = $('.mk-text[data-role="mk"]', qEl);
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (r.collapsed || !box.contains(r.commonAncestorContainer)) return false;
  const off = (node, o) => { const rg = document.createRange(); rg.selectNodeContents(box); rg.setEnd(node, o); return rg.toString().length; };
  let s = off(r.startContainer, r.startOffset), e = off(r.endContainer, r.endOffset);
  const txt = box.textContent;
  while (s < e && /\s/.test(txt[s])) s++;
  while (e > s && /\s/.test(txt[e - 1])) e--;
  if (s >= e) return false;
  setValue(info, v => {
    const out = [];
    (v || []).forEach(m => {
      if (m.e <= s || m.s >= e) { out.push(m); return; }
      if (m.s < s) out.push({ s: m.s, e: s, m: m.m });
      if (m.e > e) out.push({ s: e, e: m.e, m: m.m });
    });
    if (markerId) out.push({ s, e, m: markerId });
    out.sort((a, b) => a.s - b.s);
    return out.reduce((acc, m) => {
      const l = acc[acc.length - 1];
      if (l && l.m === m.m && l.e >= m.s) l.e = Math.max(l.e, m.e); else acc.push(Object.assign({}, m));
      return acc;
    }, []);
  });
  sel.removeAllRanges();
  applyMarks(qEl);
  return true;
}

function flash(btn, msg, back) { btn.textContent = msg; setTimeout(() => { btn.textContent = back; }, 1500); }

function confirmDelete(msg) { return window.confirm(msg); }

document.addEventListener('click', e => {
  const t = e.target;
  // Navigation: gleiche Seite -> nur scrollen
  const link = t.closest('#nav a[href^="#/"]');
  if (link) {
    if (link.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
    return;
  }
  const act = t.closest('[data-act]');
  if (!act) return;
  const kind = act.dataset.act;

  if (kind === 'del-all') {
    if (confirmDelete('Wirklich ALLE gespeicherten Antworten und Einschätzungen löschen? Das lässt sich nicht rückgängig machen.')) {
      Store.clearAll(); currentRoute = null; route();
    }
    return;
  }
  if (kind === 'copy') {
    const txt = summaryText();
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).catch(() => {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }).then(() => { act.textContent = 'Kopiert ✓'; setTimeout(() => { act.textContent = 'Kopieren'; }, 1800); });
    return;
  }
  if (kind === 'print') {
    if (currentRoute === 'zusammenfassung') window.print();
    else { printAfterRender = true; location.hash = '#/zusammenfassung'; }
    return;
  }
  if (kind === 'export') { exportAnswers(); return; }
  if (kind === 'import') { $('#importFile').click(); return; }

  const info = qInfo(act);
  if (!info) return;
  const { q } = info;
  const qEl = act.closest('[data-q]');

  switch (kind) {
    case 'check': {
      const st0 = Store.get(q.id) || {};
      if (!scorable(q, st0)) { flash(act, 'Erst antworten', 'Alle prüfen'); return; }
      Store.update(q.id, s => { s.chk = {}; rowIds(q).forEach(id => { s.chk[id] = rowIsRight(q, s, id) ? 1 : 0; }); });
      rerenderQuestion(q.id);
      break;
    }
    case 'row-check': {
      const row = act.dataset.row, st0 = Store.get(q.id) || {};
      if (q.type === 'yesno' && !(((st0.v || {})[row]) || {}).a) { flash(act, 'Erst antworten', 'Prüfen'); return; }
      Store.update(q.id, s => { s.chk = Object.assign({}, s.chk, { [row]: rowIsRight(q, s, row) ? 1 : 0 }); });
      rerenderQuestion(q.id);
      $(`[data-q="${CSS.escape(q.id)}"] [data-act="row-check"][data-row="${row}"]`).focus();
      break;
    }
    case 'row-show': {
      const row = act.dataset.row;
      Store.update(q.id, s => {
        if (q.type === 'yesno' && s.shown) { delete s.shown; s.rs = {}; rowIds(q).forEach(id => { if (id !== row) s.rs[id] = true; }); return; }
        s.rs = Object.assign({}, s.rs);
        s.rs[row] ? delete s.rs[row] : s.rs[row] = true;
      });
      rerenderQuestion(q.id);
      $(`[data-q="${CSS.escape(q.id)}"] [data-act="row-show"][data-row="${row}"]`).focus();
      break;
    }
    case 'show': Store.update(q.id, s => { s.shown = true; }); rerenderQuestion(q.id); break;
    case 'hide': Store.update(q.id, s => { delete s.shown; }); rerenderQuestion(q.id); break;
    case 'del':
      if (confirmDelete('Diese Antwort (inkl. Einschätzung) löschen?')) { Store.del(q.id); rerenderQuestion(q.id); }
      break;
    case 'sa': Store.update(q.id, s => { s.sa = s.sa === act.dataset.val ? undefined : act.dataset.val; if (!s.sa) delete s.sa; delete s.shown; }); rerenderQuestion(q.id); break;
    case 'mk': {
      const id = act.dataset.marker;
      const applied = addMark(info, qEl, id);
      if (id && applied) setActiveMarker(q, id);
      else if (id) setActiveMarker(q, activeMarker(q) === id ? '' : id);
      else if (!applied) { const bar = $('.mk-bar', qEl); bar.classList.add('shake'); setTimeout(() => bar.classList.remove('shake'), 500); }
      $$('.mk-btn[data-marker]', qEl).forEach(b => { const on = b.dataset.marker && b.dataset.marker === activeMarker(q); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      break;
    }
    case 'cell': {
      const key = act.dataset.row + '|' + act.dataset.col;
      setValue(info, v => {
        const nv = { cells: Object.assign({}, v && v.cells) };
        const next = CELL_NEXT[nv.cells[key] || ''];
        next ? nv.cells[key] = next : delete nv.cells[key];
        return nv;
      });
      const v = (Store.get(q.id) || { v: { cells: {} } }).v;
      const cur = ((v && v.cells) || {})[key] || '';
      act.className = 'cell c' + CELL[cur].cls;
      act.textContent = CELL[cur].sym;
      act.setAttribute('aria-label', `${q.cols[act.dataset.col]}: ${CELL[cur].label}`);
      break;
    }
    case 'rk-up': case 'rk-down': {
      const li = act.closest('li');
      if (kind === 'rk-up' && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      if (kind === 'rk-down' && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      saveRank(li.parentNode);
      act.focus();
      break;
    }
  }
});

document.addEventListener('input', e => {
  const t = e.target, role = t.dataset && t.dataset.role;
  if (t.id === 'sumName') { Store.setName(t.value); const p = $('#sumNameP'); if (p) p.textContent = t.value || '–'; return; }
  if (!role) return;
  const info = qInfo(t); if (!info) return;
  switch (role) {
    case 'text': setValue(info, () => t.value); break;
    case 'done-note': setValue(info, v => Object.assign({ done: false }, v, { note: t.value })); break;
    case 'yn-b': setValue(info, v => { const nv = Object.assign({}, v); nv[t.dataset.row] = Object.assign({}, nv[t.dataset.row], { b: t.value }); return nv; }, { keep: true }); break;
    case 'word-n': case 'word-s': setValue(info, v => { const nv = Object.assign({}, v); nv[t.dataset.row] = Object.assign({}, nv[t.dataset.row], { [role === 'word-n' ? 'n' : 's']: t.value }); return nv; }); break;
  }
});

document.addEventListener('change', e => {
  const t = e.target, role = t.dataset && t.dataset.role;
  if (!role) return;
  const info = qInfo(t); if (!info) return;
  switch (role) {
    case 'choice': {
      const row = t.value;
      setValue(info, () => $$('input[data-role="choice"]:checked', t.closest('[data-q]')).map(i => i.value), autoCheck(info.q) ? { row } : {});
      const again = $(`[data-q="${CSS.escape(info.q.id)}"] input[data-role="choice"][value="${row}"]`); if (again) again.focus();
      break;
    }
    case 'yn-a': {
      setValue(info, v => { const nv = Object.assign({}, v); nv[t.dataset.row] = Object.assign({}, nv[t.dataset.row], { a: t.value }); return nv; }, { row: t.dataset.row });
      const again = $(`[data-q="${CSS.escape(info.q.id)}"] input[data-role="yn-a"][data-row="${t.dataset.row}"][value="${t.value}"]`); if (again) again.focus();
      break;
    }
    case 'done': setValue(info, v => Object.assign({ note: '' }, v, { done: t.checked })); break;
  }
});

/* Rangfolge: Drag & Drop */
let dragLi = null;
function saveRank(ol) {
  const info = QUESTIONS[ol.dataset.rank];
  const ids = $$('li', ol).map(li => li.dataset.id);
  setValue(info, () => ids);
}
document.addEventListener('dragstart', e => {
  const li = e.target.closest && e.target.closest('.rank li'); if (!li) return;
  dragLi = li; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.dataset.id);
});
document.addEventListener('dragover', e => {
  if (!dragLi) return;
  const li = e.target.closest && e.target.closest('.rank li');
  if (!li || li === dragLi || li.parentNode !== dragLi.parentNode) return;
  e.preventDefault();
  const r = li.getBoundingClientRect();
  li.parentNode.insertBefore(dragLi, (e.clientY - r.top) > r.height / 2 ? li.nextSibling : li);
});
document.addEventListener('drop', e => { if (dragLi) e.preventDefault(); });
document.addEventListener('dragend', () => {
  if (!dragLi) return;
  const ol = dragLi.parentNode; dragLi.classList.remove('dragging'); dragLi = null; saveRank(ol);
});

/* Aktive Farbe: neue Maus-Auswahl sofort markieren */
document.addEventListener('pointerup', e => {
  if (e.pointerType !== 'mouse') return;
  const box = e.target.closest && e.target.closest('.mk-text[data-role="mk"]');
  if (!box || box.classList.contains('mk-sol')) return;
  const info = qInfo(box), act = info && activeMarker(info.q);
  if (!act) return;
  setTimeout(() => addMark(info, box.closest('[data-q]'), act), 0);
});

/* Marker-Buttons: Auswahl nicht verlieren */
document.addEventListener('mousedown', e => { if (e.target.closest('.mk-btn')) e.preventDefault(); });

/* Fussnoten-Popover */
const pop = $('#fnPop');
function showFn(sup) {
  const txt = D.footnotes[sup.dataset.fn]; if (!txt) return;
  pop.innerHTML = `<b>Fussnote ${sup.dataset.fn}</b> ${txt}`;
  pop.hidden = false;
  const r = sup.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left - 20), window.innerWidth - pw - 8);
  let y = r.bottom + 8; if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
const hideFn = () => { pop.hidden = true; };
document.addEventListener('mouseover', e => { const s = e.target.closest && e.target.closest('sup.fn'); if (s) showFn(s); });
document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('sup.fn')) hideFn(); });
document.addEventListener('focusin', e => { const s = e.target.closest && e.target.closest('sup.fn'); if (s) showFn(s); });
document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('sup.fn')) hideFn(); });
document.addEventListener('click', e => { const s = e.target.closest && e.target.closest('sup.fn'); s ? showFn(s) : hideFn(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideFn(); });
window.addEventListener('scroll', hideFn, { passive: true });

$('#importFile').addEventListener('change', e => { if (e.target.files[0]) importAnswers(e.target.files[0]); e.target.value = ''; });

$('#navToggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  $('#navToggle').setAttribute('aria-expanded', String(open));
});

window.addEventListener('hashchange', route);
window.addEventListener('storage', () => { if (document.activeElement && document.activeElement.matches('textarea,input')) return; currentRoute = null; route(); });

renderNav();
route();
})();
