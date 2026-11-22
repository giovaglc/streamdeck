/* Editor web de la Stream Deck. Se edita con la sesión de Firebase. */

let edLayout = null;
let edBindings = {};
let edPage = null;
let edSaveTimer = null;
let edBindTimer = null;
let edTab = 'controls';
let edDragIndex = null;
let edBindDirty = {};

const ed = (s) => document.querySelector(s);
const edClone = (o) => JSON.parse(JSON.stringify(o));

function edStatus(text, saving) {
  const el = ed('#edStatus');
  el.textContent = text;
  el.classList.toggle('saving', !!saving);
}

function openEditor() {
  if (!deckRef || !state.layout) return;
  edLayout = edClone(state.layout);
  edBindings = edClone(state.bindings || {});
  edBindDirty = {};
  edPage = edLayout.active;
  $('#deckView').classList.add('hidden');
  $('#loginView').classList.add('hidden');
  $('#rotateHint').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  edRenderAll();
  edStatus('Guardado ✓');
}

function closeEditor() {
  $('#editorView').classList.add('hidden');
  $('#deckView').classList.remove('hidden');
  applyRole();
}

function edSave() {
  edStatus('Guardando…', true);
  clearTimeout(edSaveTimer);
  edSaveTimer = setTimeout(async () => {
    await deckRef.child('layout').set(edLayout);
    state.layout = edClone(edLayout);
    edStatus('Guardado ✓');
  }, 250);
}

function edMarkBind(id) {
  edBindDirty[id] = edBindings[id] === undefined ? null : edBindings[id];
}

function edSaveBindings() {
  edStatus('Guardando…', true);
  clearTimeout(edBindTimer);
  edBindTimer = setTimeout(async () => {
    const patch = {};
    Object.keys(edBindDirty).forEach((k) => { patch[k] = edBindDirty[k]; });
    edBindDirty = {};
    if (!Object.keys(patch).length) { edStatus('Guardado ✓'); return; }
    try {
      await deckRef.child('bindings').update(patch);
      if (!state.bindings) state.bindings = {};
      Object.keys(patch).forEach((k) => {
        if (patch[k] === null) { delete state.bindings[k]; delete edBindings[k]; }
        else state.bindings[k] = patch[k];
      });
      edStatus('Guardado ✓');
    } catch (e) {
      edStatus('Error al guardar');
    }
  }, 250);
}

function edKeys() {
  const p = edLayout.profiles[edPage] || { keys: [] };
  if (!Array.isArray(p.keys)) p.keys = [];
  return p.keys;
}

function edRenderAll() {
  edRenderPages();
  edRenderPreview();
  edRenderItems();
  edRenderBindings();
  ed('#edBg').value = edLayout.background || '#0f1115';
  ed('#edBgHex').textContent = edLayout.background || '#0f1115';
}

function edRenderPages() {
  const host = ed('#edPages');
  host.innerHTML = '';
  Object.keys(edLayout.profiles).forEach((name) => {
    const b = document.createElement('div');
    b.className = 'ed-page' + (name === edPage ? ' on' : '');
    b.innerHTML = '<span>' + name + (name === edLayout.active ? ' ●' : '') + '</span>' +
                  '<span class="dot"></span>';
    b.onclick = () => {
      edPage = name;
      edLayout.active = name;
      edSave();
      edRenderAll();
    };
    host.appendChild(b);
  });
}

function edRenderPreview() {
  const host = ed('#edPreview');
  host.innerHTML = '';
  edKeys().forEach((k, idx) => {
    const s = parseInt(k.span, 10) || 1;
    let w = s, h = 1;
    if (k.type === 'slider') { w = s >= 4 ? 2 : 1; h = 2; }
    else if (s === 4) { w = 2; h = 2; }
    const el = document.createElement('div');
    el.className = 'pv';
    let col = parseInt(k.col, 10) || 0;
    let row = parseInt(k.row, 10) || 0;
    if (col) col = Math.max(1, Math.min(col, 8 - w));
    if (row) row = Math.max(1, Math.min(row, 4 - h));
    el.style.gridColumn = col ? col + ' / span ' + w : 'span ' + w;
    el.style.gridRow = row ? row + ' / span ' + h : 'span ' + h;
    el.style.background = k.color || '#34495e';
    el.textContent = k.icon || '';
    el.draggable = true;
    el.dataset.idx = String(idx);
    el.title = 'Arrastra a otra casilla';
    host.appendChild(el);
  });

  // Colocar libremente arrastrando en la vista previa
  let dragIdx = null;
  host.querySelectorAll('.pv').forEach((tile) => {
    tile.addEventListener('dragstart', (ev) => {
      dragIdx = Number(tile.dataset.idx);
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(dragIdx));
    });
  });
  host.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  host.addEventListener('drop', (ev) => {
    ev.preventDefault();
    if (dragIdx === null) return;
    const r = host.getBoundingClientRect();
    const col = Math.max(1, Math.min(7, Math.floor((ev.clientX - r.left) / (r.width / 7)) + 1));
    const row = Math.max(1, Math.min(3, Math.floor((ev.clientY - r.top) / (r.height / 3)) + 1));
    const item = edKeys()[dragIdx];
    if (item) {
      const s = parseInt(item.span, 10) || 1;
      const w = item.type === 'slider' ? (s >= 4 ? 2 : 1) : (s >= 4 ? 2 : (s === 2 ? 2 : 1));
      const h = item.type === 'slider' ? 2 : (s >= 4 ? 2 : 1);
      item.col = Math.max(1, Math.min(col, 8 - w));
      item.row = Math.max(1, Math.min(row, 4 - h));
    }
    dragIdx = null;
    edRenderPreview(); edRenderItems(); edSave();
  });
}

