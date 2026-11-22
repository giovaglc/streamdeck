/* Stream Deck local: sin login, el móvil habla directo con el PC por WiFi */

let token = localStorage.getItem('deck_local_token') || '';
let state = { layout: {}, bindings: {}, audio: {} };
let edLayout = null, edBindings = {}, edPage = null, edDrag = null;
let saveTimer = null, bindTimer = null;

const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));

async function api(path, method = 'GET', body = null) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(path + sep + 'token=' + encodeURIComponent(token), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { logout(); throw new Error('no autorizado'); }
  return r.json();
}

/* ------------------- emparejamiento ------------------- */
if (token) start();
else $('#pairView').classList.remove('hidden');

$('#pairBtn').onclick = async () => {
  const code = $('#code').value.trim();
  const r = await fetch('/api/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const j = await r.json();
  if (!j.ok) { $('#pairMsg').textContent = j.error || 'Código incorrecto'; return; }
  token = j.token;
  localStorage.setItem('deck_local_token', token);
  start();
};

function logout() {
  localStorage.removeItem('deck_local_token');
  token = '';
  $('#settingsDlg').close();
  $('#editorView').classList.add('hidden');
  $('#deckView').classList.add('hidden');
  $('#pairView').classList.remove('hidden');
  $('#pairMsg').textContent = 'Dispositivo olvidado.';
}
$('#logoutBtn').onclick = logout;
$('#closeSettings').onclick = () => $('#settingsDlg').close();
$('#settingsBtn').onclick = () => $('#settingsDlg').showModal();

/* ------------------- arranque ------------------- */
async function start() {
  $('#pairView').classList.add('hidden');
  $('#deckView').classList.remove('hidden');
  state = await api('/api/state');
  render();
  const es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onmessage = (ev) => {
    try {
      const s = JSON.parse(ev.data);
      if (!s.layout) return;
      state = { ...state, ...s };
      render();
    } catch (e) {}
  };
}

/* ------------------- rejilla ------------------- */
function keys() {
  const p = state.layout.profiles || {};
  const a = state.layout.active || Object.keys(p)[0];
  const raw = (p[a] || {}).keys || [];
  return Array.isArray(raw) ? raw : Object.keys(raw).sort((x, y) => x - y).map(k => raw[k]);
}
function safeKey(s) { return String(s).trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_'); }

function render() {
  const layout = state.layout;
  const bg = layout.background || '#0f1115';
  document.body.style.setProperty('--bg', bg);
  const profiles = layout.profiles || {};
  const active = layout.active || Object.keys(profiles)[0];
  $('#pageName').textContent = active;
  const grid = $('#grid');
  grid.innerHTML = '';
  keys().forEach((k, i) => {
    const el = makeKey(k);
    el.style.animationDelay = (i * 35) + 'ms';
    grid.appendChild(el);
  });
  requestAnimationFrame(sizeSliders);
  setTimeout(sizeSliders, 60);
}

function makeKey(k) {
  const span = parseInt(k.span, 10) || 1;
  let w = span, h = 1;
  if (k.type === 'slider') { w = span >= 4 ? 2 : 1; h = 2; }
  else if (span === 4) { w = 2; h = 2; }
  let col = parseInt(k.col, 10) || 0, row = parseInt(k.row, 10) || 0;
  if (col) col = Math.max(1, Math.min(col, 8 - w));
  if (row) row = Math.max(1, Math.min(row, 4 - h));

  const el = document.createElement('div');
  el.className = 'key' + (k.type === 'slider' ? ' slider' : '');
  el.style.gridColumn = (col ? col : 'auto') + ' / span ' + w;
  el.style.gridRow = (row ? row : 'auto') + ' / span ' + h;
  el.style.setProperty('--keycolor', k.color || '#34495e');
  el.dataset.id = k.id;

  if (k.image && k.image.length < 500000) {
    const img = document.createElement('img'); img.className = 'keyimg'; img.src = k.image;
    el.appendChild(img);
  }
  const content = document.createElement('div'); content.className = 'keycontent';

  if (k.type === 'slider') {
    const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = k.icon || '🔊';
    const wrap = document.createElement('div'); wrap.className = 'vslider';
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100';
    input.dataset.target = k.target || 'master';
    input.addEventListener('input', () => {
      fill(input);
      lbl.textContent = (k.label || '') + ' ' + input.value + '%';
      setDesired(input.dataset.target, Number(input.value));
    });
    wrap.appendChild(input);
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = k.label || '';
    content.append(ico, wrap, lbl); el.appendChild(content);
    const audio = state.audio || {};
    const t = input.dataset.target;
    let v = t === 'master' ? audio.master : (t === 'mic' ? audio.mic : (audio.apps || {})[t]);
    if (v == null) v = 0;
    input.value = Math.round(v);
    fill(input);
    requestAnimationFrame(sizeSliders);
  } else {
    content.innerHTML = '<span class="ico">' + (k.icon || '') + '</span><span class="lbl">' + (k.label || '') + '</span>';
    el.appendChild(content);
    el.onclick = () => send(k.id);
  }
  return el;
}

function fill(input) { input.style.setProperty('--fill', (input.value || 0) + '%'); }
function sizeSliders() {
  document.querySelectorAll('.vslider').forEach(w => {
    const i = w.querySelector('input');
    if (i) i.style.width = Math.max(40, w.clientHeight) + 'px';
  });
}

async function send(id) {
  if (navigator.vibrate) navigator.vibrate(18);
  const el = document.querySelector('.key[data-id="' + id + '"]');
  if (el) { el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 260); }
  await api('/api/command', 'POST', { keyId: id });
}

let desired = null;
function setDesired(target, value) {
  if (!desired) desired = clone(state.audio || { master: 50, apps: {} });
  if (!desired.apps) desired.apps = {};
  if (target === 'master') desired.master = value;
  else if (target === 'mic') desired.mic = value;
  else desired.apps[target] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api('/api/audio', 'POST', desired), 90);
}

