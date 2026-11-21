/* Stream Deck - frontend para GitHub Pages (Supabase) */

const CFG = window.DECK_CONFIG;
let client = null;
let uid = null;
let state = null;
let editing = false;
let currentKeyId = null;
let saveTimer = null;
let presenceTimer = null;

const $ = (sel) => document.querySelector(sel);

const DEFAULT_LAYOUT = {
  profiles: {
    Principal: {
      keys: [
        { id: 'youtube',   type: 'button', label: 'YouTube',   icon: '▶️', color: '#ff0033' },
        { id: 'spotify',   type: 'button', label: 'Spotify',   icon: '🎵', color: '#1db954' },
        { id: 'explorer',  type: 'button', label: 'Archivos',  icon: '📁', color: '#f39c12' },
        { id: 'master',    type: 'slider', label: 'Volumen',   icon: '🔊', color: '#2980b9', target: 'master' },
        { id: 'sp_vol',    type: 'slider', label: 'Spotify',   icon: '🎵', color: '#1db954', target: 'Spotify.exe' },
        { id: 'playpause', type: 'button', label: 'Play/Pausa',icon: '⏯️', color: '#8e44ad' },
        { id: 'next',      type: 'button', label: 'Siguiente', icon: '⏭️', color: '#8e44ad' },
        { id: 'prev',      type: 'button', label: 'Anterior',  icon: '⏮️', color: '#8e44ad' },
        { id: 'mute',      type: 'button', label: 'Silenciar', icon: '🔇', color: '#7f8c8d' },
        { id: 'taskmgr',   type: 'button', label: 'Tareas',    icon: '📊', color: '#16a085' },
        { id: 'lock',      type: 'button', label: 'Bloquear',  icon: '🔒', color: '#c0392b' }
      ]
    }
  },
  active: 'Principal'
};

/* -------------------- sesión -------------------- */

function makeClient(remember) {
  return supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: remember ? window.localStorage : window.sessionStorage
    }
  });
}

async function boot() {
  const remember = localStorage.getItem('deck_remember') === '1';
  client = makeClient(remember);
  const { data: { session } } = await client.auth.getSession();
  if (session) {
    await enterDeck(session);
  } else {
    $('#email').value = localStorage.getItem('deck_email') || '';
    showLogin();
  }
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#deckView').classList.add('hidden'); }
function showDeck()  { $('#loginView').classList.add('hidden'); $('#deckView').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const remember = $('#remember').checked;
  const err = $('#loginError');
  const btn = $('#loginBtn');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  localStorage.setItem('deck_remember', remember ? '1' : '0');
  localStorage.setItem('deck_email', email);
  client = makeClient(remember);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) { err.textContent = traducirError(error.message); return; }
  uid = data.session.user.id;
  await registerDevice();
  await enterDeck(data.session);
});