function edRenderItems() {
  const host = ed('#edItems');
  host.innerHTML = '';
  edKeys().forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'ed-item';
    card.draggable = true;
    card.dataset.index = idx;
    card.innerHTML =
      '<div class="top"><span class="ed-handle" title="Arrastra para ordenar">⠿</span>' +
      '<b>' + (item.label || 'Sin nombre') + '</b>' +
      '<button class="ed-move" data-dir="-1" title="Mover a la izquierda">◀</button>' +
      '<button class="ed-move" data-dir="1" title="Mover a la derecha">▶</button>' +
      '<button class="ed-del">✕</button></div>' +
      '<div class="ed-row"><div class="mini" style="background:' + (item.color || '#34495e') + '">' +
      (item.icon || '•') + '</div><input class="ed-label" value="' + (item.label || '') + '" placeholder="Etiqueta"></div>' +
      '<div class="ed-fields">' +
      '<div><label>Tipo</label><select class="f-type"><option value="button">Botón</option><option value="slider">Deslizador</option></select></div>' +
      '<div><label>Icono</label><input class="f-icon" value="' + (item.icon || '') + '" maxlength="8"></div>' +
      '<div><label>Color</label><input class="f-color" type="color" value="' + (item.color || '#3498db') + '"></div>' +
      '<div><label>Objetivo (slider)</label><input class="f-target" value="' + (item.target || 'master') + '"></div>' +
      '<div><label>Columna (0=auto)</label><input class="f-col" type="number" min="0" max="7" value="' + (item.col || 0) + '"></div>' +
      '<div><label>Fila (0=auto)</label><input class="f-row" type="number" min="0" max="3" value="' + (item.row || 0) + '"></div>' +
      '</div>' +
      '<div class="ed-full"><label style="font-size:10px;color:#7d879b">Imagen (URL o archivo)</label>' +
      '<div class="ed-row"><input class="f-image" placeholder="https://…">' +
      '<input class="f-file" type="file" accept="image/*" style="max-width:110px"></div></div>' +
      '<div class="ed-sizes"></div>';
    card.querySelector('.f-image').value = item.image || '';

    const type = card.querySelector('.f-type');
    type.value = item.type || 'button';
    const bind = (sel, field) => {
      const el = card.querySelector(sel);
      el.addEventListener('input', () => {
        item[field] = el.value;
        if (field === 'label') card.querySelector('.top b').textContent = el.value || 'Sin nombre';
        if (field === 'icon' || field === 'color') edRenderPreview();
        edSave();
      });
    };
    bind('.ed-label', 'label');
    bind('.f-icon', 'icon');
    bind('.f-color', 'color');
    bind('.f-target', 'target');
    [['.f-col', 'col'], ['.f-row', 'row']].forEach(([sel, field]) => {
      card.querySelector(sel).addEventListener('input', (ev) => {
        const n = parseInt(ev.target.value, 10) || 0;
        if (n) item[field] = n; else delete item[field];
        edRenderPreview(); edSave();
      });
    });
    bind('.f-image', 'image');

    type.addEventListener('change', () => {
      item.type = type.value;
      if (item.type === 'slider' && (item.span || 1) < 2) item.span = 2;
      edRenderItems(); edRenderPreview(); edSave();
    });

    const sizes = card.querySelector('.ed-sizes');
    [1, 2, 4].forEach((n) => {
      if (item.type === 'slider' && n === 1) return;
      const b = document.createElement('button');
      b.textContent = n === 1 ? '1 cuadrado' : (n === 2 ? '2 cuadrados' : '4 cuadrados');
      if ((item.span || 1) === n) b.className = 'on';
      b.onclick = () => { item.span = n; edRenderItems(); edRenderPreview(); edSave(); };
      sizes.appendChild(b);
    });

    card.querySelector('.f-file').onchange = (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        if (rd.result.length > 300000) { alert('Imagen demasiado grande (máx. ~200 KB). Usa una URL.'); return; }
        item.image = rd.result;
        edRenderItems(); edRenderPreview(); edSave();
      };
      rd.readAsDataURL(f);
    };

    card.querySelector('.ed-del').onclick = () => {
      edKeys().splice(idx, 1);
      edRenderItems(); edRenderPreview(); edSave();
    };

    // Mover con flechas (funciona también en móvil)
    card.querySelectorAll('.ed-move').forEach((btn) => {
      btn.onclick = () => {
        const keys = edKeys();
        const to = idx + Number(btn.dataset.dir);
        if (to < 0 || to >= keys.length) return;
        const [moved] = keys.splice(idx, 1);
        keys.splice(to, 0, moved);
        edRenderItems(); edRenderPreview(); edSave();
      };
    });

    // Arrastrar y soltar para reordenar
    card.addEventListener('dragstart', (ev) => {
      edDragIndex = idx;
      card.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(idx));
    });
    card.addEventListener('dragend', () => {
      edDragIndex = null;
      card.classList.remove('dragging');
      host.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    });
    card.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      card.classList.add('over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', (ev) => {
      ev.preventDefault();
      card.classList.remove('over');
      if (edDragIndex === null || edDragIndex === idx) return;
      const keys = edKeys();
      const [moved] = keys.splice(edDragIndex, 1);
      keys.splice(idx, 0, moved);
      edDragIndex = null;
      edRenderItems(); edRenderPreview(); edSave();
    });

    host.appendChild(card);
  });
}