/* ------------------- editor ------------------- */
$('#editBtn').onclick = () => {
  edLayout = clone(state.layout);
  edBindings = clone(state.bindings || {});
  edPage = edLayout.active;
  $('#deckView').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  renderEditor();
};
$('#edBack').onclick = () => { $('#editorView').classList.add('hidden'); $('#deckView').classList.remove('hidden'); render(); };

function edKeys() { const p = edLayout.profiles[edPage] || { keys: [] }; return p.keys; }

function saveLayout() {
  clearTimeout(saveTimer);
  edStatus('Guardando…', true);
  saveTimer = setTimeout(async () => {
    await api('/api/layout', 'POST', { layout: edLayout });
    edStatus('Guardado ✓');
  }, 250);
}
function saveBindings() {
  clearTimeout(bindTimer);
  edStatus('Guardando…', true);
  bindTimer = setTimeout(async () => {
    await api('/api/bindings', 'POST', { bindings: edBindings });
    edStatus('Guardado ✓');
  }, 250);
}
function edStatus(t, saving) { const e = $('#edStatus'); e.textContent = t; e.classList.toggle('saving', !!saving); }

function renderEditor() {
  const pages = $('#edPages'); pages.innerHTML = '';
  Object.keys(edLayout.profiles).forEach(name => {
    const b = document.createElement('div');
    b.className = 'ed-page' + (name === edPage ? ' on' : '');
    b.textContent = name + (name === edLayout.active ? ' ●' : '');
    b.onclick = () => { edPage = name; edLayout.active = name; saveLayout(); renderEditor(); };
    pages.appendChild(b);
  });
  $('#edBg').value = edLayout.background || '#0f1115';
  $('#edBgHex').textContent = edLayout.background || '#0f1115';
  renderPreview(); renderItems(); renderBindings();
}

function renderPreview() {
  const host = $('#edPreview'); host.innerHTML = '';
  edKeys().forEach((k, idx) => {
    const s = parseInt(k.span, 10) || 1;
    let w = s, h = 1;
    if (k.type === 'slider') { w = s >= 4 ? 2 : 1; h = 2; } else if (s === 4) { w = 2; h = 2; }
    let col = parseInt(k.col, 10) || 0, row = parseInt(k.row, 10) || 0;
    if (col) col = Math.max(1, Math.min(col, 8 - w));
    if (row) row = Math.max(1, Math.min(row, 4 - h));
    const el = document.createElement('div'); el.className = 'pv'; el.draggable = true; el.dataset.idx = idx;
    el.style.gridColumn = col ? col + ' / span ' + w : 'span ' + w;
    el.style.gridRow = row ? row + ' / span ' + h : 'span ' + h;
    el.style.background = k.color || '#34495e'; el.textContent = k.icon || '';
    el.addEventListener('dragstart', ev => { edDrag = idx; ev.dataTransfer.setData('text/plain', String(idx)); });
    host.appendChild(el);
  });
  host.ondragover = ev => ev.preventDefault();
  host.ondrop = ev => {
    ev.preventDefault();
    if (edDrag === null) return;
    const r = host.getBoundingClientRect();
    const c = Math.max(1, Math.min(7, Math.floor((ev.clientX - r.left) / (r.width / 7)) + 1));
    const f = Math.max(1, Math.min(3, Math.floor((ev.clientY - r.top) / (r.height / 3)) + 1));
    const k = edKeys()[edDrag];
    if (k) { k.col = c; k.row = f; }
    edDrag = null; renderPreview(); renderItems(); saveLayout();
  };
}