function traducirError(msg) {
  if (/invalid login|credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Confirma tu correo antes de entrar.';
  if (/too many requests/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return msg;
}

async function registerDevice() {
  let deviceId = localStorage.getItem('deck_device_id');
  if (!deviceId) {
    deviceId = (crypto.randomUUID && crypto.randomUUID()) ||
      ('dev-' + Math.random().toString(36).slice(2));
    localStorage.setItem('deck_device_id', deviceId);
  }
  const ua = navigator.userAgent;
  const label = /iPhone/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : 'Navegador';
  await client.from('trusted_devices').upsert({
    user_id: uid,
    device_id: deviceId,
    label,
    last_seen: new Date().toISOString()
  }, { onConflict: 'user_id,device_id' });
  $('#deviceBar').textContent = '✓ Dispositivo recordado: ' + label;
  $('#deviceBar').classList.remove('hidden');
}

async function enterDeck(session) {
  uid = session.user.id;
  await ensureState();
  showDeck();
  await render();
  suscribirRealtime();
  presenceTimer = setInterval(actualizarPresencia, 2000);
  actualizarPresencia();
}

async function logout() {
  if (presenceTimer) clearInterval(presenceTimer);
  await client.auth.signOut();
  state = null;
  showLogin();
}
$('#logoutBtn').addEventListener('click', logout);

/* -------------------- estado en Supabase -------------------- */

async function ensureState() {
  const { data, error } = await client.from('deck_state')
    .select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (data) { state = data; return; }
  const fresh = {
    user_id: uid,
    layout: DEFAULT_LAYOUT,
    audio: {},
    desired_audio: {},
    bindings: {},
    presence: {}
  };
  const { data: created, error: e2 } = await client.from('deck_state')
    .upsert(fresh, { onConflict: 'user_id' }).select().single();
  if (e2) throw e2;
  state = created;
}

async function savePatch(patch) {
  const { error } = await client.from('deck_state')
    .upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' });
  if (error) console.warn('Error al guardar:', error.message);
}

function currentProfile() {
  return state.layout.profiles[state.layout.active] ||
         state.layout.profiles[Object.keys(state.layout.profiles)[0]];
}

/* -------------------- render del deck -------------------- */

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';
  const keys = currentProfile().keys;
  keys.forEach((k) => grid.appendChild(makeKey(k)));
  if (editing) {
    const add = document.createElement('div');
    add.className = 'key';
    add.style.background = '#2c313c';
    add.innerHTML = '<span class="ico">＋</span><span class="lbl">Añadir</span>';
    add.onclick = () => openEditor(null);
    grid.appendChild(add);
  }
  renderProfiles();
  updateSliderValues();
  marcarSinAsignar();
}

function makeKey(k) {
  const el = document.createElement('div');
  el.className = 'key' + (k.type === 'slider' ? ' slider' : '');
  el.style.background = k.color || '#34495e';
  el.dataset.id = k.id;

  if (k.type === 'slider') {
    el.innerHTML =
      '<span class="badge">✎</span>' +
      '<span class="ico">' + (k.icon || '🔊') + '</span>' +
      '<input type="range" min="0" max="100" value="0">' +
      '<span class="value">0%</span>' +
      '<span class="lbl">' + (k.label || '') + '</span>';
    const range = el.querySelector('input');
    const out = el.querySelector('.value');
    range.addEventListener('input', () => {
      out.textContent = range.value + '%';
      if (!editing) setDesired(k.target || 'master', Number(range.value));
    });
    range.addEventListener('pointerdown', () => { range.dataset.dragging = '1'; });
    range.addEventListener('pointerup', () => { delete range.dataset.dragging; });
    el.addEventListener('click', (e) => {
      if (editing && e.target.tagName !== 'INPUT') openEditor(k.id);
    });
  } else {
    el.innerHTML =
      '<span class="badge">✎</span>' +
      '<span class="ico">' + (k.icon || '•') + '</span>' +
      '<span class="lbl">' + (k.label || '') + '</span>';
    el.onclick = () => editing ? openEditor(k.id) : sendCommand(k.id);
  }
  return el;
}

function updateSliderValues() {
  const audio = state.audio || {};
  document.querySelectorAll('.key.slider').forEach((el) => {
    const key = currentProfile().keys.find((k) => k.id === el.dataset.id);
    if (!key) return;
    const target = key.target || 'master';
    let val = target === 'master' ? audio.master : (audio.apps || {})[target];
    if (val == null) val = state.desired_audio && target === 'master'
      ? state.desired_audio.master : 0;
    if (val == null) val = 0;
    const range = el.querySelector('input');
    if (range && !range.dataset.dragging) {
      range.value = Math.round(val);
      el.querySelector('.value').textContent = Math.round(val) + '%';
    }
  });
}

function renderProfiles() {
  const sel = $('#profileSelect');
  sel.innerHTML = '';
  Object.keys(state.layout.profiles).forEach((name) => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    if (name === state.layout.active) o.selected = true;
    sel.appendChild(o);
  });
}
$('#profileSelect').addEventListener('change', async (e) => {
  state.layout.active = e.target.value;
  await savePatch({ layout: state.layout });
  render();
});

/* -------------------- acciones -------------------- */

async function sendCommand(keyId) {
  const { error } = await client.from('deck_commands')
    .insert({ user_id: uid, command: { keyId, t: Date.now() } });
  if (error) console.warn('Error al enviar orden:', error.message);
  const el = document.querySelector('.key[data-id="' + CSS.escape(keyId) + '"]');
  if (el) {
    el.style.filter = 'brightness(1.5)';
    setTimeout(() => { el.style.filter = ''; }, 130);
  }
}

