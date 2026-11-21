/* Stream Deck - frontend (Firebase Auth + Realtime Database) */

const CFG = window.DECK_CONFIG;
firebase.initializeApp(CFG);
const auth = firebase.auth();
const db = firebase.database();

let uid = null;
let deckRef = null;
let state = {};
let editing = false;
let currentKeyId = null;
let saveTimer = null;
let presenceTimer = null;
let desiredAudio = null;
let firstSnapshot = true;
let signupMode = false;

function detectRole() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|Android|Mobile/i.test(ua) ? 'sender' : 'receiver';
}
let role = localStorage.getItem('deck_role') || detectRole();

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

/* -------------------------- sesión -------------------------- */

async function boot() {
  const remember = localStorage.getItem('deck_remember') !== '0';
  try {
    await auth.setPersistence(
      remember ? firebase.auth.Auth.Persistence.LOCAL
               : firebase.auth.Auth.Persistence.SESSION
    );
  } catch (e) { console.warn(e); }
  $('#email').value = localStorage.getItem('deck_email') || '';
  auth.onAuthStateChanged((user) => user ? enterDeck(user) : showLogin());
}

function showLogin() {
  $('#loginView').classList.remove('hidden');
  $('#deckView').classList.add('hidden');
  $('#loginBtn').disabled = false;
  $('#loginBtn').textContent = signupMode ? 'Crear cuenta' : 'Entrar';
}
function showDeck()  { $('#loginView').classList.add('hidden'); $('#deckView').classList.remove('hidden'); }

$('#switchMode').addEventListener('click', () => {
  signupMode = !signupMode;
  $('#repeatLabel').classList.toggle('hidden', !signupMode);
  $('#repeatPassword').classList.toggle('hidden', !signupMode);
  $('#repeatPassword').required = signupMode;
  $('#loginBtn').textContent = signupMode ? 'Crear cuenta' : 'Entrar';
  $('#switchMode').textContent = signupMode
    ? '¿Ya tienes cuenta? Entrar'
    : '¿No tienes cuenta? Crear cuenta';
  $('#loginError').textContent = '';
});

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const repeat = $('#repeatPassword').value;
  const remember = $('#remember').checked;
  const err = $('#loginError');
  const btn = $('#loginBtn');
  err.textContent = '';

  if (signupMode && password !== repeat) {
    err.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if (signupMode && password.length < 6) {
    err.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    return;
  }

  btn.disabled = true;
  btn.textContent = signupMode ? 'Creando…' : 'Entrando…';
  localStorage.setItem('deck_remember', remember ? '1' : '0');
  localStorage.setItem('deck_email', email);
  try {
    await auth.setPersistence(
      remember ? firebase.auth.Auth.Persistence.LOCAL
               : firebase.auth.Auth.Persistence.SESSION
    );
    if (signupMode) {
      await auth.createUserWithEmailAndPassword(email, password);
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (e) {
    err.textContent = traducirError(e.code);
    btn.disabled = false;
    btn.textContent = signupMode ? 'Crear cuenta' : 'Entrar';
  }
});

function traducirError(code) {
  if (/wrong-password|user-not-found|invalid-credential/.test(code)) return 'Correo o contraseña incorrectos.';
  if (/invalid-email/.test(code)) return 'El correo no es válido.';
  if (/email-already-in-use/.test(code)) return 'Ese correo ya tiene cuenta. Entra con él.';
  if (/weak-password/.test(code)) return 'La contraseña es demasiado débil (mínimo 6 caracteres).';
  if (/too-many-requests/.test(code)) return 'Demasiados intentos. Espera un momento.';
  if (/network/.test(code)) return 'Sin conexión con Firebase.';
  return code || 'Error al entrar';
}

$('#logoutBtn').addEventListener('click', async () => {
  if (presenceTimer) clearInterval(presenceTimer);
  if (deckRef) deckRef.off();
  await auth.signOut();
  state = {};
  showLogin();
});

/* -------------------------- datos -------------------------- */

async function enterDeck(user) {
  uid = user.uid;
  deckRef = db.ref('decks/' + uid);
  await ensureDefaults();
  showDeck();
  applyRole();
  firstSnapshot = true;
  deckRef.on('value', (snap) => {
    state = snap.val() || {};
    if (firstSnapshot) {
      firstSnapshot = false;
      render();
    } else {
      updateSliderValues();
      actualizarPresencia();
      marcarSinAsignar();
      if (role === 'receiver') renderReceiverPanel();
    }
  });
  presenceTimer = setInterval(actualizarPresencia, 2000);
  actualizarPresencia();
  await registerDevice();
}

async function ensureDefaults() {
  const snap = await deckRef.once('value');
  const cur = snap.val() || {};
  const patch = {};
  if (!cur.layout)       patch.layout = DEFAULT_LAYOUT;
  if (!cur.audio)        patch.audio = { master: 0, apps: {} };
  if (!cur.desiredAudio) patch.desiredAudio = { master: 0, apps: {} };
  if (!cur.bindings)     patch.bindings = {};
  if (!cur.presence)     patch.presence = { online: false, lastSeen: 0 };
  if (Object.keys(patch).length) await deckRef.update(patch);
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
  await deckRef.child('trustedDevices').child(deviceId).set({ label, role, lastSeen: Date.now() });
  const bar = $('#deviceBar');
  bar.textContent = '✓ ' + (role === 'sender' ? 'Envío' : 'Recepción') + ' · ' + label;
  bar.classList.remove('hidden');
}

/* -------------------------- rol del dispositivo -------------------------- */

function applyRole() {
  const isSender = role === 'sender';
  $('#roleBtn').textContent = isSender ? '📱 Envío' : '💻 Recepción';
  $('#roleBtn').title = isSender
    ? 'Este dispositivo envía órdenes (Stream Deck / móvil)'
    : 'Este dispositivo recibe órdenes (portátil)';
  $('#grid').classList.toggle('hidden', !isSender);
  $('#deckHint').classList.toggle('hidden', !isSender);
  $('#editBtn').classList.toggle('hidden', !isSender);
  $('#profileSelect').classList.toggle('hidden', !isSender);
  $('#receiverPanel').classList.toggle('hidden', isSender);
  if (!isSender) renderReceiverPanel();
}

$('#roleBtn').addEventListener('click', async () => {
  role = role === 'sender' ? 'receiver' : 'sender';
  localStorage.setItem('deck_role', role);
  applyRole();
  const id = localStorage.getItem('deck_device_id');
  if (deckRef && id) {
    await deckRef.child('trustedDevices').child(id).child('role').set(role);
  }
});

function renderReceiverPanel() {
  const p = state.presence || {};
  const age = p.lastSeen ? Date.now() - p.lastSeen : Infinity;
  const online = age < 15000;
  const st = $('#receiverStatus');
  st.textContent = online
    ? '● Daemon conectado y recibiendo órdenes' + (p.device ? ' en ' + p.device : '')
    : '● Daemon desconectado — arranca python deck_daemon.py en el PC';
  st.classList.toggle('online', online);

  const b = state.bindings || {};
  const host = $('#receiverBindings');
  host.innerHTML = '';
  const ids = Object.keys(b);
  if (!ids.length) {
    host.innerHTML = '<span class="chip">Sin funciones asignadas</span>';
    return;
  }
  ids.forEach((id) => {
    const a = b[id] || {};
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = '<b>' + id + '</b> · ' + (a.type || '?') + (a.value ? ' ' + a.value : '');
    host.appendChild(chip);
  });
}

$('#refreshReceiver').addEventListener('click', renderReceiverPanel);

function currentProfile() {
  const profiles = (state.layout && state.layout.profiles) || DEFAULT_LAYOUT.profiles;
  return profiles[state.layout.active] || profiles[Object.keys(profiles)[0]];
}

/* -------------------------- render -------------------------- */

function render() {
  const grid = $('#grid');
  grid.innerHTML = '';
  (currentProfile().keys || []).forEach((k) => grid.appendChild(makeKey(k)));
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
    const key = (currentProfile().keys || []).find((k) => k.id === el.dataset.id);
    if (!key) return;
    const target = key.target || 'master';
    let val = target === 'master' ? audio.master : (audio.apps || {})[target];
    if (val == null && desiredAudio) {
      val = target === 'master' ? desiredAudio.master : (desiredAudio.apps || {})[target];
    }
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
  await deckRef.child('layout').set(state.layout);
  render();
});

