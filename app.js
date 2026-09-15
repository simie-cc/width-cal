/* app.js — 寬度配置工具 */
'use strict';

// ═══════════════════════════════════════════════════════
// 狀態模型
// ═══════════════════════════════════════════════════════
/** @type {{ totalWidthCm: number, objects: ObjState[], editing: string|null, dragging: DragState|null }} */
const state = {
  totalWidthCm: 0,
  objects: [],       // sorted by centerCm ascending
  editing: null,     // id of object being edited
  dragging: null,
};

/**
 * @typedef {{ id: string, centerCm: number, widthCm: number }} ObjState
 * @typedef {{ id: string, startX: number, origCenter: number, didMove: boolean }} DragState
 */

let _nextId = 1;
function genId() { return 'obj-' + (_nextId++); }

// ═══════════════════════════════════════════════════════
// DOM 參考
// ═══════════════════════════════════════════════════════
const setupScreen      = document.getElementById('setup-screen');
const measureScreen    = document.getElementById('measure-screen');
const totalWidthInput  = document.getElementById('total-width-input');
const totalWidthError  = document.getElementById('total-width-error');
const confirmBtn       = document.getElementById('confirm-btn');
const totalWidthDisplay= document.getElementById('total-width-display');
const changeWidthBtn   = document.getElementById('change-width-btn');
const statusMsg        = document.getElementById('status-msg');
const rulerTrack       = document.getElementById('ruler-track');
const objectsLayer     = document.getElementById('objects-layer');
const labelsTop        = document.getElementById('labels-top');
const labelsBottom     = document.getElementById('labels-bottom');
const inlineEditor     = document.getElementById('inline-editor');
const editWidthInput   = document.getElementById('edit-width-input');
const editLabelInput   = document.getElementById('edit-label-input');
const editError        = document.getElementById('edit-error');
const rulerWrapper     = document.getElementById('ruler-wrapper');
const shareBtn         = document.getElementById('share-btn');

// ═══════════════════════════════════════════════════════
// 單位換算
// ═══════════════════════════════════════════════════════
/** 取量測線像素寬（ruler-track 的 offsetWidth） */
function getRulerPxWidth() {
  return rulerTrack.offsetWidth;
}

/** cm → px（相對量測線左緣） */
function cmToPx(cm) {
  return (cm / state.totalWidthCm) * getRulerPxWidth();
}

/** px → cm（相對量測線左緣） */
function pxToCm(px) {
  return (px / getRulerPxWidth()) * state.totalWidthCm;
}

// ═══════════════════════════════════════════════════════
// 幾何計算
// ═══════════════════════════════════════════════════════
/**
 * 回傳已排序物件列表的各段資訊。
 * 每段包含 { startCm, endCm, widthCm, type: 'gap'|'left-over'|'right-over' }
 * - 左端段（startCm=0 → 第一物件左緣）若 widthCm < 0 → left-over
 * - 右端段（最後物件右緣 → totalWidthCm）若 widthCm < 0 → right-over
 * - 中間段永遠為 gap（物件間距，本工具保證不重疊所以 ≥ 0）
 */
function computeSegments() {
  const objs = state.objects;
  const total = state.totalWidthCm;
  const segments = [];

  if (objs.length === 0) return segments;

  // 左端段
  const firstLeft = objs[0].centerCm - objs[0].widthCm / 2;
  segments.push({
    startCm: 0,
    endCm: firstLeft,
    widthCm: firstLeft,
    type: firstLeft < 0 ? 'left-over' : 'gap',
  });

  // 相鄰物件之間
  for (let i = 0; i < objs.length - 1; i++) {
    const rightEdge = objs[i].centerCm + objs[i].widthCm / 2;
    const nextLeft  = objs[i + 1].centerCm - objs[i + 1].widthCm / 2;
    segments.push({
      startCm: rightEdge,
      endCm: nextLeft,
      widthCm: nextLeft - rightEdge,
      type: 'gap',
    });
  }

  // 右端段
  const lastRight = objs[objs.length - 1].centerCm + objs[objs.length - 1].widthCm / 2;
  segments.push({
    startCm: lastRight,
    endCm: total,
    widthCm: total - lastRight,
    type: lastRight > total ? 'right-over' : 'gap',
  });

  return segments;
}