function renderItems() {
  const host = $('#edItems'); host.innerHTML = '';
  edKeys().forEach((k, idx) => {
    const card = document.createElement('div');
    card.className = 'ed-item'; card.draggable = true; card.dataset.idx = idx;
    card.innerHTML =
      '<div class="top"><span class="ed-handle">⠿</span><b>' + (k.label || 'Sin nombre') + '</b>' +
      '<button class="ed-move" data-dir="-1">◀</button><button class="ed-move" data-dir="1">▶</button>' +
      '<button class="ed-del">✕</button></div>' +
      '<div class="ed-fields">' +
      '<div><label>Tipo</label><select class="f-type"><option value="button">Botón</option><option value="slider">Deslizador</option></select></div>' +
      '<div><label>Etiqueta</label><input class="f-label"></div>' +
      '<div><label>Icono</label><input class="f-icon" maxlength="8"></div>' +
      '<div><label>Color</label><input class="f-color" type="color"></div>' +
      '<div><label>Objetivo</label><input class="f-target"></div>' +
      '<div><label>Columna (0=auto)</label><input class="f-col" type="number" min="0" max="7"></div>' +
      '<div><label>Fila (0=auto)</label><input class="f-row" type="number" min="0" max="3"></div>' +
      '</div>' +
      '<div class="ed-full"><label>Imagen (URL o archivo)</label><div class="ed-row">' +
      '<input class="f-image" placeholder="https://…"><input class="f-file" type="file" accept="image/*" style="max-width:110px"></div></div>' +
      '<div class="ed-sizes"></div>';

    const set = (sel, v) => { card.querySelector(sel).value = v == null ? '' : v; };
    set('.f-label', k.label); set('.f-icon', k.icon); set('.f-color', k.color || '#3498db');
    set('.f-target', k.target || 'master'); set('.f-col', k.col || 0); set('.f-row', k.row || 0);
    card.querySelector('.f-type').value = k.type || 'button';
    card.querySelector('.f-image').value = k.image || '';

    [['.f-label','label'],['.f-icon','icon'],['.f-color','color'],['.f-target','target']].forEach(([sel, f]) => {
      card.querySelector(sel).oninput = ev => {
        k[f] = ev.target.value;
        if (f === 'label') card.querySelector('.top b').textContent = ev.target.value || 'Sin nombre';
        renderPreview(); saveLayout();
      };
    });
    [['.f-col','col'],['.f-row','row']].forEach(([sel, f]) => {
      card.querySelector(sel).oninput = ev => {
        const n = parseInt(ev.target.value, 10) || 0;
        if (n) k[f] = n; else delete k[f];
        renderPreview(); saveLayout();
      };
    });
    card.querySelector('.f-type').onchange = ev => {
      k.type = ev.target.value;
      if (k.type === 'slider' && (k.span || 1) < 2) k.span = 2;
      renderItems(); renderPreview(); saveLayout();
    };
    card.querySelector('.f-file').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        if (rd.result.length > 300000) { alert('Imagen demasiado grande'); return; }
        k.image = rd.result; renderItems(); renderPreview(); saveLayout();
      };
      rd.readAsDataURL(f);
    };
    [1, 2, 4].forEach(n => {
      if (k.type === 'slider' && n === 1) return;
      const b = document.createElement('button'); b.textContent = n === 1 ? '1 cuadrado' : (n === 2 ? '2 cuadrados' : '4 cuadrados');
      if ((k.span || 1) === n) b.className = 'on';
      b.onclick = () => { k.span = n; renderItems(); renderPreview(); saveLayout(); };
      card.querySelector('.ed-sizes').appendChild(b);
    });
    card.querySelectorAll('.ed-move').forEach(btn => btn.onclick = () => {
      const to = idx + Number(btn.dataset.dir), arr = edKeys();
      if (to < 0 || to >= arr.length) return;
      const [m] = arr.splice(idx, 1); arr.splice(to, 0, m);
      renderItems(); renderPreview(); saveLayout();
    });
    card.querySelector('.ed-del').onclick = () => {
      edKeys().splice(idx, 1); renderItems(); renderPreview(); saveLayout();
    };
    card.ondragstart = ev => { edDrag = idx; ev.dataTransfer.setData('text/plain', String(idx)); };
    card.ondragover = ev => ev.preventDefault();
    card.ondrop = ev => {
      ev.preventDefault();
      if (edDrag === null || edDrag === idx) return;
      const arr = edKeys(); const [m] = arr.splice(edDrag, 1); arr.splice(idx, 0, m);
      edDrag = null; renderItems(); renderPreview(); saveLayout();
    };
    host.appendChild(card);
  });
}

function allControls() {
  const out = [];
  Object.keys(edLayout.profiles).forEach(p =>
    ((edLayout.profiles[p] || {}).keys || []).forEach(k =>
      out.push({ id: k.id, label: k.label || '(sin nombre)', page: p })));
  return out;
}