function edAllControls() {
  const out = [];
  Object.keys(edLayout.profiles).forEach((page) => {
    ((edLayout.profiles[page] || {}).keys || []).forEach((k) => {
      out.push({ id: k.id, label: k.label || '(sin nombre)', page, type: k.type });
    });
  });
  return out;
}

function edRenderBindings() {
  const host = ed('#edBindings');
  host.innerHTML = '';
  const controls = edAllControls();

  const addSel = ed('#edNewBind');
  const old = addSel.value;
  addSel.innerHTML = '<option value="">Elige un botón…</option>';
  controls.filter((c) => !edBindings[c.id]).forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label + ' · ' + c.page;
    addSel.appendChild(o);
  });
  addSel.value = old;

  Object.keys(edBindings).forEach((id) => {
    const b = edBindings[id] || {};
    const row = document.createElement('div');
    row.className = 'ed-bind';
    row.innerHTML =
      '<select class="b-id"></select>' +
      '<select class="b-type"><option>url</option><option>app</option><option>cmd</option>' +
      '<option>volume</option><option>media</option><option>key</option>' +
      '<option>volume_master</option><option>volume_app</option></select>' +
      '<input class="b-value" list="edValHints" value="' + (b.value || '') + '" placeholder="URL, app, tecla…">' +
      '<input class="b-level" value="' + (b.level != null ? b.level : '') + '" placeholder="nivel">' +
      '<button class="ed-del">✕</button>';
    row.querySelector('.b-type').value = b.type || 'url';

    const idSel = row.querySelector('.b-id');
    controls.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.label + ' · ' + c.page;
      idSel.appendChild(o);
    });
    if (!controls.some((c) => c.id === id)) {
      const o = document.createElement('option');
      o.value = id; o.textContent = id + ' (sin control)';
      idSel.appendChild(o);
    }
    idSel.value = id;
    const upd = (sel, field) => row.querySelector(sel).addEventListener('input', (ev) => {
      if (field === 'id') return;
      b[field] = ev.target.value;
      edMarkBind(id);
      edSaveBindings();
    });
    upd('.b-value', 'value');
    upd('.b-level', 'level');
    row.querySelector('.b-type').addEventListener('change', (ev) => {
      b.type = ev.target.value;
      edMarkBind(id);
      edSaveBindings();
    });
    row.querySelector('.b-id').addEventListener('change', (ev) => {
      const nid = ev.target.value.trim();
      if (!nid || nid === id) return;
      delete edBindings[id];
      edBindings[nid] = b;
      edBindDirty[id] = null;
      edBindDirty[nid] = b;
      edSaveBindings(); edRenderBindings();
    });
    row.querySelector('.ed-del').onclick = () => {
      delete edBindings[id];
      edBindDirty[id] = null;
      edSaveBindings(); edRenderBindings();
    };
    host.appendChild(row);
  });
}