let desiredAudio = null;
function setDesired(target, value) {
  if (!desiredAudio) {
    desiredAudio = JSON.parse(JSON.stringify(state.desired_audio || {}));
    if (!desiredAudio.apps) desiredAudio.apps = {};
  }
  if (target === 'master') desiredAudio.master = value;
  else desiredAudio.apps[target] = value;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await savePatch({ desired_audio: desiredAudio });
  }, 90);
}

/* -------------------- presencia / realtime -------------------- */

function actualizarPresencia() {
  const el = $('#presence');
  if (!state || !state.presence || !state.presence.lastSeen) {
    el.textContent = '● PC desconectado';
    el.className = 'presence';
    return;
  }
  const age = Date.now() - new Date(state.presence.lastSeen).getTime();
  const online = age < 15000;
  el.textContent = online ? '● PC en línea' : '● PC desconectado';
  el.className = 'presence' + (online ? ' online' : '');
  if (!online) {
    const d = $('#deviceBar');
    if (d) d.classList.add('hidden');
  }
}

function suscribirRealtime() {
  client.channel('deck-' + uid)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'deck_state',
      filter: 'user_id=eq.' + uid
    }, (payload) => {
      const row = payload.new;
      state.audio = row.audio || state.audio;
      state.desired_audio = row.desired_audio || state.desired_audio;
      state.presence = row.presence || state.presence;
      state.bindings = row.bindings || state.bindings;
      updateSliderValues();
      actualizarPresencia();
      marcarSinAsignar();
    })
    .subscribe();
}

function marcarSinAsignar() {
  const bindings = state.bindings || {};
  document.querySelectorAll('.key').forEach((el) => {
    const id = el.dataset.id;
    if (!id || id === '__add') return;
    const has = Object.prototype.hasOwnProperty.call(bindings, id);
    el.style.opacity = has ? '1' : '.55';
  });
}

/* -------------------- editor -------------------- */

$('#editBtn').addEventListener('click', () => {
  editing = !editing;
  document.body.classList.toggle('editing', editing);
  $('#editBtn').textContent = editing ? 'Listo' : 'Editar';
  render();
});

function openEditor(id) {
  currentKeyId = id;
  const k = id ? currentProfile().keys.find((x) => x.id === id) : null;
  const f = $('#editorForm');
  f.elements.label.value = k ? k.label || '' : '';
  f.elements.icon.value = k ? k.icon || '' : '';
  f.elements.color.value = k ? k.color || '#3498db' : '#3498db';
  f.elements.type.value = k ? k.type || 'button' : 'button';
  f.elements.target.value = k && k.target ? k.target : 'master';
  toggleTarget();
  $('#deleteKeyBtn').style.display = id ? 'block' : 'none';
  $('#editorTitle').textContent = id ? 'Editar control' : 'Nuevo control';
  $('#editorDlg').showModal();
}

function toggleTarget() {
  const isSlider = $('#editorForm').elements.type.value === 'slider';
  const label = $('#targetLabel');
  const input = $('#editorForm').elements.target;
  label.classList.toggle('hidden', !isSlider);
  input.classList.toggle('hidden', !isSlider);
  if (!isSlider) input.value = '';
}
$('#editorForm').elements.type.addEventListener('change', toggleTarget);
toggleTarget();

$('#saveKeyBtn').addEventListener('click', async () => {
  const f = $('#editorForm');
  const data = {
    label: f.elements.label.value.trim() || 'Sin nombre',
    icon: f.elements.icon.value.trim() || '•',
    color: f.elements.color.value,
    type: f.elements.type.value
  };
  if (data.type === 'slider') data.target = f.elements.target.value.trim() || 'master';

  const keys = currentProfile().keys;
  if (currentKeyId) {
    const idx = keys.findIndex((x) => x.id === currentKeyId);
    keys[idx] = { ...keys[idx], ...data };
  } else {
    keys.push({ id: 'k' + Date.now(), ...data });
  }
  await savePatch({ layout: state.layout });
  $('#editorDlg').close();
  render();
});

$('#deleteKeyBtn').addEventListener('click', async () => {
  const keys = currentProfile().keys;
  const idx = keys.findIndex((x) => x.id === currentKeyId);
  if (idx >= 0) keys.splice(idx, 1);
  await savePatch({ layout: state.layout });
  $('#editorDlg').close();
  render();
});

boot();
