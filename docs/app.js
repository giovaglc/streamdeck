/* Stream Deck - móvil: solo muestra lo que publica el PC (Firebase RTDB) */

const CFG = window.DECK_CONFIG;
firebase.initializeApp(CFG);
const auth = firebase.auth();
const db = firebase.database();

let uid = null;
let deckRef = null;
let state = {};
let role = localStorage.getItem('deck_role') || detectRole();
let signupMode = false;
let firstSnapshot = true;
let layoutSig = '';
let saveTimer = null;
let presenceTimer = null;

const $ = (s) => document.querySelector(s);

function safeKey(s) {
  return String(s).trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_');
}

function detectRole() {
  return /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'sender' : 'receiver';
}

const DEFAULT_LAYOUT = {
  background: '#0f1115',
  active: 'Stream',
  profiles: {
    Stream: {
      keys: [
        { id: 'youtube', type: 'button', label: 'YouTube', icon: '▶️', color: '#ff0033', image: '', span: 1 },
        { id: 'spotify', type: 'button', label: 'Spotify', icon: '🎵', color: '#1db954', image: '', span: 1 },
        { id: 'playpause', type: 'button', label: 'Play/Pausa', icon: '⏯️', color: '#8e44ad', image: '', span: 1 },
        { id: 'master', type: 'slider', label: 'Volumen', icon: '🔊', color: '#2980b9', image: '', target: 'master', span: 2 },
        { id: 'sp_vol', type: 'slider', label: 'Spotify', icon: '🎵', color: '#1db954', image: '', target: 'Spotify.exe', span: 2 },
        { id: 'explorer', type: 'button', label: 'Archivos', icon: '📁', color: '#f39c12', image: '', span: 1 },
        { id: 'mute', type: 'button', label: 'Silenciar', icon: '🔇', color: '#7f8c8d', image: '', span: 1 },
        { id: 'lock', type: 'button', label: 'Bloquear', icon: '🔒', color: '#c0392b', image: '', span: 1 }
      ]
    }
  }
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
  $('#rotateHint').classList.add('hidden');
  $('#loginBtn').disabled = false;
  $('#loginBtn').textContent = signupMode ? 'Crear cuenta' : 'Entrar';
}

$('#switchMode').addEventListener('click', () => {
  signupMode = !signupMode;
  $('#repeatLabel').classList.toggle('hidden', !signupMode);
  $('#repeatPassword').classList.toggle('hidden', !signupMode);
  $('#repeatPassword').required = signupMode;
  $('#loginBtn').textContent = signupMode ? 'Crear cuenta' : 'Entrar';
  $('#switchMode').textContent = signupMode
    ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear cuenta';
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

  if (signupMode && password !== repeat) { err.textContent = 'Las contraseñas no coinciden.'; return; }
  if (signupMode && password.length < 6) { err.textContent = 'Mínimo 6 caracteres.'; return; }

  btn.disabled = true;
  btn.textContent = signupMode ? 'Creando…' : 'Entrando…';
  localStorage.setItem('deck_remember', remember ? '1' : '0');
  localStorage.setItem('deck_email', email);
  try {
    await auth.setPersistence(
      remember ? firebase.auth.Auth.Persistence.LOCAL
               : firebase.auth.Auth.Persistence.SESSION
    );
    if (signupMode) await auth.createUserWithEmailAndPassword(email, password);
    else await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    err.textContent = traducirError(e.code);
    btn.disabled = false;
    btn.textContent = signupMode ? 'Crear cuenta' : 'Entrar';
  }
});

function traducirError(code) {
  if (/wrong-password|user-not-found|invalid-credential/.test(code)) return 'Correo o contraseña incorrectos.';
  if (/invalid-email/.test(code)) return 'El correo no es válido.';
  if (/email-already-in-use/.test(code)) return 'Ese correo ya tiene cuenta.';
  if (/weak-password/.test(code)) return 'Contraseña demasiado débil (mín. 6).';
  if (/too-many-requests/.test(code)) return 'Demasiados intentos. Espera.';
  if (/network/.test(code)) return 'Sin conexión con Firebase.';
  return code || 'Error al entrar';
}

/* -------------------------- datos -------------------------- */

async function enterDeck(user) {
  uid = user.uid;
  const email = user.email || '';
  $('#accountBadge').textContent = email;
  $('#accountWarn').classList.add('hidden');
  deckRef = db.ref('decks/' + uid);
  await ensureDefaults();
  showDeck();
  applyRole();
  firstSnapshot = true;
  layoutSig = '';
  deckRef.on('value', (snap) => {
    state = snap.val() || {};
    const sig = JSON.stringify(state.layout || {});
    if (firstSnapshot || sig !== layoutSig) {
      firstSnapshot = false;
      layoutSig = sig;
      render();
    } else {
      updateSliderValues();
      actualizarPresencia();
      if (role === 'receiver') renderReceiverPanel();
    }
  });
  presenceTimer = setInterval(actualizarPresencia, 2000);
  actualizarPresencia();
  await registerDevice();
}

function showDeck() {
  $('#loginView').classList.add('hidden');
  $('#deckView').classList.remove('hidden');
}