/* -------------------------- acciones -------------------------- */

function sendCommand(keyId) {
  deckRef.child('commands').push({ keyId, t: Date.now() });
  const el = document.querySelector('.key[data-id="' + keyId + '"]');
  if (el) {
    el.style.filter = 'brightness(1.5)';
    setTimeout(() => { el.style.filter = ''; }, 130);
  }
}

function setDesired(target, value) {
  if (!desiredAudio) desiredAudio = JSON.parse(JSON.stringify(state.desiredAudio || {}));
  if (!desiredAudio.apps) desiredAudio.apps = {};
  if (target === 'master') desiredAudio.master = value;
  else desiredAudio.apps[target] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => deckRef.child('desiredAudio').set(desiredAudio), 90);
}

function actualizarPresencia() {
  const el = $('#presence');
  const p = state.presence || {};
  const age = p.lastSeen ? Date.now() - p.lastSeen : Infinity;
  const online = age < 15000;
  el.textContent = online ? '● PC en línea' : '● PC desconectado';
  el.className = 'presence' + (online ? ' online' : '');
  if (!online) $('#deviceBar').classList.add('hidden');
  if (role === 'receiver') renderReceiverPanel();
}

function marcarSinAsignar() {
  const bindings = state.bindings || {};
  document.querySelectorAll('.key').forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    el.style.opacity = Object.prototype.hasOwnProperty.call(bindings, id) ? '1' : '.55';
  });
}

/* -------------------------- editor -------------------------- */

$('#editBtn').addEventListener('click', () => {
  editing = !editing;
  document.body.classList.toggle('editing', editing);
  $('#editBtn').textContent = editing ? 'Listo' : 'Editar';
  render();
});

function openEditor(id) {
  currentKeyId = id;
  const k = id ? (currentProfile().keys || []).find((x) => x.id === id) : null;
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
  $('#targetLabel').classList.toggle('hidden', !isSlider);
  $('#editorForm').elements.target.classList.toggle('hidden', !isSlider);
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
  await deckRef.child('layout').set(state.layout);
  $('#editorDlg').close();
  render();
});

$('#deleteKeyBtn').addEventListener('click', async () => {
  const keys = currentProfile().keys;
  const idx = keys.findIndex((x) => x.id === currentKeyId);
  if (idx >= 0) keys.splice(idx, 1);
  await deckRef.child('layout').set(state.layout);
  $('#editorDlg').close();
  render();
});

boot();