/* ---------------- eventos ---------------- */

$('#editBtn').onclick = () => openEditor();
$('#edBack').onclick = () => closeEditor();
$('#edLogout').onclick = () => { $('#editorView').classList.add('hidden'); showLogin(); auth.signOut(); };

document.querySelectorAll('.ed-tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.ed-tabs button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    edTab = btn.dataset.tab;
    ['controls', 'bindings', 'account'].forEach((t) => {
      $('#tab-' + t).classList.toggle('hidden', t !== edTab);
    });
  };
});

$('#edAddPage').onclick = () => {
  const name = $('#edNewPage').value.trim();
  if (!name || edLayout.profiles[name]) return;
  edLayout.profiles[name] = { keys: [] };
  edPage = name; edLayout.active = name;
  $('#edNewPage').value = '';
  edSave(); edRenderAll();
};
$('#edRenamePage').onclick = () => {
  const name = prompt('Nuevo nombre', edPage);
  if (!name || edLayout.profiles[name]) return;
  edLayout.profiles[name] = edLayout.profiles[edPage];
  delete edLayout.profiles[edPage];
  edPage = name;
  if (edLayout.active === edPage) edLayout.active = name;
  edSave(); edRenderAll();
};
$('#edDeletePage').onclick = () => {
  if (Object.keys(edLayout.profiles).length <= 1) return alert('Debe quedar al menos una página');
  if (!confirm('¿Borrar la página ' + edPage + '?')) return;
  delete edLayout.profiles[edPage];
  edPage = Object.keys(edLayout.profiles)[0];
  edLayout.active = edPage;
  edSave(); edRenderAll();
};

const PRESETS = ['#0f1115', '#10131a', '#1b1030', '#0d1f24', '#2a1015', '#f2f2f2'];
PRESETS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = c;
  b.onclick = () => { edLayout.background = c; ed('#edBg').value = c; ed('#edBgHex').textContent = c; edSave(); };
  ed('#edPresets').appendChild(b);
});
$('#edBg').oninput = (ev) => {
  edLayout.background = ev.target.value;
  ed('#edBgHex').textContent = ev.target.value;
  edSave();
};

function edNewItem(type) {
  return { id: 'k' + Date.now(), type, label: type === 'slider' ? 'Volumen' : 'Nuevo botón',
    icon: type === 'slider' ? '🔊' : '⭐', color: type === 'slider' ? '#2980b9' : '#6366f1',
    image: '', target: 'master', span: type === 'slider' ? 2 : 1 };
}
$('#edAddButton').onclick = () => {
  const item = edNewItem('button');
  edKeys().push(item);
  edBindings[item.id] = { type: 'url', value: '' };
  edMarkBind(item.id);
  edSaveBindings();
  edRenderItems(); edRenderPreview(); edSave();
};
$('#edAddSlider').onclick = () => {
  const item = edNewItem('slider');
  edKeys().push(item);
  edBindings[item.id] = { type: 'volume_master' };
  edMarkBind(item.id);
  edSaveBindings();
  edRenderItems(); edRenderPreview(); edSave();
};

$('#edAddBind').onclick = () => {
  const id = $('#edNewBind').value.trim();
  if (!id) return;
  edBindings[id] = { type: 'url', value: '' };
  $('#edNewBind').value = '';
  edMarkBind(id);
  edRenderBindings(); edSaveBindings();
};

$('#edChangePass').onclick = async () => {
  const cur = $('#edCurrentPass').value;
  const nw = $('#edNewPass').value;
  const rep = $('#edRepeatPass').value;
  const msg = $('#edPassMsg');
  if (nw.length < 6) { msg.textContent = 'Mínimo 6 caracteres.'; return; }
  if (nw !== rep) { msg.textContent = 'Las nuevas no coinciden.'; return; }
  try {
    const user = auth.currentUser;
    await user.reauthenticateWithCredential(
      firebase.auth.EmailAuthProvider.credential(user.email, cur)
    );
    await user.updatePassword(nw);
    msg.style.color = '#7fe0a8';
    msg.textContent = '✓ Contraseña cambiada. El portátil sigue conectado con su token.';
    ['#edCurrentPass', '#edNewPass', '#edRepeatPass'].forEach((s) => { $(s).value = ''; });
  } catch (e) {
    msg.textContent = /wrong-password/.test(e.code) ? 'Contraseña actual incorrecta.' : (e.message || 'Error');
  }
};