async function ensureDefaults() {
  const snap = await deckRef.once('value');
  const cur = snap.val() || {};
  const patch = {};
  if (!cur.layout) patch.layout = DEFAULT_LAYOUT;
  if (!cur.audio) patch.audio = { master: 0, apps: {} };
  if (!cur.desiredAudio) patch.desiredAudio = { master: 0, apps: {} };
  if (!cur.bindings) patch.bindings = {};
  if (!cur.presence) patch.presence = { online: false, lastSeen: 0 };
  if (Object.keys(patch).length) await deckRef.update(patch);
}

async function registerDevice() {
  let id = localStorage.getItem('deck_device_id');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || ('dev-' + Math.random().toString(36).slice(2));
    localStorage.setItem('deck_device_id', id);
  }
  const ua = navigator.userAgent;
  const label = /iPhone|iPad/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : 'Navegador';
  await deckRef.child('trustedDevices').child(id).set({ label, role, lastSeen: Date.now() });
}

/* -------------------------- render -------------------------- */

function getSpan(k) {
  let s = parseInt(k.span, 10);
  if (![1, 2, 4].includes(s)) s = 1;
  if (k.type === 'slider' && s < 2) s = 2;
  return s;
}

function render() {
  const layout = state.layout || {};
  const bg = layout.background || '#0f1115';
  document.body.style.setProperty('--bg', bg);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);

  const profiles = layout.profiles || {};
  const active = layout.active || Object.keys(profiles)[0] || 'Stream';
  $('#pageName').textContent = active;
  const keys = currentKeys();

  const grid = $('#grid');
  grid.innerHTML = '';
  keys.forEach((k) => grid.appendChild(makeKey(k)));
  cellSize();
  requestAnimationFrame(sizeSliders);
  setTimeout(sizeSliders, 60);
}

function cellSize() {
  const cols = 7, rows = 3, gap = 6, pad = 12, topbar = 42;
  const availW = window.innerWidth - pad - gap * (cols - 1);
  const availH = window.innerHeight - topbar - pad - gap * (rows - 1);
  const cell = Math.max(40, Math.floor(Math.min(availW / cols, availH / rows)));
  document.documentElement.style.setProperty('--cell', cell + 'px');
}

function makeKey(k) {
  const s = getSpan(k);
  let w, h;
  if (k.type === 'slider') { w = s >= 4 ? 2 : 1; h = 2; }
  else { w = s >= 4 ? 2 : (s === 2 ? 2 : 1); h = s >= 4 ? 2 : 1; }

  const el = document.createElement('div');
  el.className = 'key' + (k.type === 'slider' ? ' slider' : '');
  el.style.setProperty('--w', w);
  el.style.setProperty('--h', h);
  el.style.background = k.color || '#34495e';

  if (k.image && k.image.length < 500000) {
    const img = document.createElement('img');
    img.className = 'keyimg';
    img.src = k.image;
    el.appendChild(img);
  }

  const content = document.createElement('div');
  content.className = 'keycontent';

  if (k.type === 'slider') {
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = k.icon || '🔊';
    const wrap = document.createElement('div');
    wrap.className = 'vslider';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.dataset.target = k.target || 'master';
    input.dataset.id = k.id;
    input.addEventListener('input', () => {
      lbl.textContent = (k.label || '') + ' ' + input.value + '%';
      setDesired(input.dataset.target, Number(input.value));
    });
    input.addEventListener('pointerdown', () => { input.dataset.dragging = '1'; });
    const end = () => { delete input.dataset.dragging; };
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
    wrap.appendChild(input);
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = k.label || '';
    content.append(ico, wrap, lbl);
    el.appendChild(content);
    requestAnimationFrame(sizeSliders);
  } else {
    content.innerHTML = '<span class="ico">' + (k.icon || '') + '</span>' +
                        '<span class="lbl">' + (k.label || '') + '</span>';
    el.appendChild(content);
    el.onclick = () => sendCommand(k.id);
  }
  return el;
}

function sizeSliders() {
  document.querySelectorAll('.vslider').forEach((wrap) => {
    const input = wrap.querySelector('input');
    if (input) input.style.width = Math.max(40, wrap.clientHeight) + 'px';
  });
}
window.addEventListener('resize', () => { cellSize(); sizeSliders(); checkOrientation(); });

function updateSliderValues() {
  const audio = state.audio || {};
  const desired = state.desiredAudio || {};
  document.querySelectorAll('.vslider input').forEach((input) => {
    const t = input.dataset.target;
    const key = safeKey(t);
    let v = t === 'master' ? audio.master : (audio.apps || {})[key];
    if (v == null) v = t === 'master' ? desired.master : (desired.apps || {})[key];
    if (v == null) v = 0;
    if (!input.dataset.dragging) {
      input.value = Math.round(v);
      const lbl = input.closest('.key').querySelector('.lbl');
      if (lbl && lbl.textContent.includes('%')) {
        const name = (currentKeys().find((k) => k.id === input.dataset.id) || {}).label || '';
        lbl.textContent = name + ' ' + Math.round(v) + '%';
      }
    }
  });
}