/** 排序物件（按 centerCm 遞增） */
function sortObjects() {
  state.objects.sort((a, b) => a.centerCm - b.centerCm);
}

/** 檢查新物件（centerCm, widthCm）是否與現有物件重疊。
 *  若提供 excludeId 則跳過該物件（用於編輯 / 拖曳時的自我排除）。
 *  @returns {boolean} true = 重疊
 */
function hasOverlap(centerCm, widthCm, excludeId = null) {
  const newLeft  = centerCm - widthCm / 2;
  const newRight = centerCm + widthCm / 2;
  for (const obj of state.objects) {
    if (obj.id === excludeId) continue;
    const left  = obj.centerCm - obj.widthCm / 2;
    const right = obj.centerCm + obj.widthCm / 2;
    // 重疊條件：兩區間互相侵入（允許恰好相鄰）
    if (newLeft < right - 1e-9 && newRight > left + 1e-9) return true;
  }
  return false;
}

/** 格式化公分數值，≥ 1cm 保留 1 位小數，< 1cm 保留 2 位 */
function fmtCm(cm) {
  const abs = Math.abs(cm);
  if (abs >= 10)  return cm.toFixed(1);
  if (abs >= 1)   return cm.toFixed(1);
  return cm.toFixed(2);
}

// ═══════════════════════════════════════════════════════
// LocalStorage 持久化
// ═══════════════════════════════════════════════════════
const STORAGE_KEY = 'width-cal-state';