function renderBindings() {
  const host = $('#edBindings'); host.innerHTML = '';
  const controls = allControls();
  const add = $('#edNewBind');
  const old = add.value;
  add.innerHTML = '<option value="">Elige un botón…</option>';
  controls.filter(c => !edBindings[c.id]).forEach(c => {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.label + ' · ' + c.page; add.appendChild(o);
  });
  add.value = old;

  Object.keys(edBindings).forEach(id => {
    const b = edBindings[id] || {};
    const row = document.createElement('div'); row.className = 'ed-bind';
    row.innerHTML = '<select class="b-id"></select>' +
      '<select class="b-type"><option>url</option><option>app</option><option>cmd</option><option>volume</option>' +
      '<option>media</option><option>key</option><option>volume_master</option><option>volume_app</option><option>volume_mic</option><option>mic_mute</option></select>' +
      '<input class="b-value" value="' + (b.value || '') + '" placeholder="URL, app, tecla…">' +
      '<input class="b-level" value="' + (b.level != null ? b.level : '') + '" placeholder="nivel">' +
      '<button class="ed-del">✕</button>';
    const sel = row.querySelector('.b-id');
    controls.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label + ' · ' + c.page; sel.appendChild(o); });
    if (!controls.some(c => c.id === id)) { const o = document.createElement('option'); o.value = id; o.textContent = id; sel.appendChild(o); }
    sel.value = id;
    row.querySelector('.b-type').value = b.type || 'url';
    [['.b-value','value'],['.b-level','level']].forEach(([s, f]) =>
      row.querySelector(s).oninput = ev => { b[f] = ev.target.value; saveBindings(); });
    row.querySelector('.b-type').onchange = ev => { b.type = ev.target.value; saveBindings(); };
    sel.onchange = ev => {
      const n = ev.target.value; if (!n || n === id) return;
      delete edBindings[id]; edBindings[n] = b; saveBindings(); renderBindings();
    };
    row.querySelector('.ed-del').onclick = () => { delete edBindings[id]; saveBindings(); renderBindings(); };
    host.appendChild(row);
  });
}

$('#edAddButton').onclick = () => {
  const k = { id: 'k' + Date.now(), type: 'button', label: 'Nuevo botón', icon: '⭐', color: '#6366f1', image: '', span: 1 };
  edKeys().push(k); edBindings[k.id] = { type: 'url', value: '' }; renderItems(); renderPreview(); renderBindings(); saveLayout(); saveBindings();
};
$('#edAddSlider').onclick = () => {
  const k = { id: 'k' + Date.now(), type: 'slider', label: 'Volumen', icon: '🔊', color: '#2980b9', image: '', target: 'master', span: 2 };
  edKeys().push(k); edBindings[k.id] = { type: 'volume_master' }; renderItems(); renderPreview(); renderBindings(); saveLayout(); saveBindings();
};
$('#edAddBind').onclick = () => {
  const id = $('#edNewBind').value; if (!id) return;
  edBindings[id] = { type: 'url', value: '' }; renderBindings(); saveBindings();
};
$('#edAddPage').onclick = () => {
  const n = $('#edNewPage').value.trim(); if (!n || edLayout.profiles[n]) return;
  edLayout.profiles[n] = { keys: [] }; edPage = n; edLayout.active = n;
  $('#edNewPage').value = ''; saveLayout(); renderEditor();
};
$('#edRenamePage').onclick = () => {
  const n = prompt('Nuevo nombre', edPage); if (!n || edLayout.profiles[n]) return;
  edLayout.profiles[n] = edLayout.profiles[edPage]; delete edLayout.profiles[edPage]; edPage = n;
  if (edLayout.active === edPage) edLayout.active = n; saveLayout(); renderEditor();
};
$('#edDeletePage').onclick = () => {
  if (Object.keys(edLayout.profiles).length <= 1) return alert('Debe quedar una página');
  if (!confirm('¿Borrar ' + edPage + '?')) return;
  delete edLayout.profiles[edPage]; edPage = Object.keys(edLayout.profiles)[0]; edLayout.active = edPage;
  saveLayout(); renderEditor();
};
const PRESETS = ['#0f1115','#10131a','#1b1030','#0d1f24','#2a1015','#f2f2f2'];
PRESETS.forEach(c => {
  const b = document.createElement('button'); b.style.background = c;
  b.onclick = () => { edLayout.background = c; $('#edBg').value = c; $('#edBgHex').textContent = c; saveLayout(); };
  $('#edPresets').appendChild(b);
});
$('#edBg').oninput = ev => { edLayout.background = ev.target.value; $('#edBgHex').textContent = ev.target.value; saveLayout(); };
document.querySelectorAll('.ed-tabs button').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('.ed-tabs button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  ['controls','bindings'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== btn.dataset.tab));
});