function currentKeys() {
  const layout = state.layout || {};
  const profiles = layout.profiles || {};
  const active = layout.active || Object.keys(profiles)[0];
  const raw = (profiles[active] || {}).keys || [];
  if (Array.isArray(raw)) return raw;
  return Object.keys(raw)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => raw[k])
    .filter((x) => x && typeof x === 'object');
}

function sendCommand(keyId) {
  deckRef.child('commands').push({ keyId, t: Date.now() });
}

function setDesired(target, value) {
  if (!state.desiredAudio) state.desiredAudio = { master: 0, apps: {} };
  if (!state.desiredAudio.apps) state.desiredAudio.apps = {};
  if (target === 'master') state.desiredAudio.master = value;
  else state.desiredAudio.apps[safeKey(target)] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    deckRef.child('desiredAudio').set(state.desiredAudio);
  }, 90);
}

/* -------------------------- rol / receptor -------------------------- */

function applyRole() {
  const isSender = role === 'sender';
  $('#roleBtn').textContent = isSender ? '📱 Envío' : '💻 Recepción';
  $('#grid').classList.toggle('hidden', !isSender);
  $('#receiverPanel').classList.toggle('hidden', isSender);
  if (!isSender) renderReceiverPanel();
  checkOrientation();
}

$('#roleBtn').addEventListener('click', async () => {
  role = role === 'sender' ? 'receiver' : 'sender';
  localStorage.setItem('deck_role', role);
  applyRole();
  const id = localStorage.getItem('deck_device_id');
  if (deckRef && id) await deckRef.child('trustedDevices').child(id).child('role').set(role);
});

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  const deckVisible = !$('#deckView').classList.contains('hidden');
  const show = role === 'sender' && deckVisible && portrait;
  $('#rotateHint').classList.toggle('hidden', !show);
}
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 150));

function actualizarPresencia() {
  const p = state.presence || {};
  const age = p.lastSeen ? Date.now() - p.lastSeen : Infinity;
  const online = age < 15000;
  const el = $('#presence');
  el.textContent = online ? '● PC' : '● PC apagado';
  el.classList.toggle('online', online);
  if (role === 'receiver') renderReceiverPanel();
}

function renderReceiverPanel() {
  const p = state.presence || {};
  const age = p.lastSeen ? Date.now() - p.lastSeen : Infinity;
  const online = age < 15000;
  const st = $('#receiverStatus');
  st.textContent = online
    ? '● PC conectado' + (p.device ? ' · ' + p.device : '')
    : '● PC desconectado — ejecuta «Conectar PC.bat» en el portátil';
  st.classList.toggle('online', online);

  const b = state.bindings || {};
  const host = $('#receiverBindings');
  host.innerHTML = '';
  const ids = Object.keys(b);
  if (!ids.length) { host.innerHTML = '<span class="chip">Sin funciones</span>'; return; }
  ids.forEach((id) => {
    const a = b[id] || {};
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = '<b>' + id + '</b> · ' + (a.type || '?');
    host.appendChild(chip);
  });
}

/* -------------------------- ajustes -------------------------- */

$('#settingsBtn').onclick = async () => {
  applyRole();
  if (deckRef) {
    const snap = await deckRef.child('settings/configPath').once('value');
    $('#batPath').value = snap.val() || localStorage.getItem('deck_config_path') || '';
  }
  $('#settingsDlg').showModal();
};

$('#saveBatPath').onclick = async () => {
  const path = $('#batPath').value.trim();
  if (!path) return;
  localStorage.setItem('deck_config_path', path);
  if (deckRef) await deckRef.child('settings/configPath').set(path);
};

$('#runBatBtn').onclick = () => {
  const path = $('#batPath').value.trim() || localStorage.getItem('deck_config_path') || '';
  const url = 'streamdeck://connect' + (path ? '?config=' + encodeURIComponent(path) : '');
  window.location.href = url;
};
$('#closeSettings').onclick = () => $('#settingsDlg').close();

$('#changePass').onclick = async () => {
  const cur = $('#currentPass').value;
  const nw = $('#newPass').value;
  const rep = $('#repeatPass').value;
  const msg = $('#passMsg');
  msg.style.color = '';
  if (nw.length < 6) { msg.textContent = 'Mínimo 6 caracteres.'; return; }
  if (nw !== rep) { msg.textContent = 'Las nuevas no coinciden.'; return; }
  try {
    const user = auth.currentUser;
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(nw);
    msg.style.color = '#7fe0a8';
    msg.textContent = '✓ Contraseña cambiada. Actualiza pc/config.json o usa el editor del PC.';
    ['#currentPass', '#newPass', '#repeatPass'].forEach((s) => { $(s).value = ''; });
  } catch (e) {
    msg.textContent = /wrong-password/.test(e.code)
      ? 'Contraseña actual incorrecta.' : (e.message || 'Error');
  }
};

$('#logoutBtn').onclick = async () => {
  if (presenceTimer) clearInterval(presenceTimer);
  if (deckRef) deckRef.off();
  await auth.signOut();
  state = {};
  $('#settingsDlg').close();
  showLogin();
};

boot();