/** 將目前狀態序列化並存入 localStorage */
function saveToStorage() {
  try {
    const data = {
      totalWidthCm: state.totalWidthCm,
      objects: state.objects.map(o => ({
        id:       o.id,
        centerCm: o.centerCm,
        widthCm:  o.widthCm,
        label:    o.label || '',
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* localStorage 不可用時靜默失敗 */ }
}

/**
 * 從 localStorage 讀取並恢復狀態。
 * @returns {boolean} 是否成功恢復
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data.totalWidthCm !== 'number' || data.totalWidthCm <= 0) return false;
    if (!Array.isArray(data.objects)) return false;
    state.totalWidthCm = data.totalWidthCm;
    state.objects = data.objects.map(o => ({
      id:       String(o.id),
      centerCm: Number(o.centerCm),
      widthCm:  Number(o.widthCm),
      label:    typeof o.label === 'string' ? o.label : '',
    })).filter(o => o.widthCm > 0 && isFinite(o.centerCm));
    sortObjects();
    // 確保 _nextId 不與恢復的 id 衝突
    for (const o of state.objects) {
      const n = parseInt(o.id.replace('obj-', ''), 10);
      if (!isNaN(n) && n >= _nextId) _nextId = n + 1;
    }
    return true;
  } catch (_) { return false; }
}

// ═══════════════════════════════════════════════════════
// URL 分享
// ═══════════════════════════════════════════════════════
/**
 * 將目前狀態序列化為 URL query string 並回傳完整 URL。
 * 格式：?t=200&o=100.0_40.0&o=50.0_30.0
 * （centerCm 與 widthCm 以底線分隔，每個物件一個 o 參數）
 */
function buildShareUrl() {
  const params = new URLSearchParams();
  params.set('t', state.totalWidthCm.toString());
  for (const obj of state.objects) {
    // 格式：centerCm_widthCm|label（label 可空）
    const labelPart = obj.label ? '|' + encodeURIComponent(obj.label) : '';
    params.append('o', `${obj.centerCm}_${obj.widthCm}${labelPart}`);
  }
  const base = location.href.split('?')[0];
  return base + '?' + params.toString();
}

/**
 * 從目前 URL 的 query params 嘗試恢復狀態。
 * @returns {boolean} 是否成功
 */
function loadFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    const t = parseFloat(params.get('t') || '');
    if (!t || t <= 0 || !isFinite(t)) return false;

    const objParams = params.getAll('o');
    const objects = [];
    for (const raw of objParams) {
      // 格式：centerCm_widthCm 或 centerCm_widthCm|label
      const pipeIdx  = raw.indexOf('|');
      const numPart  = pipeIdx === -1 ? raw : raw.slice(0, pipeIdx);
      const labelRaw = pipeIdx === -1 ? '' : raw.slice(pipeIdx + 1);
      const parts = numPart.split('_');
      if (parts.length !== 2) continue;
      const centerCm = parseFloat(parts[0]);
      const widthCm  = parseFloat(parts[1]);
      if (!isFinite(centerCm) || !isFinite(widthCm) || widthCm <= 0) continue;
      objects.push({ id: genId(), centerCm, widthCm, label: decodeURIComponent(labelRaw) });
    }

    state.totalWidthCm = t;
    state.objects = objects;
    sortObjects();
    return true;
  } catch (_) { return false; }
}

/** 複製連結到剪貼簿並更新按鈕文字 */
function handleShare() {
  const url = buildShareUrl();
  navigator.clipboard.writeText(url).then(() => {
    shareBtn.textContent = '✓ 已複製';
    shareBtn.classList.add('share-btn--copied');
    setTimeout(() => {
      shareBtn.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1a2.5 2.5 0 1 1-1.88 4.14L6.44 7.93a2.5 2.5 0 0 1 0 .14l5.18 2.79a2.5 2.5 0 1 1-.72 1.34L5.72 9.41a2.5 2.5 0 1 1 0-2.82l5.18-2.79A2.5 2.5 0 0 1 13.5 1z"/></svg>複製連結`;
      shareBtn.classList.remove('share-btn--copied');
    }, 2000);
  }).catch(() => {
    // Clipboard API 不可用（如 file:// 協定）：顯示 URL 讓使用者手動複製
    showStatus('請手動複製：' + url, 0);
  });
}

// ═══════════════════════════════════════════════════════
// 渲染
// ═══════════════════════════════════════════════════════
function render() {
  renderObjects();
  renderLabels();
  saveToStorage();
}

function renderObjects() {
  objectsLayer.innerHTML = '';
  const total = state.totalWidthCm;

  for (const obj of state.objects) {
    const leftCm  = obj.centerCm - obj.widthCm / 2;
    const rightCm = obj.centerCm + obj.widthCm / 2;
    const isOver  = leftCm < -1e-9 || rightCm > total + 1e-9;

    const leftPx  = cmToPx(leftCm);
    const widthPx = cmToPx(obj.widthCm);

    const el = document.createElement('div');
    el.className = 'obj-rect ' + (isOver ? 'obj-rect--over' : 'obj-rect--normal');
    el.id = 'rect-' + obj.id;
    el.style.left  = leftPx + 'px';
    el.style.width = Math.max(widthPx, 4) + 'px';
    el.setAttribute('data-id', obj.id);
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${obj.label ? obj.label + '，' : ''}物件 ${fmtCm(obj.widthCm)} cm${isOver ? '（越界）' : ''}`);
    el.title = `${obj.label ? obj.label + '\n' : ''}寬度：${fmtCm(obj.widthCm)} cm${isOver ? '（越界）' : ''}`;

    // 物件內容：上方註解（若有）+ 下方寬度
    const inner = document.createElement('div');
    inner.className = 'obj-inner';

    if (obj.label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'obj-label-text';
      labelEl.textContent = obj.label;
      if (widthPx < 38) {
        labelEl.setAttribute('aria-hidden', 'true');
        labelEl.style.visibility = 'hidden';
      }
      inner.appendChild(labelEl);
    }

    const widthSpan = document.createElement('span');
    widthSpan.className = 'obj-width-label';
    widthSpan.textContent = fmtCm(obj.widthCm) + ' cm';
    if (widthPx < 38) {
      widthSpan.setAttribute('aria-hidden', 'true');
      widthSpan.style.visibility = 'hidden';
    }
    inner.appendChild(widthSpan);
    el.appendChild(inner);

    // 事件：pointer（拖曳） / dblclick（編輯）在後面統一綁定
    objectsLayer.appendChild(el);
  }
}

function renderLabels() {
  labelsTop.innerHTML    = '';
  labelsBottom.innerHTML = '';

  if (state.objects.length === 0) return;

  const segments = computeSegments();
  const total    = state.totalWidthCm;
  const pxWidth  = getRulerPxWidth();

  /** 判斷兩個標籤是否在水平方向碰撞（各自以 centerPx 為準，估計寬度 60px） */
  const LABEL_W = 56; // px estimate
  const placed  = []; // [{cx, text}]

  function placeSafe(cx, text, row) {
    // 檢查是否與已放置標籤碰撞
    for (const p of placed) {
      if (Math.abs(p.cx - cx) < LABEL_W + 4) return; // 跳過，太擠
    }
    placed.push({ cx, text });
    const el = document.createElement('span');
    el.className = row === 'top' ? 'seg-label' : 'over-label';
    el.style.left = cx + 'px';
    el.textContent = text;
    el.title = text;
    (row === 'top' ? labelsTop : labelsBottom).appendChild(el);
  }

  for (const seg of segments) {
    if (seg.type === 'gap') {
      // 正常間距：顯示在上方，置中於區段
      const cx = cmToPx((seg.startCm + seg.endCm) / 2);
      const text = fmtCm(seg.widthCm) + ' cm';
      placeSafe(cx, text, 'top');
    } else if (seg.type === 'left-over') {
      // 左越界：下方顯示「超出 X cm」（錨在 left=0 即線左端）
      const overCm = -seg.widthCm; // positive amount
      const cx = 0;
      const text = '超出 ' + fmtCm(overCm) + ' cm';
      placeSafe(cx, text, 'bottom');
    } else if (seg.type === 'right-over') {
      // 右越界：下方顯示「超出 X cm」（錨在 px=pxWidth 即線右端）
      const overCm = seg.startCm - total;
      const cx = pxWidth;
      const text = '超出 ' + fmtCm(overCm) + ' cm';
      placeSafe(cx, text, 'bottom');
    }
  }

  // 每個物件的寬度標籤已在 obj-rect 內部；此處額外在 labels-top 補充
  // 正常物件的中心寬度（若物件寬度標籤因太窄而隱藏則在上方補充）
  for (const obj of state.objects) {
    const widthPx = cmToPx(obj.widthCm);
    if (widthPx >= 38) continue; // 物件內部已顯示，不重複
    const cx = cmToPx(obj.centerCm);
    placeSafe(cx, fmtCm(obj.widthCm) + ' cm', 'top');
  }
}

// ═══════════════════════════════════════════════════════
// 總寬設定
// ═══════════════════════════════════════════════════════
function validateTotalWidth(raw) {
  const v = parseFloat(raw);
  if (raw === '' || raw === null || isNaN(v)) return { ok: false, msg: '請輸入有效數字' };
  if (v <= 0) return { ok: false, msg: '總寬必須大於 0' };
  return { ok: true, value: v };
}

function applyTotalWidth() {
  const result = validateTotalWidth(totalWidthInput.value);
  if (!result.ok) {
    totalWidthError.textContent = result.msg;
    totalWidthInput.setAttribute('aria-invalid', 'true');
    totalWidthInput.focus();
    return;
  }
  totalWidthError.textContent = '';
  totalWidthInput.removeAttribute('aria-invalid');

  state.totalWidthCm = result.value;
  // 清除物件（改總寬視為重設）
  state.objects = [];
  state.editing = null;
  state.dragging = null;

  totalWidthDisplay.textContent = fmtCm(state.totalWidthCm);

  setupScreen.classList.add('hidden');
  measureScreen.classList.remove('hidden');
  render();
  clearStatus();
}

function returnToSetup() {
  closeEditor();
  measureScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  totalWidthInput.value = state.totalWidthCm > 0
    ? state.totalWidthCm.toString()
    : '';
  totalWidthError.textContent = '';
  totalWidthInput.removeAttribute('aria-invalid');
  totalWidthInput.focus();
  totalWidthInput.select();
}

// ═══════════════════════════════════════════════════════
// 狀態訊息
// ═══════════════════════════════════════════════════════
let _statusTimer = null;
function showStatus(msg, durationMs = 3000) {
  statusMsg.textContent = msg;
  clearTimeout(_statusTimer);
  if (durationMs > 0) {
    _statusTimer = setTimeout(clearStatus, durationMs);
  }
}
function clearStatus() {
  statusMsg.textContent = '';
}

// ═══════════════════════════════════════════════════════
// 新增物件（單擊量測線）
// ═══════════════════════════════════════════════════════
const DEFAULT_WIDTH_CM = 40;

function handleRulerClick(e) {
  // 若正在拖曳中剛結束（抑制 click）則跳過
  if (state.dragging) return;

  // 目標必須是 ruler-track / ruler-line / ruler-endcap（非物件）
  if (e.target.closest('.obj-rect')) return;

  const rect = rulerTrack.getBoundingClientRect();
  const clickPx = e.clientX - rect.left;
  const centerCm = pxToCm(clickPx);
  const widthCm  = DEFAULT_WIDTH_CM;

  if (hasOverlap(centerCm, widthCm)) {
    showStatus('⚠ 此位置與已有物件重疊，無法新增');
    return;
  }

  const obj = { id: genId(), centerCm, widthCm };
  state.objects.push(obj);
  sortObjects();
  clearStatus();
  render();
}

// ═══════════════════════════════════════════════════════
// 雙擊編輯
// ═══════════════════════════════════════════════════════
function openEditor(objId, triggerEl) {
  state.editing = objId;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  editWidthInput.value = obj.widthCm.toString();
  editLabelInput.value = obj.label || '';
  editError.textContent = '';
  editWidthInput.removeAttribute('aria-invalid');

  // 定位在物件矩形上方
  const objRect = (triggerEl || document.getElementById('rect-' + objId)).getBoundingClientRect();
  const editorWidth = 220;
  let left = objRect.left + objRect.width / 2 - editorWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - editorWidth - 8));
  const top  = Math.max(8, objRect.top - 160);

  inlineEditor.style.left  = left + 'px';
  inlineEditor.style.top   = top + 'px';
  inlineEditor.style.width = editorWidth + 'px';
  inlineEditor.classList.remove('hidden');
  editWidthInput.focus();
  editWidthInput.select();
}

function closeEditor() {
  state.editing = null;
  inlineEditor.classList.add('hidden');
  editError.textContent = '';
  editWidthInput.removeAttribute('aria-invalid');
}

function applyEdit() {
  const objId = state.editing;
  if (!objId) return;
  const obj = state.objects.find(o => o.id === objId);
  if (!obj) { closeEditor(); return; }

  const raw = editWidthInput.value;
  const v   = parseFloat(raw);
  if (raw === '' || isNaN(v) || v <= 0) {
    editError.textContent = '寬度必須為大於 0 的數值';
    editWidthInput.setAttribute('aria-invalid', 'true');
    editWidthInput.focus();
    return;
  }

  if (hasOverlap(obj.centerCm, v, objId)) {
    editError.textContent = '此寬度會與其他物件重疊，已恢復原值';
    editWidthInput.setAttribute('aria-invalid', 'true');
    editWidthInput.value = obj.widthCm.toString();
    editWidthInput.focus();
    editWidthInput.select();
    return;
  }

  obj.widthCm = v;
  obj.label   = editLabelInput.value.trim();
  closeEditor();
  render();
}

// ═══════════════════════════════════════════════════════
// 水平拖曳（Pointer Events）
// ═══════════════════════════════════════════════════════
let _suppressNextClick = false;
let _lastPointerDownTime = 0;   // 用來偵測雙擊，避免第二下 pointerdown 啟動拖曳
let _lastPointerDownId  = null;

function onPointerDown(e) {
  if (e.button !== 0) return;
  const objEl = e.target.closest('.obj-rect');
  if (!objEl) return;
  if (state.editing) return;

  const objId = objEl.getAttribute('data-id');
  const now   = Date.now();

  // 雙擊的第二下：取消任何進行中的拖曳，並跳過，讓 dblclick 事件接手
  const isSecondClick = (now - _lastPointerDownTime < 350) && (_lastPointerDownId === objId);
  _lastPointerDownTime = now;
  _lastPointerDownId   = objId;

  if (isSecondClick) {
    // 若第一下曾啟動拖曳（didMove=false），在此取消
    if (state.dragging && state.dragging.id === objId && !state.dragging.didMove) {
      const prevEl = document.getElementById('rect-' + state.dragging.id);
      if (prevEl) prevEl.classList.remove('obj-rect--dragging');
      state.dragging = null;
    }
    return; // 讓 dblclick 事件開啟編輯器
  }

  const obj = state.objects.find(o => o.id === objId);
  if (!obj) return;

  e.preventDefault();
  objEl.setPointerCapture(e.pointerId);

  state.dragging = {
    id: objId,
    startX: e.clientX,
    origCenter: obj.centerCm,
    didMove: false,
  };
  objEl.classList.add('obj-rect--dragging');
}

function onPointerMove(e) {
  if (!state.dragging) return;
  const drag = state.dragging;
  const deltaPx = e.clientX - drag.startX;
  if (Math.abs(deltaPx) > 2) drag.didMove = true;

  const deltaCm   = pxToCm(deltaPx);
  const obj       = state.objects.find(o => o.id === drag.id);
  if (!obj) return;

  let newCenter = drag.origCenter + deltaCm;

  // 夾限：不能與左右相鄰物件重疊
  const idx  = state.objects.indexOf(obj);
  const half = obj.widthCm / 2;

  if (idx > 0) {
    const prev = state.objects[idx - 1];
    const minCenter = prev.centerCm + prev.widthCm / 2 + half + 1e-9;
    if (newCenter < minCenter) newCenter = minCenter;
  }
  if (idx < state.objects.length - 1) {
    const next = state.objects[idx + 1];
    const maxCenter = next.centerCm - next.widthCm / 2 - half - 1e-9;
    if (newCenter > maxCenter) newCenter = maxCenter;
  }

  // ── 磁吸對齊 ──────────────────────────────────────────
  // 收集所有「吸附目標」：左右端點 + 相鄰物件的左右緣
  // 對比對象是「正在拖曳物件的左緣／右緣」
  const SNAP_CM = 2; // 吸附距離（公分）
  const total   = state.totalWidthCm;

  const snapTargets = [0, total]; // 兩側邊界
  for (const other of state.objects) {
    if (other.id === obj.id) continue;
    snapTargets.push(other.centerCm - other.widthCm / 2); // 其他物件左緣
    snapTargets.push(other.centerCm + other.widthCm / 2); // 其他物件右緣
  }

  const newLeft  = newCenter - half;
  const newRight = newCenter + half;

  let bestDelta = Infinity;
  let snapDelta = 0;

  for (const target of snapTargets) {
    // 以物件左緣吸附
    const dLeft = target - newLeft;
    if (Math.abs(dLeft) < SNAP_CM && Math.abs(dLeft) < Math.abs(bestDelta)) {
      bestDelta = dLeft;
      snapDelta = dLeft;
    }
    // 以物件右緣吸附
    const dRight = target - newRight;
    if (Math.abs(dRight) < SNAP_CM && Math.abs(dRight) < Math.abs(bestDelta)) {
      bestDelta = dRight;
      snapDelta = dRight;
    }
  }

  if (isFinite(bestDelta)) {
    newCenter += snapDelta;
  }

  obj.centerCm = newCenter;
  render();
}

function onPointerUp(e) {
  if (!state.dragging) return;
  const drag = state.dragging;

  // 移除 dragging class
  const objEl = document.getElementById('rect-' + drag.id);
  if (objEl) objEl.classList.remove('obj-rect--dragging');

  if (drag.didMove) {
    _suppressNextClick = true;
    // 在下一個 click 事件清除
    setTimeout(() => { _suppressNextClick = false; }, 100);
  }

  state.dragging = null;
  render();
}

// ═══════════════════════════════════════════════════════
// 事件綁定
// ═══════════════════════════════════════════════════════

// 設定畫面
confirmBtn.addEventListener('click', applyTotalWidth);
totalWidthInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') applyTotalWidth();
});

// 返回修改總寬
changeWidthBtn.addEventListener('click', returnToSetup);

// 量測線單擊新增
rulerTrack.addEventListener('click', e => {
  if (_suppressNextClick) { _suppressNextClick = false; return; }
  handleRulerClick(e);
});

// 物件雙擊編輯
objectsLayer.addEventListener('dblclick', e => {
  const objEl = e.target.closest('.obj-rect');
  if (!objEl) return;
  e.preventDefault();
  const objId = objEl.getAttribute('data-id');
  openEditor(objId, objEl);
});

// Pointer 拖曳（objectsLayer 內的物件）
objectsLayer.addEventListener('pointerdown',  onPointerDown);
objectsLayer.addEventListener('pointermove',  onPointerMove);
objectsLayer.addEventListener('pointerup',    onPointerUp);
objectsLayer.addEventListener('pointercancel',onPointerUp);

// 方向鍵精確移動（焦點在物件上時）
// Shift + 方向鍵 → 1.0 cm；單獨方向鍵 → 0.1 cm
objectsLayer.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const objEl = e.target.closest('.obj-rect');
  if (!objEl) return;
  if (state.editing) return; // 編輯器開啟中不響應

  e.preventDefault(); // 防止頁面捲動

  const objId = objEl.getAttribute('data-id');
  const obj   = state.objects.find(o => o.id === objId);
  if (!obj) return;

  const step    = e.shiftKey ? 1.0 : 0.1;
  const dir     = e.key === 'ArrowRight' ? 1 : -1;
  const idx     = state.objects.indexOf(obj);
  const half    = obj.widthCm / 2;
  let newCenter = obj.centerCm + dir * step;

  // 夾限：不能與左右相鄰物件重疊（同拖曳邏輯）
  if (idx > 0) {
    const prev = state.objects[idx - 1];
    const minCenter = prev.centerCm + prev.widthCm / 2 + half + 1e-9;
    if (newCenter < minCenter) newCenter = minCenter;
  }
  if (idx < state.objects.length - 1) {
    const next = state.objects[idx + 1];
    const maxCenter = next.centerCm - next.widthCm / 2 - half - 1e-9;
    if (newCenter > maxCenter) newCenter = maxCenter;
  }

  obj.centerCm = newCenter;
  render();

  // render() 會重建 DOM，需重新將焦點設回對應物件
  const newEl = document.getElementById('rect-' + objId);
  if (newEl) newEl.focus();
});

// 行內編輯器鍵盤
editWidthInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); applyEdit(); }
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
});
editLabelInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); applyEdit(); }
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
});
// 失焦套用（但若焦點移到編輯器內其他元素則不套用）
editWidthInput.addEventListener('blur', e => {
  if (inlineEditor.contains(e.relatedTarget)) return;
  applyEdit();
});
editLabelInput.addEventListener('blur', e => {
  if (inlineEditor.contains(e.relatedTarget)) return;
  applyEdit();
});

// 點擊編輯器外部 → 關閉（使用 Escape 語意）
document.addEventListener('mousedown', e => {
  if (state.editing && !inlineEditor.contains(e.target)) {
    // 視為取消（點外部 = Escape）
    closeEditor();
  }
});

// 視窗尺寸變動 → 重算像素（公分不變）
window.addEventListener('resize', () => {
  if (!measureScreen.classList.contains('hidden')) {
    render();
    // 若編輯中，重新定位編輯器
    if (state.editing) {
      const objEl = document.getElementById('rect-' + state.editing);
      if (objEl) {
        const objRect = objEl.getBoundingClientRect();
        const editorWidth = 200;
        let left = objRect.left + objRect.width / 2 - editorWidth / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - editorWidth - 8));
        const top = Math.max(8, objRect.top - 130);
        inlineEditor.style.left = left + 'px';
        inlineEditor.style.top  = top + 'px';
      }
    }
  }
});

// ═══════════════════════════════════════════════════════
// 初始聚焦 & 狀態恢復
// ═══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  // 優先嘗試從 URL 參數恢復（分享連結），其次從 localStorage
  const restored = loadFromUrl() || loadFromStorage();

  if (restored && state.totalWidthCm > 0) {
    totalWidthDisplay.textContent = fmtCm(state.totalWidthCm);
    setupScreen.classList.add('hidden');
    measureScreen.classList.remove('hidden');
    render();
    // 清除 URL 中的 query params（避免重新整理後重複載入分享連結覆蓋本機編輯）
    if (location.search) {
      history.replaceState(null, '', location.pathname);
    }
  } else {
    totalWidthInput.focus();
  }
});

// Share 按鈕
shareBtn.addEventListener('click', handleShare);
