// ライティング練習ラボ — 画面と練習モード
import { Studio, LIGHTS, REFL, REFL_SIZE, BGS, ROOMS, OBJECTS, defaultSetup, cloneSetup, compare, clamp } from './engine.js?v=20261115d';
import { STEPS, WORKFLOW, LIMITS, QUIZ_TYPES, PHONE_ROUNDS } from './lessons.js?v=20261115d';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const PASS = 75;

/* ================= 保存 ================= */
const SK = 'lightlab.v1';
const DB = (() => { const d = { visited: {}, best: {}, fix: {}, quiz: {}, real: {}, pred: {}, phone: {}, today: null, log: {} }; try { return Object.assign(d, JSON.parse(localStorage.getItem(SK) || '{}')); } catch (e) { return d; } })();
const save = () => { try { localStorage.setItem(SK, JSON.stringify(DB)); } catch (e) { } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function doneToday() { if (!DB.today || DB.today.date !== today()) DB.today = { date: today(), done: {} }; return DB.today.done; }
function markToday(k) { doneToday()[k] = true; DB.log[today()] = (DB.log[today()] || 0) + 1; save(); }

const realSteps = STEPS.filter(s => !s.soon);
const stepOf = id => STEPS.find(s => s.id === id);
function stepProgress(st) {
  if (st.soon) return { done: 0, total: 0, clear: false };
  const ids = [...st.tasks.map(t => t.id), ...st.fixes.map(f => f.id)];
  const done = ids.filter(id => (DB.best[id] && DB.best[id].pass) || DB.fix[id]).length;
  return { done, total: ids.length, clear: done === ids.length };
}
const currentStep = () => realSteps.find(s => !stepProgress(s).clear) || realSteps[realSteps.length - 1];
const unlockedSteps = () => { const c = realSteps.indexOf(currentStep()); return realSteps.filter((s, i) => i <= c || DB.visited[s.id]); };

/* ================= スタジオ ================= */
let studio = null;
const ST = { open: false, mode: 'free', setup: defaultSetup(), undo: [], moves: 0, sel: { k: 'key' }, tools: null, tab: 'light', budget: 2, measured: null, lastURL: null, changeBase: null, beforeURL: null, pre: null };
function ensureStudio() { if (!studio) { studio = new Studio($('#cv')); window.__studio = studio; } return studio; }
const can = t => { if (!ST.tools) return true; return ST.tools.some(x => x === t || t.startsWith(x + '.')); };

function setSetup(s, { commit = false, live = false } = {}) {
  ST.setup = cloneSetup(s); studio.apply(ST.setup); ST.measured = null; renderPlan();
  if (!live) renderTools();
  if (commit) doCommit();
}
function beginChange() { if (!ST.pre) { ST.pre = cloneSetup(ST.setup); ST.changeBase = ST.lastURL; } }
function doCommit() {
  if (ST.pre && JSON.stringify(ST.pre) !== JSON.stringify(ST.setup)) { ST.undo.push(ST.pre); if (ST.undo.length > 60) ST.undo.shift(); ST.moves++; ST.beforeURL = ST.changeBase; }
  ST.pre = null; renderStat();
  if (ST.mode === 'lab' && ST.moves === 1) renderAct();
}
function change(fn) { beginChange(); const s = cloneSetup(ST.setup); fn(s); setSetup(s); doCommit(); }
function undo() { if (!ST.undo.length) return; ST.changeBase = ST.lastURL; const s = ST.undo.pop(); ST.moves++; ST.beforeURL = ST.changeBase; setSetup(s); renderStat(); }

function openStudio(opt) {
  ensureStudio();
  Object.assign(ST, { open: true, startSetup: cloneSetup(opt.setup || defaultSetup()), mode: opt.mode || 'free', task: opt.task || null, step: opt.step || null, tools: opt.tools || null, undo: [], moves: 0, checks: 3, hintsUsed: 0, sel: { k: 'key' }, tab: isMob() ? 'plan' : 'light', target: null, targetBig: null, lastURL: null, beforeURL: null, pre: null, phone: null, fixChecks: 0 });
  $('#studio').classList.add('on'); $('#studio').classList.toggle('phone', ST.mode === 'phone'); document.body.style.overflow = 'hidden';
  $('#stTitle').textContent = opt.title || 'スタジオ';
  $('#stMode').textContent = { free: '自由ラボ', match: '見本合わせ', fix: '失敗直し', phone: 'スマホが反射板', lab: '実験' }[ST.mode];
  $('#briefBox').innerHTML = opt.brief || ''; $('#briefBox').classList.toggle('fold', window.innerHeight < 1000 && ST.mode !== 'phone');
  $('#targetBox').classList.remove('on'); $('#phoneHud').classList.remove('on'); $('#phoneMsg').textContent = '';
  $('#lower').style.display = ''; studio.view = 'photo'; $('#bView').textContent = '3Dで見る'; $('#bView').classList.remove('on');
  studio.resize();
  setSetup(opt.setup || defaultSetup());
  renderAct();
  if (!ST.loop) { ST.loop = true; requestAnimationFrame(loop); }
}
function closeStudio() {
  ST.open = false; ST.loop = false; $('#studio').classList.remove('on'); document.body.style.overflow = '';
  if (ST.phone) stopPhone();
  renderAll();
}
$('#stClose').onclick = () => closeStudio();
// スマホでは配置図をタブの1つにする（下の領域を、開いているタブだけで広く使う）
const isMob = () => window.innerWidth < 920;
// お題の説明はタップで開閉（画面の小さいスマホでは最初は2行だけ）
$('#briefBox').onclick = () => $('#briefBox').classList.toggle('fold');
window.addEventListener('resize', () => { if (ST.open) renderTools(); });

function loop() {
  if (!ST.open) { ST.loop = false; return; }
  requestAnimationFrame(loop);
  if (ST.phone) phoneTick();
  studio.resize();
  const t0 = performance.now(); const did = studio.frame(ST.budget); const dt = performance.now() - t0;
  if (did) { if (dt < 20 && ST.budget < 10) ST.budget++; else if (dt > 45 && ST.budget > 1) ST.budget--; }
  $('#prog i').style.width = (studio.sample / studio.maxSamples * 100) + '%';
  if (studio.done && !ST.measured && studio.view === 'photo') {
    ST.measured = studio.measureNow(); showMeters(ST.measured.m);
    try { ST.lastURL = $('#cv').toDataURL('image/jpeg', 0.85); } catch (e) { }
  }
}

/* ---- 写真の上の計器 ---- */
function showMeters(m) {
  const w = (v, bad) => bad ? ' class="w"' : '';
  $('#meters').innerHTML = `<span>明暗差 ${m.contrast.toFixed(1)}段</span><span${w(0, m.clip > 1)}>白飛び ${m.clip < 0.5 ? 0 : m.clip.toFixed(0)}%</span><span${w(0, m.crush > 2)}>黒つぶれ ${m.crush < 0.5 ? 0 : m.crush.toFixed(0)}%</span><span>背景 ${m.bgPct}%</span>`;
  const c = $('#hist'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const max = Math.max(...m.hist) || 1; g.fillStyle = '#ffffffcc';
  m.hist.forEach((v, i) => { const h = Math.sqrt(v / max) * (c.height - 4); g.fillRect(i * c.width / 64, c.height - h, c.width / 64 - 0.5, h); });
  g.fillStyle = '#f87171'; if (m.hist[63] > 0) g.fillRect(c.width - 3, 0, 3, c.height);
}

/* ---- 写真の上のボタン ---- */
const holdBtn = (el, on, off) => { el.addEventListener('pointerdown', e => { e.preventDefault(); on(); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, off)); };
holdBtn($('#bBefore'), () => { if (!ST.beforeURL) { flash('まだ比べる前の写真がありません。何か1つ動かしてから押してください'); return; } $('#swapImg').src = ST.beforeURL; $('#swapImg').classList.add('on'); $('#swapLabel').textContent = '1つ前'; $('#swapLabel').classList.add('on'); }, () => { $('#swapImg').classList.remove('on'); $('#swapLabel').classList.remove('on'); });
holdBtn($('#targetBox'), () => { if (!ST.targetBig) return; $('#swapImg').src = ST.targetBig; $('#swapImg').classList.add('on'); $('#swapLabel').textContent = '見本'; $('#swapLabel').classList.add('on'); }, () => { $('#swapImg').classList.remove('on'); $('#swapLabel').classList.remove('on'); });
$('#bZebra').onclick = () => { studio.zebra = !studio.zebra; $('#bZebra').classList.toggle('on', studio.zebra); studio.dirty = true; };
$('#bView').onclick = () => {
  studio.view = studio.view === 'photo' ? 'set' : 'photo'; $('#bView').textContent = studio.view === 'set' ? '写真に戻る' : '3Dで見る'; $('#bView').classList.toggle('on', studio.view === 'set');
  if (studio.view === 'set') orbitSet(); studio.reset(); ST.measured = null; $('#studio').classList.toggle('setview', studio.view === 'set');
};
let orb = { a: 0.6, e: 0.62, r: 3.0 };
function orbitSet() { const c = studio.center; studio.setCam.position.set(c.x + orb.r * Math.cos(orb.e) * Math.sin(orb.a), c.y + orb.r * Math.sin(orb.e), c.z + orb.r * Math.cos(orb.e) * Math.cos(orb.a)); studio.setCam.lookAt(c.x, c.y + 0.05, c.z - 0.1); studio.reset(); }
(() => {
  let drag = null; const cv = $('#cv');
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    if (studio.view === 'set') { orb.a -= dx * 0.008; orb.e = clamp(orb.e + dy * 0.006, 0.05, 1.45); orbitSet(); }
    else if (ST.phone && ST.phone.mouse) { ST.phone.mx = clamp(ST.phone.mx + dx * 0.25, -70, 70); ST.phone.my = clamp(ST.phone.my + dy * 0.25, -60, 60); }
  });
  cv.addEventListener('pointerup', () => drag = null);
})();

/* ================= 配置図（上から見た図） ================= */
const R = d => 1.45 * d / (d + 0.7), Rinv = r => 0.7 * r / (1.45 - Math.min(r, 1.4));
const D2R = Math.PI / 180;
const hpos = (az, dh) => [R(dh) * Math.sin(az * D2R), R(dh) * Math.cos(az * D2R)];
function planSVG(s, { sel = null, interactive = false } = {}) {
  const live = interactive && studio && studio.keyPose && JSON.stringify(studio.setup.key) === JSON.stringify(s.key);
  const P = []; const keyC = '#f5b83d', fillC = '#60a5fa';
  [0.3, 0.6, 1, 2].forEach(d => { P.push(`<circle cx="0" cy="0" r="${R(d)}" fill="none" stroke="#2b2f38" stroke-width="0.008" stroke-dasharray="0.03 0.03"/>`); P.push(`<text x="${R(d) * 0.707 + 0.02}" y="${-R(d) * 0.707}" font-size="0.07" fill="#5b616c">${d}m</text>`); });
  const yb = -R(s.bg.dist);
  P.push(`<line x1="-1.45" x2="1.45" y1="${yb}" y2="${yb}" stroke="${s.bg.type === 'black' ? '#666' : '#cfcfcf'}" stroke-width="0.035"/><text x="-1.42" y="${yb - 0.05}" font-size="0.095" fill="#9aa0aa">背景（${BGS[s.bg.type].name}）</text>`);
  P.push(`<g transform="translate(0,1.33)"><rect x="-0.09" y="-0.05" width="0.18" height="0.1" rx="0.02" fill="#444"/><rect x="-0.04" y="-0.11" width="0.08" height="0.07" fill="#333"/><text x="0.13" y="0.03" font-size="0.1" fill="#9aa0aa">カメラ</text></g>`);
  // 影の向き
  if (s.key) { const a = (s.key.az + 180) * D2R; P.push(`<line x1="0" y1="0" x2="${0.32 * Math.sin(a)}" y2="${0.32 * Math.cos(a)}" stroke="#555" stroke-width="0.05" stroke-linecap="round" opacity="0.8"/><text x="${0.42 * Math.sin(a) - 0.04}" y="${0.42 * Math.cos(a) + 0.03}" font-size="0.075" fill="#777">影</text>`); }
  const obj = OBJECTS[s.obj];
  P.push(`<rect x="-0.06" y="-0.045" width="0.12" height="0.09" rx="0.02" fill="#888" transform="rotate(${s.obj.startsWith('box') ? 26 : 0})"/>`);
  const light = (l, col, label, id) => {
    if (!l) return; const T = LIGHTS[l.type]; const dh = l.dist * Math.cos(l.el * D2R); const [x, y] = hpos(l.az, dh);
    const len = T.directional ? 0.08 : clamp(Math.max(T.w, T.h) * 0.45, 0.07, 0.45); const ang = Math.atan2(-y, -x) / D2R + 90;
    P.push(`<line x1="${x}" y1="${y}" x2="0" y2="0" stroke="${col}" stroke-width="0.01" stroke-dasharray="0.04 0.03" opacity="0.6"/>`);
    if (sel === id) P.push(`<circle cx="${x}" cy="${y}" r="0.14" fill="${col}" opacity="0.18"/>`);
    P.push(`<g transform="translate(${x},${y}) rotate(${ang})"><rect x="${-len / 2}" y="-0.035" width="${len}" height="0.07" rx="0.02" fill="${col}"/></g>`);
    P.push(`<text x="${x}" y="${y + 0.14}" font-size="0.1" fill="${col}" text-anchor="middle" font-weight="700">${label}・${T.short}</text>`);
  };
  light(s.key, keyC, 'メイン', 'key'); light(s.fill, fillC, '補助', 'fill');
  s.refl.forEach((r, i) => {
    const [x, y] = hpos(r.az, r.dist); let ang = Math.atan2(-y, -x) / D2R + 90;
    if (live) { try { const p = studio._reflPose(r); ang = Math.atan2(p.n.z, p.n.x) / D2R + 90; } catch (e) { } }
    else if (s.key) { const kx = Math.sin(s.key.az * D2R), kz = Math.cos(s.key.az * D2R); const tx = -x / Math.hypot(x, y), tz = -y / Math.hypot(x, y); const rx = kx - x / 1.4 + tx, rz = kz - y / 1.4 + tz; if (r.type !== 'black') ang = Math.atan2(rz, rx) / D2R + 90; } // 見本の図：メインライトと被写体の間に向ける（おおよそ）
    const S = REFL_SIZE[r.size || 'm']; const len = clamp(S.w * 0.5, 0.12, 0.5);
    const col = { white: '#f2f2ee', silver: '#b8bec8', gold: '#d9b36a', black: '#0a0a0a' }[r.type];
    if (sel === 'refl' + i) P.push(`<circle cx="${x}" cy="${y}" r="0.14" fill="#fff" opacity="0.14"/>`);
    P.push(`<g transform="translate(${x},${y}) rotate(${ang})"><rect x="${-len / 2}" y="-0.025" width="${len}" height="0.05" rx="0.01" fill="${col}" stroke="#888" stroke-width="0.008"/></g>`);
    P.push(`<text x="${x}" y="${y + 0.12}" font-size="0.095" fill="#cfcfcf" text-anchor="middle">${REFL[r.type].name}${r.lift ? '（台）' : ''}</text>`);
  });
  return P.join('');
}
function renderPlan() { $('#plan').innerHTML = planSVG(ST.setup, { sel: ST.sel.k === 'refl' ? 'refl' + ST.sel.i : ST.sel.k, interactive: true }); }
function staticPlan(s) { return `<svg viewBox="-1.55 -1.5 3.1 3.05" style="background:#17191e">${planSVG(s)}</svg>`; }

(() => {
  const svg = $('#plan'); let drag = null;
  const pt = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; };
  const hits = () => {
    const s = ST.setup, H = [];
    const L = (l, k) => { if (!l) return; const dh = l.dist * Math.cos(l.el * D2R); H.push({ k, p: hpos(l.az, dh) }); };
    L(s.key, 'key'); L(s.fill, 'fill');
    s.refl.forEach((r, i) => H.push({ k: 'refl', i, p: hpos(r.az, r.dist) }));
    return H;
  };
  svg.addEventListener('pointerdown', e => {
    if (ST.mode === 'phone') return;
    const [x, y] = pt(e); let best = null, bd = 0.22;
    for (const h of hits()) { const d = Math.hypot(h.p[0] - x, h.p[1] - y); if (d < bd) { bd = d; best = h; } }
    if (!best && Math.abs(y + R(ST.setup.bg.dist)) < 0.09 && can('bg')) best = { k: 'bg' };
    if (!best) return;
    e.preventDefault(); svg.setPointerCapture(e.pointerId);
    drag = { h: best, x0: x, y0: y, moved: false };
    ST.sel = best.k === 'refl' ? { k: 'refl', i: best.i } : { k: best.k };
    if (!isMob()) { if (best.k === 'refl') ST.tab = 'refl'; else if (best.k === 'bg') ST.tab = 'bg'; else ST.tab = 'light'; }
    renderPlan(); renderTools();
  });
  let raf = false;
  svg.addEventListener('pointermove', e => {
    if (!drag) return; const [x, y] = pt(e);
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 0.03) return;
    const h = drag.h; const s = cloneSetup(ST.setup);
    const az = Math.round(Math.atan2(x, y) / D2R); const dh = Rinv(Math.hypot(x, y));
    if (h.k === 'key' || h.k === 'fill') {
      if (!can(h.k === 'key' ? 'key.pos' : 'fill')) { flash('このお題ではメインライトの位置は動かせません'); drag = null; return; }
      const l = s[h.k]; l.az = az; if (can('key.dist') || h.k === 'fill') l.dist = clamp(+(dh / Math.cos(l.el * D2R)).toFixed(2), 0.25, 3.2);
    } else if (h.k === 'refl') {
      if (!can('refl')) { flash('このお題では反射板は使いません'); drag = null; return; }
      const r = s.refl[h.i]; r.az = az; r.dist = clamp(+dh.toFixed(2), 0.12, 1.6);
    } else if (h.k === 'bg') { s.bg.dist = clamp(+Rinv(-y).toFixed(2), 0.15, 2.2); }
    if (!drag.moved) beginChange(); drag.moved = true;
    ST.setup = s; if (!raf) { raf = true; requestAnimationFrame(() => { raf = false; studio.apply(ST.setup); ST.measured = null; renderPlan(); }); }
  });
  const up = () => { if (!drag) return; if (drag.moved) { setSetup(ST.setup); doCommit(); if (studio.behindBg(ST.setup.key, ST.setup) || studio.behindBg(ST.setup.fill, ST.setup)) flash('ライトが背景紙の後ろにあります。背景紙が光をさえぎるので、背景を遠ざけてください'); } drag = null; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
})();

/* ================= 道具パネル ================= */
const TABS = [['plan', '配置図'], ['obj', '被写体'], ['light', 'ライト'], ['refl', '反射板'], ['bg', '背景'], ['cam', 'カメラ']];
function tabAllowed(t) {
  if (!ST.tools) return true;
  if (t === 'light') return true;
  if (t === 'refl') return can('refl');
  if (t === 'bg') return can('bg') || can('room');
  if (t === 'cam') return can('cam.ev');
  if (t === 'obj') return !ST.tools;
  if (t === 'plan') return isMob();
  return false;
}
function renderTools() {
  if (ST.mode === 'phone') { $('#ttabs').innerHTML = ''; $('#lower').classList.remove('planTab'); $('#tpanel').innerHTML = phonePanel(); return; }
  if (!tabAllowed(ST.tab)) ST.tab = isMob() ? 'plan' : 'light';
  $('#lower').classList.toggle('mob', isMob()); $('#lower').classList.toggle('planTab', ST.tab === 'plan');
  $('#ttabs').innerHTML = TABS.filter(([t]) => tabAllowed(t)).map(([t, n]) => `<button data-t="${t}" class="${ST.tab === t ? 'on' : ''}">${n}</button>`).join('');
  $$('#ttabs button').forEach(b => b.onclick = () => { ST.tab = b.dataset.t; renderTools(); $('#tpanelWrap').scrollTop = 0; });
  const s = ST.setup; let h = '';
  const slider = (id, label, val, min, max, step, fmt, ok = true) => `<div class="ctl"><label>${label}<b id="${id}V">${fmt(val)}</b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" ${ok ? '' : 'disabled'}></div>`;
  const opts = (id, list, cur, ok = true) => `<div class="opts" id="${id}">${list.map(([v, n]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}" ${ok ? '' : 'disabled'}>${n}</button>`).join('')}</div>`;
  if (ST.tab === 'light') {
    const which = ST.sel.k === 'fill' && s.fill ? 'fill' : 'key'; const l = s[which];
    const okPos = which === 'fill' || can('key.pos'), okType = which === 'fill' || can('key.type'), okDist = which === 'fill' || can('key.dist');
    h += `<div class="row sp"><b>${which === 'key' ? 'メインライト' : '補助ライト'}</b>${s.fill ? `<span class="opts" id="lw">${['key', 'fill'].map(k => `<button data-v="${k}" class="${which === k ? 'on' : ''}">${k === 'key' ? 'メイン' : '補助'}</button>`).join('')}</span>` : ''}</div>`;
    h += `<div class="ctl"><label>種類</label>${opts('lType', Object.entries(LIGHTS).map(([k, v]) => [k, v.name]), l.type, okType)}</div><div class="mute" style="margin-top:-2px">${esc(LIGHTS[l.type].note)}</div>`;
    h += slider('lEl', '高さ（角度）', l.el, 0, 85, 1, v => `${v}°`, okPos);
    h += slider('lDist', '距離', l.dist, 0.25, 3.2, 0.05, v => `${(+v).toFixed(2)}m`, okDist);
    const T = LIGHTS[l.type]; h += slider('lPow', T.flash ? '出力（V1の設定・目安）' : '強さ', l.pow, T.flash ? -(8 - T.base) : -3, T.flash ? T.base : 3, 1 / 3, v => powFmt(l.type, +v), okDist);
    if (!okPos) h += `<div class="lock">🔒 このお題では、ライトの位置は決まっています</div>`;
    else if (!okDist) h += `<div class="lock">🔒 このお題で動かせるのは向きと高さだけ（配置図でドラッグ）</div>`;
    if (can('fill')) h += which === 'fill' ? `<button class="ghost sm" id="lDel" style="margin-top:6px">補助ライトを外す</button>` : (!s.fill ? `<button class="ghost sm" id="lAdd" style="margin-top:6px">＋ 補助ライトを足す</button>` : '');
  } else if (ST.tab === 'refl') {
    if (!s.refl.length) h += `<div class="mute">反射板はまだありません。</div>`;
    else {
      const i = ST.sel.k === 'refl' && s.refl[ST.sel.i] ? ST.sel.i : 0; ST.sel = { k: 'refl', i }; const r = s.refl[i];
      if (s.refl.length > 1) h += opts('rPick', s.refl.map((x, j) => [j, `${j + 1}: ${REFL[x.type].name}`]), i);
      h += `<div class="ctl"><label>色</label>${opts('rType', Object.entries(REFL).map(([k, v]) => [k, v.name]), r.type)}</div>`;
      h += `<div class="ctl"><label>大きさ</label>${opts('rSize', Object.entries(REFL_SIZE).map(([k, v]) => [k, v.name]), r.size || 'm')}</div>`;
      h += slider('rDist', '被写体からの距離', r.dist, 0.12, 1.6, 0.01, v => `${(+v).toFixed(2)}m`);
      h += `<div class="ctl"><label>置き方</label>${opts('rLift', [[0, '机に立てる'], [0.15, '台に載せる（15cm）']], r.lift || 0)}</div>`;
      h += slider('rYaw', '向きをずらす（0＝いちばん効く向き）', r.yaw || 0, -60, 60, 1, v => `${v > 0 ? '+' : ''}${v}°`);
      h += `<button class="ghost sm" id="rDel" style="margin-top:4px">この反射板を外す</button>`;
    }
    if (s.refl.length < 3) h += `<button class="ghost sm" id="rAdd" style="margin-top:8px;margin-left:6px">＋ 反射板を置く</button>`;
    h += `<div class="mute" style="margin-top:8px">反射板は配置図でドラッグして位置と距離を決めます。向きは自動で「メインライトと被写体の間」に向きます。</div>`;
  } else if (ST.tab === 'bg') {
    const okBg = can('bg'), okRoom = can('room') || !ST.tools;
    h += `<div class="ctl"><label>背景</label>${opts('bType', Object.entries(BGS).map(([k, v]) => [k, v.name]), s.bg.type, okBg)}</div>`;
    h += slider('bDist', '被写体から背景までの距離', s.bg.dist, 0.15, 2.2, 0.05, v => `${(+v).toFixed(2)}m`, okBg);
    h += `<div class="ctl"><label>部屋</label>${opts('room', Object.entries(ROOMS).map(([k, v]) => [k, v.name]), s.room, okRoom)}</div>`;
  } else if (ST.tab === 'cam') {
    const okCam = !ST.tools;
    h += slider('cEv', '露出（α7C II・ISO100・1/160秒のとき）', s.cam.ev, -2, 2, 1 / 3, v => evFmt(+v), can('cam.ev'));
    h += `<div class="ctl"><label>カメラの高さ</label>${opts('cEl', [[8, '真横'], [30, '斜め上'], [55, '高め'], [88, '真上']], s.cam.el, okCam)}</div>`;
    h += slider('cF', '焦点距離（被写体の大きさは同じまま）', s.cam.focal, 24, 70, 1, v => `${v}mm`, okCam);
  } else if (ST.tab === 'obj') {
    const groups = {}; Object.entries(OBJECTS).forEach(([k, v]) => (groups[v.group] = groups[v.group] || []).push([k, v.name]));
    h += Object.entries(groups).map(([g, l]) => `<div class="mute" style="margin-top:6px">${g}</div>${opts('cObj_' + g, l, s.obj)}`).join('');
  }
  $('#tpanel').innerHTML = h;
  bindTools();
}
function bindTools() {
  const s = () => ST.setup;
  const bindRange = (id, fn) => { const el = $('#' + id); if (!el) return; el.addEventListener('input', () => { beginChange(); const ns = cloneSetup(ST.setup); fn(ns, +el.value); ST.setup = ns; studio.apply(ns); ST.measured = null; renderPlan(); $('#' + id + 'V').textContent = fmtOf(id, +el.value); }); el.addEventListener('change', () => { setSetup(ST.setup); doCommit(); }); };
  const bindOpts = (id, fn) => { $$('#' + id + ' button').forEach(b => b.onclick = () => change(ns => fn(ns, b.dataset.v))); };
  const L = ns => ns[ST.sel.k === 'fill' && ns.fill ? 'fill' : 'key'];
  $$('#lw button').forEach(b => b.onclick = () => { ST.sel = { k: b.dataset.v }; renderPlan(); renderTools(); });
  bindOpts('lType', (ns, v) => { const l = L(ns); l.type = v; });
  bindRange('lEl', (ns, v) => L(ns).el = v); bindRange('lDist', (ns, v) => L(ns).dist = v); bindRange('lPow', (ns, v) => L(ns).pow = v);
  const add = $('#lAdd'); if (add) add.onclick = () => change(ns => { ns.fill = { type: 'softbox', az: (ns.key.az > 0 ? -1 : 1) * 70, el: 20, dist: 1.2, pow: -1 }; ST.sel = { k: 'fill' }; });
  const del = $('#lDel'); if (del) del.onclick = () => change(ns => { ns.fill = null; ST.sel = { k: 'key' }; });
  const ri = () => ST.sel.k === 'refl' ? ST.sel.i : 0;
  $$('#rPick button').forEach(b => b.onclick = () => { ST.sel = { k: 'refl', i: +b.dataset.v }; renderPlan(); renderTools(); });
  bindOpts('rType', (ns, v) => ns.refl[ri()].type = v); bindOpts('rSize', (ns, v) => ns.refl[ri()].size = v); bindOpts('rLift', (ns, v) => ns.refl[ri()].lift = +v);
  bindRange('rDist', (ns, v) => ns.refl[ri()].dist = v); bindRange('rYaw', (ns, v) => ns.refl[ri()].yaw = v);
  const rd = $('#rDel'); if (rd) rd.onclick = () => change(ns => { ns.refl.splice(ri(), 1); ST.sel = ns.refl.length ? { k: 'refl', i: 0 } : { k: 'key' }; });
  const ra = $('#rAdd'); if (ra) ra.onclick = () => change(ns => { const az = ((ns.key.az > 0 ? -1 : 1) * 90); ns.refl.push({ type: 'white', az, dist: 0.4, size: 'm', yaw: 0 }); ST.sel = { k: 'refl', i: ns.refl.length - 1 }; });
  bindOpts('bType', (ns, v) => ns.bg.type = v); bindRange('bDist', (ns, v) => ns.bg.dist = v); bindOpts('room', (ns, v) => ns.room = v);
  bindRange('cEv', (ns, v) => ns.cam.ev = +v.toFixed(2)); bindOpts('cEl', (ns, v) => ns.cam.el = +v); bindRange('cF', (ns, v) => ns.cam.focal = v);
  Object.values(OBJECTS).map(o => o.group).filter((g, i, a) => a.indexOf(g) === i).forEach(g => bindOpts('cObj_' + g, (ns, v) => ns.obj = v));
}
function powFmt(type, v) {
  if (!LIGHTS[type].flash) return `${v > 0 ? '+' : ''}${v.toFixed(1)}段`;
  const st = Math.round(v * 3) / 3; const full = Math.max(0, LIGHTS[type].base - st); const n = Math.floor(full + 1e-6), f = Math.round((full - n) * 3);
  const frac = n === 0 ? '1/1' : `1/${2 ** n}`;
  return f ? `${frac} −${f === 1 ? '0.3' : '0.7'}` : frac;
}
const FST = ['16', '14', '13', '11', '10', '9', '8', '7.1', '6.3', '5.6', '5', '4.5', '4'];
function evFmt(v) { const i = clamp(Math.round(v * 3) + 6, 0, 12); return `f/${FST[i]}（${v > 0 ? '+' : ''}${v.toFixed(1)}段）`; }
function fmtOf(id, v) {
  if (id === 'lPow') { const l = ST.setup[ST.sel.k === 'fill' && ST.setup.fill ? 'fill' : 'key']; return powFmt(l.type, v); }
  return { lEl: `${v}°`, lDist: `${v.toFixed(2)}m`, lPow: `${v > 0 ? '+' : ''}${v.toFixed(1)}段`, rDist: `${v.toFixed(2)}m`, rYaw: `${v > 0 ? '+' : ''}${v}°`, bDist: `${v.toFixed(2)}m`, cEv: evFmt(v), cF: `${v}mm` }[id] || v;
}

/* ================= 下のボタン ================= */
function renderAct() {
  const a = $('#actbar');
  if (ST.mode === 'match') a.innerHTML = `<button class="ghost" id="aUndo">元に戻す</button><button class="big" id="aJudge">判定（あと${ST.checks}回）</button><button class="ghost" id="aGive">答え</button>`;
  else if (ST.mode === 'fix') a.innerHTML = `<button class="ghost" id="aUndo">元に戻す</button><button class="big" id="aCheck">直ったか確認</button><button class="ghost" id="aHint">ヒント</button>`;
  else if (ST.mode === 'lab') a.innerHTML = `<button class="ghost" id="aUndo">元に戻す</button><button class="big" id="aSeen" ${ST.moves < 1 ? 'disabled style="opacity:.45"' : ''}>${ST.moves < 1 ? 'まず動かしてみる' : '試した → 答え合わせ'}</button>`;
  else if (ST.mode === 'phone') a.innerHTML = `<button class="ghost" id="aSensor">センサーを有効にする</button><button class="big" id="aPhone">スタート</button>`;
  else a.innerHTML = `<button class="ghost" id="aUndo">元に戻す</button><button class="ghost" id="aReset">最初に戻す</button>`;
  const on = (id, f) => { const el = $('#' + id); if (el) el.onclick = f; };
  on('aUndo', undo); on('aReset', () => change(ns => Object.assign(ns, ST.startSetup || defaultSetup())));
  on('aJudge', judgeMatch); on('aGive', giveUp); on('aCheck', checkFix); on('aHint', fixHint); on('aSeen', labReveal);
  on('aSensor', enableSensor); on('aPhone', startPhoneRound);
  renderStat();
}
function renderStat() {
  const t = ST.mode === 'match' ? `変更 ${ST.moves}回` : ST.mode === 'fix' ? `変更 ${ST.moves}回（目安 ${ST.task.par}回）` : '';
  $('#stMode').textContent = ({ free: '自由ラボ', match: '見本合わせ', fix: '失敗直し', phone: 'スマホが反射板', lab: '実験' }[ST.mode]) + (t ? ' · ' + t : '');
}
let flashT = 0;
function flash(msg) { const b = $('#briefBox'); const keep = ST.briefHTML ?? b.innerHTML; ST.briefHTML = keep; b.innerHTML = `<span class="cl">${esc(msg)}</span>`; clearTimeout(flashT); flashT = setTimeout(() => { b.innerHTML = ST.briefHTML; ST.briefHTML = null; }, 2600); }

/* ================= シート ================= */
function sheet(html, bind) { $('#sheetIn').innerHTML = html; $('#sheet').classList.add('on'); if (bind) bind(); }
function closeSheet() { $('#sheet').classList.remove('on'); }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
const busy = (msg) => sheet(`<div class="busy"><div class="spin"></div>${esc(msg)}</div>`);

/* ================= 見本合わせ ================= */
async function startMatch(step, task) {
  DB.visited[step.id] = true; save();
  openStudio({ mode: 'match', task, step, tools: step.tools, setup: task.start, title: task.title, brief: `<b>お題：</b>${esc(task.brief)}<br><span class="mute">右上の見本と同じ写りにしてください。採点は隠れています（判定は3回まで）。見本は長押しで大きく見られます。</span>` });
  busy('見本を撮影しています…'); await frame2();
  const big = studio.shoot(task.target, { w: 240, h: 300, samples: 32, url: true });
  ST.targetBig = big.url; ST.target = studio.shoot(task.target, { w: 96, h: 120, samples: 16 });
  $('#targetImg').src = big.url; $('#targetBox').classList.add('on'); closeSheet();
}
const GROUPS = [
  ['pos', s => s.key.az + '|' + s.key.el, (s, t) => { s.key.az = t.key.az; s.key.el = t.key.el; }],
  ['soft', s => s.key.type + '|' + s.key.dist, (s, t) => { s.key.type = t.key.type; s.key.dist = t.key.dist; }],
  ['bright', s => s.key.pow + '|' + s.cam.ev, (s, t) => { s.key.pow = t.key.pow; s.cam.ev = t.cam.ev; }],
  ['refl', s => JSON.stringify(s.refl) + JSON.stringify(s.fill), (s, t) => { s.refl = cloneSetup(t).refl; s.fill = cloneSetup(t).fill; }],
  ['bg', s => JSON.stringify(s.bg) + s.room, (s, t) => { s.bg = { ...t.bg }; s.room = t.room; }],
];
const shadowWord = az => { const a = ((az + 180) % 360 + 540) % 360 - 180; if (Math.abs(a) <= 30) return '手前'; if (Math.abs(a) >= 150) return '奥'; const lr = a < 0 ? '左' : '右'; return Math.abs(a) < 70 ? `${lr}手前` : Math.abs(a) <= 110 ? lr : `${lr}奥`; };
const sideWord = az => { const a = ((az % 360) + 540) % 360 - 180; if (Math.abs(a) <= 30) return '正面（カメラ側）'; if (Math.abs(a) >= 140) return '真後ろ（逆光）'; const lr = a < 0 ? '左' : '右'; return Math.abs(a) < 75 ? `${lr}斜め前` : Math.abs(a) <= 110 ? `${lr}の真横` : `${lr}斜め後ろ`; };
function hintText(g, cur, tgt, mc, mt) {
  const t = tgt, s = cur;
  if (g === 'pos') {
    const parts = [];
    if (Math.abs(((t.key.az - s.key.az + 540) % 360) - 180) > 20) parts.push(`見本の光は<b>${sideWord(t.key.az)}</b>から来ています（影が<b>${shadowWord(t.key.az)}</b>に落ちていて、光側の面が明るい）。`);
    if (Math.abs(t.key.el - s.key.el) > 12) parts.push(`見本は影が<b>${t.key.el > s.key.el ? '短い（光が高い）' : '長い（光が低い）'}</b>です。`);
    return parts.join('') || '光の向きを見本の影の落ち方に合わせましょう。';
  }
  if (g === 'soft') { const sz = l => { const T = LIGHTS[l.type]; return T.directional ? 0 : 2 * Math.atan(Math.max(T.w, T.h) / 2 / l.dist); }; return `見本の影のふちは<b>${sz(t.key) > sz(s.key) ? 'もっとやわらかい（光源が大きい・近い）' : 'もっとくっきり（光源が小さい・遠い）'}</b>です。`; }
  if (g === 'bright') return `全体の明るさが見本より<b>${mc.midPct > mt.midPct ? '明るい' : '暗い'}</b>です（被写体の中間の明るさ：見本 ${mt.midPct}% / あなた ${mc.midPct}%）。`;
  if (g === 'refl') return `影側の明るさが違います（明暗差：見本 <b>約${mt.contrast.toFixed(1)}段</b> / あなた 約${mc.contrast.toFixed(1)}段）。${mt.contrast < mc.contrast ? '影側をもっと起こしましょう。' : '影側が明るすぎます。'}`;
  if (g === 'bg') return `背景の明るさが違います（見本 <b>${mt.bgPct}%</b> / あなた ${mc.bgPct}%）。${mt.bgPct > mc.bgPct ? '背景にもっと光を届かせましょう。' : '背景に光が届きすぎています。'}`;
  return '';
}
async function judgeMatch() {
  if (!ST.target) return;
  busy('判定しています…'); await frame2();
  const cur = studio.shoot(ST.setup, { w: 96, h: 120, samples: 16 });
  const r = compare(ST.target, cur);
  if (r.score >= PASS) return matchDone(r.score, true);
  ST.checks--; renderAct();
  // 一番効く違いを探す（見本の値に1グループだけ置き換えて、どれだけ近づくか）
  let best = null;
  for (const [g, key, put] of GROUPS) {
    if (key(ST.setup) === key(ST.task.target)) continue;
    const s2 = cloneSetup(ST.setup); put(s2, ST.task.target);
    const sc = compare(ST.target, studio.shoot(s2, { w: 96, h: 120, samples: 10 })).score;
    if (!best || sc > best.sc) best = { g, sc };
  }
  const msg = best ? hintText(best.g, ST.setup, ST.task.target, cur.m, ST.target.m) : '細かい違いです。見本と見比べて微調整しましょう。';
  if (ST.checks <= 0) return matchDone(r.score, false, msg);
  sheet(`<h2>${r.score}点 <span class="mute">（合格 ${PASS}点）</span></h2>
    <div class="why"><b>一番効く違い</b><br>${msg}</div>
    <p class="mute">あと${ST.checks}回判定できます。見本と自分の写真を見比べて、どこが違うかを言葉にしてから動かしましょう。</p>
    <button class="big" id="shOk">続ける</button>`, () => $('#shOk').onclick = closeSheet);
}
function matchDone(score, pass, lastHint) {
  const id = ST.task.id; const prev = DB.best[id];
  const rec = { score, pass, moves: ST.moves, checks: 3 - ST.checks + (pass ? 1 : 0), date: today() };
  if (!prev || (pass && !prev.pass) || (pass === prev.pass && score > prev.score)) DB.best[id] = rec;
  markToday('match:' + id); save();
  const curURL = studio.shoot(ST.setup, { w: 240, h: 300, samples: 24, url: true }).url; // 見本と同じ撮り方で並べる
  sheet(`<h2>${pass ? '合格！' : 'ここまで'} ${score}点</h2>
    <div class="mute">変更 ${ST.moves}回 ・ 判定 ${rec.checks}回</div>
    ${!pass && lastHint ? `<div class="why"><b>最後に一番効いた違い</b><br>${lastHint}</div>` : ''}
    <div class="cmp"><div>見本<img src="${ST.targetBig}"></div><div>あなた<img src="${curURL}"></div></div>
    <div class="cmp"><div>見本のセット${staticPlan(ST.task.target)}</div><div>あなたのセット${staticPlan(ST.setup)}</div></div>
    <div class="why"><b>本番ではこう考える</b><br>${esc(ST.task.think)}</div>
    ${pass ? '<p class="mute">セットが見本と違っても、写りが近ければ合格です。本番でも、正解のセットは1つではありません。</p>' : ''}
    <div class="row" style="margin-top:12px"><button class="big" id="shNext" style="flex:1">次へ</button><button class="ghost" id="shAgain">もう一度</button></div>`,
    () => { $('#shNext').onclick = () => { closeSheet(); nextFromStudio(); }; $('#shAgain').onclick = () => { closeSheet(); startMatch(ST.step, ST.task); }; });
}
function giveUp() {
  sheet(`<h2>答えを見ますか？</h2><p class="mute">答えを見ると、このお題は「不合格」として記録されます。あとで何度でもやり直せます。</p><div class="row"><button class="big" id="gYes" style="flex:1">答えを見る</button><button class="ghost" id="gNo">続ける</button></div>`,
    () => { $('#gNo').onclick = closeSheet; $('#gYes').onclick = async () => { busy('採点中…'); await frame2(); const cur = studio.shoot(ST.setup, { w: 96, h: 120, samples: 16 }); ST.checks = 0; matchDone(compare(ST.target, cur).score, false); }; });
}

/* ================= 失敗直し ================= */
function startFix(step, fix) {
  DB.visited[step.id] = true; save();
  openStudio({ mode: 'fix', task: fix, step, tools: step.tools, setup: fix.start, title: fix.title, brief: `<b>クライアント：</b><span class="cl">${esc(fix.client)}</span><br><span class="mute">原因を考えて、できるだけ少ない変更で直してください。直し方は1つではありません。</span>` });
}
async function checkFix() {
  busy('確認しています…'); await frame2();
  const cur = studio.shoot(ST.setup, { w: 96, h: 120, samples: 16 }); const ok = !!ST.task.check(ST.setup, cur.m);
  ST.fixChecks++;
  if (ok) {
    const id = ST.task.id; const prev = DB.fix[id]; if (!prev || ST.moves < prev.moves) DB.fix[id] = { moves: ST.moves, hints: ST.hintsUsed, date: today() };
    markToday('fix:' + id); save();
    const par = ST.task.par; const grade = ST.moves <= par ? '最短で直せました' : ST.moves <= par + 2 ? 'もう少し少ない手数で直せます' : '直せました。次は手数を減らしてみましょう';
    return sheet(`<h2>直りました</h2><div class="mute">変更 ${ST.moves}回（目安 ${par}回）・ ${grade}</div>
      <div class="why"><b>本番ではこう考える</b><br>${esc(ST.task.think)}</div>
      <p class="mute">本番では、1回動かすたびに機材の位置を直し、テスト撮影をします。少ない手数で直せる＝撮影が早く終わる、です。</p>
      <div class="row"><button class="big" id="shNext" style="flex:1">次へ</button><button class="ghost" id="shStay">続けて触る</button></div>`,
      () => { $('#shNext').onclick = () => { closeSheet(); nextFromStudio(); }; $('#shStay').onclick = closeSheet; });
  }
  const m = cur.m;
  sheet(`<h2>まだ「直った」とは言われなさそう</h2>
    <div class="mute">今の写真：明暗差 ${m.contrast.toFixed(1)}段 ・ 白飛び ${m.clip.toFixed(0)}% ・ 背景 ${m.bgPct}% ・ 被写体の中間 ${m.midPct}%</div>
    <p>クライアントの言葉をもう一度読んで、写真のどこがそう見えるのかを考えましょう。</p>
    ${ST.fixChecks >= 2 ? `<div class="why"><b>ヒント</b><br>${esc(ST.task.hint)}</div>` : ''}
    <button class="big" id="shOk">続ける</button>`, () => $('#shOk').onclick = closeSheet);
}
function fixHint() { ST.hintsUsed++; sheet(`<h2>ヒント</h2><div class="why">${esc(ST.task.hint)}</div><button class="big" id="shOk" style="margin-top:10px">続ける</button>`, () => $('#shOk').onclick = closeSheet); }

/* ================= 実験（予想してから試す） ================= */
function startLab(step) {
  DB.visited[step.id] = true; save();
  const p = step.lab.predict;
  sheet(`<h2>実験：まず予想</h2><p>${esc(p.q)}</p><div class="qopts">${p.opts.map((o, i) => `<button data-i="${i}">${esc(o)}</button>`).join('')}</div><p class="mute">予想してから実際に動かして確かめます。外れてもかまいません（外れたときのほうが記憶に残ります）。</p>`,
    () => $$('#sheetIn .qopts button').forEach(b => b.onclick = () => {
      ST.labGuess = +b.dataset.i; closeSheet();
      openStudio({ mode: 'lab', step, setup: step.lab.setup, title: `実験：${step.title}`, brief: `<b>予想：</b>${esc(p.opts[ST.labGuess])}<br>${esc(step.lab.try)}`, tools: null });
      ST.labStep = step;
    }));
}
function labReveal() {
  const step = ST.labStep; const p = step.lab.predict; const ok = ST.labGuess === p.a;
  DB.pred[step.id] = { ok, date: today() }; markToday('lab:' + step.id); save();
  sheet(`<h2>${ok ? '予想どおり' : '予想と違った'}</h2><p><b>答え：</b>${esc(p.opts[p.a])}</p><div class="why">${esc(p.explain)}</div>
    <h3>このステップで覚えること</h3><ul class="l">${step.learn.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="row" style="margin-top:12px"><button class="big" id="shNext" style="flex:1">${planQueue.length ? 'プランの次へ' : 'お題へ進む'}</button><button class="ghost" id="shStay">もう少し触る</button></div>`,
    () => { $('#shNext').onclick = () => { closeSheet(); closeStudio(); if (nextPlan()) return; const t = step.tasks.find(t => !(DB.best[t.id] && DB.best[t.id].pass)) || step.tasks[0]; startMatch(step, t); }; $('#shStay').onclick = () => { closeSheet(); ST.mode = 'free'; renderAct(); }; });
}

function nextFromStudio() {
  const step = ST.step; closeStudio();
  if (nextPlan()) return; if (ST.inPlan) { ST.inPlan = false; tab('home'); flashHome('今日のプランはここまでです。おつかれさまでした！'); return; }
  if (step) openStep(step.id);
}

/* ================= スマホが反射板 ================= */
const SENS = { ok: false, g: 0, b: 0 };
function onOrient(e) { if (e.gamma == null) return; SENS.ok = true; SENS.g = e.gamma; SENS.b = e.beta; }
async function enableSensor() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { flash('許可されませんでした。Safariでこのページを開き直して、もう一度押してください'); return; } }
    window.addEventListener('deviceorientation', onOrient); await sleep(400);
    if (SENS.ok) { $('#aSensor').textContent = 'センサーOK'; $('#aSensor').disabled = true; ST.phone.mouse = false; flash('センサーを使います。スマホを傾けて反射板の向きを変えます'); }
    else flash('このブラウザでは傾きセンサーが使えません。写真の上をドラッグして操作してください');
  } catch (e) { flash('センサーを使えませんでした。写真の上をドラッグして操作できます'); }
}
function startPhone(roundIdx = 0) {
  const R = PHONE_ROUNDS[roundIdx];
  const setup = { ...defaultSetup(), obj: 'box_white', room: 'dark', bg: { type: 'white', dist: 0.6 }, key: { type: 'softbox', az: -90, el: 30, dist: 0.8, pow: 0 }, refl: [{ type: R.refl, az: 95, dist: 0.32, size: 'm', yaw: 0, pitch: 0 }] };
  openStudio({ mode: 'phone', setup, title: `スマホが反射板 ${roundIdx + 1}/${PHONE_ROUNDS.length}：${R.title}`, brief: esc(R.how) });
  ST.phone = { round: roundIdx, R, running: false, mouse: !SENS.ok, mx: 0, my: 0, g0: 0, b0: 0, hold: 0, t0: 0, lastApply: 0, results: ST.phoneResults || [] };
  if (SENS.ok) { $('#aSensor').textContent = 'センサーOK'; $('#aSensor').disabled = true; }
  $('#phoneHud').classList.add('on'); $('#phoneMsg').textContent = 'スタートを押してください';
  renderTools();
}
function phonePanel() {
  return `<div class="why"><b>この練習の目的</b><br>本物の反射板は、<b>被写体を見ながらゆっくり振って、いちばん効く所で止める</b>のが基本の動きです。ここではスマホを反射板に見立てて、その「見ながら探す」動きと、白と銀の効き方の違い（銀は狭い）を体で覚えます。</div>
  <ul class="l" style="font-size:13px"><li>スマホを傾けると、右側の反射板の向きが変わります（左右の傾き＝左右、前後の傾き＝上下）。</li><li>スタート時の向きは毎回ずらしてあります。メーターではなく<b>箱の右の面</b>を見て探しましょう。</li><li>PCやセンサーが使えないときは、写真の上をドラッグして操作します。</li></ul>
  <div class="mute">実物との違い：本物の反射板は大きくて重く、風も受けます。手の動きの細かさは実物で練習してください。「見ながら探す」手順はそのまま使えます。</div>`;
}
function startPhoneRound() {
  const P = ST.phone; if (!P) return;
  P.g0 = SENS.g; P.b0 = SENS.b; P.mx = 0; P.my = 0;
  const sgn = Math.random() < 0.5 ? -1 : 1; P.offY = sgn * (25 + Math.random() * 20); P.offP = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 14);
  // 最大の効き（いちばん明るい）を総当たりで求める
  let best = 99; for (let y = -80; y <= 80; y += 2) for (let p = -60; p <= 60; p += 3) { const s = cloneSetup(ST.setup); s.refl[0].yaw = y; s.refl[0].pitch = p; best = Math.min(best, studio.quickContrast(s)); }
  P.best = best; P.goal = P.R.goal === 'zone' ? Math.max(best + 0.5, 1.5) : best + 0.12;
  P.running = true; P.t0 = performance.now(); P.hold = 0; P.done = false;
  $('#aPhone').textContent = 'やり直す';
  const lo = 0.3, hi = 3.6; const toX = c => (1 - (clamp(c, lo, hi) - lo) / (hi - lo)) * 100;
  if (P.R.goal === 'zone') { $('#phoneZone').style.left = toX(P.goal + 0.15) + '%'; $('#phoneZone').style.width = (toX(P.goal - 0.15) - toX(P.goal + 0.15)) + '%'; }
  else { $('#phoneZone').style.left = toX(P.goal) + '%'; $('#phoneZone').style.width = (100 - toX(P.goal)) + '%'; }
  $('#phoneMsg').textContent = '';
}
function phoneTick() {
  const P = ST.phone; if (!P || !P.running) return;
  const yaw0 = P.mouse ? P.mx : clamp((SENS.g - P.g0) * 1.3, -70, 70), pit0 = P.mouse ? -P.my : clamp((SENS.b - P.b0) * 1.1, -60, 60);
  const s = ST.setup; s.refl[0].yaw = clamp(yaw0 + P.offY, -80, 80); s.refl[0].pitch = clamp(pit0 + P.offP, -60, 60);
  const c = studio.quickContrast(s);
  const now = performance.now();
  if (now - P.lastApply > 110) { P.lastApply = now; studio.apply(s); renderPlan(); }
  const lo = 0.3, hi = 3.6; $('#phoneNeedle').style.left = `calc(${(1 - (clamp(c, lo, hi) - lo) / (hi - lo)) * 100}% - 3px)`;
  $('#phoneVal').textContent = `明暗差 ${c.toFixed(1)}段`;
  const inGoal = P.R.goal === 'zone' ? Math.abs(c - P.goal) <= 0.15 : c <= P.goal;
  const dt = Math.min(0.1, (now - (P.lastT || now)) / 1000); P.lastT = now;
  P.hold = inGoal ? P.hold + dt : 0;
  $('#phoneMsg').textContent = inGoal ? `そのまま… ${Math.max(0, 2 - P.hold).toFixed(1)}` : '';
  if (P.hold >= 2 && !P.done) {
    P.done = true; P.running = false; const t = (now - P.t0) / 1000 - 2;
    const res = { id: P.R.id, t: Math.max(0, t) }; (ST.phoneResults = ST.phoneResults || []).push(res);
    const prev = DB.phone[P.R.id]; if (!prev || res.t < prev.t) DB.phone[P.R.id] = { t: res.t, date: today() }; markToday('phone:' + P.R.id); if (P.round >= PHONE_ROUNDS.length - 1) markToday('phone'); save();
    $('#phoneMsg').textContent = `OK！ ${res.t.toFixed(1)}秒`;
    const last = P.round >= PHONE_ROUNDS.length - 1;
    setTimeout(() => sheet(`<h2>${esc(P.R.title)}：${res.t.toFixed(1)}秒</h2>
      ${P.R.refl === 'silver' ? '<div class="why">銀は、効く角度が白よりずっと狭かったはずです。本番で銀を使うときは、被写体の影側を見ながら少しずつ動かします。</div>' : P.R.goal === 'zone' ? '<div class="why">「いちばん効く向き」から少し外すと、効きを弱められます（フェザリング）。反射板を離すのと同じくらいよく使う調整です。</div>' : '<div class="why">白は効く角度が広く、だいたい向いていれば効きます。被写体を見ながら探すと速く見つかります。</div>'}
      <button class="big" id="shNext">${last ? 'おわり' : '次のラウンド'}</button>`, () => $('#shNext').onclick = () => { closeSheet(); if (last) { closeStudio(); ST.phoneResults = []; nextPlan(); } else startPhone(P.round + 1); }), 600);
  }
}
function stopPhone() { ST.phone = null; $('#phoneHud').classList.remove('on'); }

/* ================= クイズ ================= */
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
function quizObjects() { const objs = new Set(); unlockedSteps().forEach(s => { objs.add(s.obj); s.tasks.forEach(t => objs.add(t.target.obj)); }); return [...objs].filter(o => !['icecoffee', 'juice', 'phone', 'glassbottle', 'tumbler', 'ring'].includes(o)); }
function quizTypes() { const u = new Set(unlockedSteps().map(s => s.id)); return QUIZ_TYPES.filter(q => u.has(q.from)); }
function baseQ(obj) { return { ...defaultSetup(), obj, room: 'white', bg: { type: pick(['white', 'white', 'gray']), dist: 1.1 }, cam: { el: 30, focal: 50, ev: 0 }, key: { type: 'softbox', az: -60, el: 35, dist: 0.8, pow: 0 }, refl: [] }; }
function makeQuestion(type) {
  const obj = pick(quizObjects());
  if (type === 'dir') {
    const opts = [['左から', () => rnd(-110, -60)], ['右から', () => rnd(60, 110)], ['奥から（逆光）', () => pick([-1, 1]) * rnd(145, 175)], ['ほぼ正面から', () => rnd(-20, 20)]];
    const a = Math.floor(Math.random() * 4); const s = baseQ(obj); s.key.az = Math.round(opts[a][1]()); s.key.type = pick(['softbox', 'window', 'led']); s.key.dist = LIGHTS[s.key.type].def;
    return { type, q: '光はどこから当たっている？', setups: [s], opts: opts.map(o => o[0]), a, explain: `影は光の反対側に落ちます。この写真は影が${shadowWord(s.key.az)}にあり、${a === 2 ? '被写体のふちが光り、手前が暗い' : a === 3 ? '面ごとの明るさの差が小さい' : '光の側の面が明るい'}ので、光は${opts[a][0]}。` };
  }
  if (type === 'height') {
    const a = Math.random() < 0.5 ? 0 : 1; const s = baseQ(obj); s.key.type = 'led'; s.key.dist = 0.8; s.key.az = pick([-1, 1]) * rnd(50, 100); s.key.el = a === 0 ? rnd(62, 75) : rnd(8, 16);
    return { type, q: '光の高さは？', setups: [s], opts: ['高い（上のほうから）', '低い（横に近い）'], a, explain: a === 0 ? '影が短く、天面（上の面）が明るい → 光は高い。' : '影が長く伸びている → 光は低い。夕方の影が長いのと同じです。' };
  }
  if (type === 'soft') {
    const a = Math.random() < 0.5 ? 0 : 1; const s = baseQ(obj); s.key.az = pick([-1, 1]) * rnd(50, 110);
    if (a === 0) { s.key.type = 'led'; s.key.dist = 0.9; } else { s.key.type = pick(['softbox', 'window']); s.key.dist = s.key.type === 'window' ? 0.9 : 0.5; s.key.pow = -1.5; }
    return { type, q: '光源は大きい？小さい？（影のふちを見る）', setups: [s], opts: ['小さい光（影がくっきり）', '大きい光（影がやわらか）'], a, explain: a === 0 ? '影のふちが線のようにくっきり → 小さい光源（LEDそのまま、直射日光）。' : '影のふちがぼやけている → 大きい光源（窓、ソフトボックス）、または近い光源。' };
  }
  if (type === 'fill') {
    const a = Math.random() < 0.5 ? 0 : 1; const s = baseQ(obj); s.room = 'dark'; s.key.az = pick([-1, 1]) * 90; if (a === 0) s.refl = [{ type: 'white', az: -s.key.az, dist: 0.3, size: 'l' }];
    return { type, q: '影側に白い反射板はある？', setups: [s], opts: ['ある（影側が明るい）', 'ない（影側が暗い）'], a, explain: a === 0 ? '光の反対側の面が、暗い部屋なのに明るい → 反射板で起こしている。' : '影側が深く沈んでいる → 反射板なし（暗い部屋）。' };
  }
  // predict
  const s = baseQ(obj); s.key.az = -70; s.room = 'dark';
  const changes = [
    ['メインライトを反対側（右）へ回す', x => { x.key.az = 70; }],
    ['メインライトを奥（逆光側）へ回す', x => { x.key.az = -160; }],
    ['メインライトを小さいLEDに替える', x => { x.key.type = 'led'; }],
    ['影側に白い反射板を置く', x => { x.refl = [{ type: 'white', az: 90, dist: 0.3, size: 'l' }]; }],
  ];
  const sel = [...changes].sort(() => Math.random() - 0.5).slice(0, 3); const a = Math.floor(Math.random() * 3);
  const setups = [s, ...sel.map(c => { const x = cloneSetup(s); c[1](x); return x; })];
  return { type, q: `今の写真（左上）から「${sel[a][0]}」と、どうなる？`, setups, grid: true, opts: ['A', 'B', 'C'], a, explain: `正解は ${'ABC'[a]}。ほかの2つは「${sel.filter((_, i) => i !== a).map(c => c[0]).join('」「')}」の結果です。動かす前に結果を予想できると、本番で迷う時間が減ります。` };
}
let QZ = null;
async function startQuiz() {
  ensureStudio(); const types = quizTypes();
  QZ = { list: Array.from({ length: 5 }, (_, i) => i === 2 && types.some(t => t.id === 'predict') ? 'predict' : pick(types.filter(t => t.id !== 'predict')).id), i: 0, ok: 0 };
  showQuiz();
}
async function showQuiz() {
  const v = $('#v-quiz');
  if (QZ.i >= QZ.list.length) {
    markToday('quiz'); save();
    v.innerHTML = `<h1>クイズ結果</h1><div class="card"><div style="font-size:28px;font-weight:900">${QZ.ok} / ${QZ.list.length}</div><div class="mute">見本合わせで「見本を読む」ときに、この目がそのまま使えます。</div></div><button class="big" id="qAgain">もう1回</button><p></p><button class="ghost" id="qBack">ホームへ</button>`;
    $('#qAgain').onclick = startQuiz; $('#qBack').textContent = planQueue.length ? 'プランの次へ' : 'ホームへ'; $('#qBack').onclick = () => { if (!nextPlan()) tab('home'); };
    return;
  }
  v.innerHTML = `<h1>クイズ ${QZ.i + 1}/${QZ.list.length}</h1><div class="busy"><div class="spin"></div>写真を撮っています…</div>`;
  await frame2();
  const q = makeQuestion(QZ.list[QZ.i]);
  const imgs = q.setups.map(s => studio.shoot(s, { w: q.grid ? 160 : 240, h: q.grid ? 200 : 300, samples: 20, url: true }).url);
  const T = QUIZ_TYPES.find(t => t.id === q.type);
  if (q.grid) {
    v.innerHTML = `<h1>クイズ ${QZ.i + 1}/${QZ.list.length}<span class="mute">　${T.title}</span></h1><p>${esc(q.q)}</p>
      <div class="qgrid"><div><img src="${imgs[0]}" style="width:100%;border-radius:8px;border:2px solid var(--accent)"><div class="mute" style="text-align:center">今</div></div></div>
      <div class="qgrid" id="qg" style="margin-top:8px">${imgs.slice(1).map((u, i) => `<button data-i="${i}"><img src="${u}"><b>${'ABC'[i]}</b></button>`).join('')}</div><div id="qex"></div>`;
  } else {
    v.innerHTML = `<h1>クイズ ${QZ.i + 1}/${QZ.list.length}<span class="mute">　${T.title}</span></h1><img class="qimg" src="${imgs[0]}"><p><b>${esc(q.q)}</b></p><div class="qopts" id="qg">${q.opts.map((o, i) => `<button data-i="${i}">${esc(o)}</button>`).join('')}</div><div id="qex"></div>`;
  }
  $$('#qg button').forEach(b => b.onclick = () => {
    if (QZ.answered) return; QZ.answered = true; const i = +b.dataset.i; const ok = i === q.a; if (ok) QZ.ok++;
    const st = DB.quiz[q.type] || (DB.quiz[q.type] = { n: 0, ok: 0 }); st.n++; if (ok) st.ok++; save();
    $$('#qg button').forEach(x => { if (+x.dataset.i === q.a) x.classList.add('ok'); else if (x === b) x.classList.add('ng'); });
    $('#qex').innerHTML = `<div class="why" style="margin-top:10px"><b>${ok ? '正解' : '不正解'}</b><br>${esc(q.explain)}</div><button class="big" id="qNext" style="margin-top:10px">次へ</button>`;
    $('#qNext').onclick = () => { QZ.i++; QZ.answered = false; showQuiz(); };
  });
}


/* ================= 実物チェック（撮った写真を測る） ================= */
// 写真はこの端末の中だけで処理し、どこにも送らない。
const RC = { img: null, box: null, bg: 'white', target: '', res: null };
function renderReal() {
  const tasks = realSteps.flatMap(st => st.tasks.map(t => [t.id, `${st.title}：${t.title}`]));
  $('#v-real').innerHTML = `<h1>実物チェック</h1>
  <div class="why"><b>なぜやる？</b><br>3Dで覚えたことが実物でも同じかを、数字で確かめます。撮った写真の「明暗差・白飛び・背景の明るさ・光の向き・色かぶり」を測って、次に直すことを1つ返します。写真はこの端末の中だけで処理し、どこにも送りません。</div>
  <h2>1. 写真を選ぶ</h2>
  <label class="big" style="text-align:center;display:block">📷 撮影する／写真を選ぶ<input type="file" id="rcFile" accept="image/*" capture="environment" style="display:none"></label>
  <div class="row" style="margin-top:10px"><span class="mute">背景：</span><span class="opts" id="rcBg">${[['white', '白い紙'], ['black', '黒'], ['other', 'その他']].map(([v, n]) => `<button data-v="${v}" class="${RC.bg === v ? 'on' : ''}">${n}</button>`).join('')}</span></div>
  <div class="ctl"><label>3Dの見本と比べる（任意）</label><select id="rcTarget" style="width:100%"><option value="">比べない</option>${tasks.map(([id, n]) => `<option value="${id}" ${RC.target === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
  <h2>2. 被写体を指で囲む</h2>
  <div class="mute">写真の上をドラッグして、被写体がちょうど入る四角を作ります。</div>
  <div id="rcWrap"><canvas id="rcCv" width="400" height="300"></canvas><div id="rcBox"></div>${RC.img ? '' : '<div class="mute" style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none">ここに写真が出ます</div>'}</div>
  <button class="big" id="rcGo" style="margin-top:10px" ${RC.img ? '' : 'disabled'}>3. 測る</button>
  <div id="rcOut"></div>
  <h2>撮るときのコツ</h2><ul class="l"><li>カメラはM・ISO100・1/160秒・f/8、ホワイトバランスは太陽光で固定。</li><li>JPEGで撮った写真をそのまま使う（加工した写真は測れません）。</li><li>被写体が画面の真ん中あたりに、ある程度大きく写るように。</li></ul>`;
  $('#rcFile').onchange = e => { const f = e.target.files[0]; if (!f) return; if (RC.url) URL.revokeObjectURL(RC.url); const url = RC.url = URL.createObjectURL(f); const im = new Image(); im.onload = () => { RC.img = im; RC.box = null; RC.res = null; renderReal(); $('#rcGo').disabled = false; $('#rcOut').innerHTML = ''; }; im.src = url; };
  $$('#rcBg button').forEach(b => b.onclick = () => { RC.bg = b.dataset.v; $$('#rcBg button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#rcTarget').onchange = e => RC.target = e.target.value;
  $('#rcGo').onclick = () => runRC();
  const wrap = $('#rcWrap'); let st = null;
  const pos = e => { const r = $('#rcCv').getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  wrap.onpointerdown = e => { if (!RC.img) return; wrap.setPointerCapture(e.pointerId); st = pos(e); RC.box = [...st, ...st]; drawBox(); };
  wrap.onpointermove = e => { if (!st) return; const p = pos(e); RC.box = [Math.min(st[0], p[0]), Math.min(st[1], p[1]), Math.max(st[0], p[0]), Math.max(st[1], p[1])]; drawBox(); };
  wrap.onpointerup = () => { st = null; };
  if (RC.img) drawRC();
}
function drawRC() { const c = $('#rcCv'); const im = RC.img; const W = Math.min(1200, im.naturalWidth); c.width = W; c.height = Math.round(W * im.naturalHeight / im.naturalWidth); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); drawBox(); }
function drawBox() { const b = $('#rcBox'); if (!RC.box) { b.style.display = 'none'; return; } const [x0, y0, x1, y1] = RC.box; Object.assign(b.style, { display: 'block', left: x0 * 100 + '%', top: y0 * 100 + '%', width: (x1 - x0) * 100 + '%', height: (y1 - y0) * 100 + '%' }); }
function measurePhoto() {
  const im = RC.img; const W = 320, H = Math.round(W * im.naturalHeight / im.naturalWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data;
  let [x0, y0, x1, y1] = RC.box && (RC.box[2] - RC.box[0]) > 0.04 && (RC.box[3] - RC.box[1]) > 0.04 ? RC.box : [0.3, 0.25, 0.7, 0.85];
  const X0 = Math.floor(x0 * W), X1 = Math.ceil(x1 * W), Y0 = Math.floor(y0 * H), Y1 = Math.ceil(y1 * H), XM = (X0 + X1) / 2;
  const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = new Float32Array(256).map((_, i) => s2l(i));
  const inY = [], bg = [], bgRGB = [0, 0, 0]; let clip = 0, n = 0, left = 0, nl = 0, right = 0, nr = 0, nb = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2]; const Y = 0.2126 * L[r] + 0.7152 * L[gg] + 0.0722 * L[b];
    if (x >= X0 && x < X1 && y >= Y0 && y < Y1) { inY.push(Y); n++; if (Math.max(r, gg, b) >= 250) clip++; if (x < XM) { left += Y; nl++; } else { right += Y; nr++; } }
    else if (y < H * 0.3 || (y < Y0)) { bg.push(Y); bgRGB[0] += L[r]; bgRGB[1] += L[gg]; bgRGB[2] += L[b]; nb++; }
  }
  inY.sort((a, b) => a - b); bg.sort((a, b) => a - b);
  const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
  const pct = Y => Math.round(100 * (Y <= 0.0031308 ? Y * 12.92 : 1.055 * Math.pow(Y, 1 / 2.4) - 0.055));
  const lr = Math.log2((left / Math.max(nl, 1) + 0.003) / (right / Math.max(nr, 1) + 0.003));
  const rb = nb ? (bgRGB[0] + 1e-4) / (bgRGB[2] + 1e-4) : 1;
  return { contrast: Math.log2((q(inY, 0.9) + 0.003) / (q(inY, 0.1) + 0.003)), clip: n ? clip / n * 100 : 0, midPct: pct(q(inY, 0.5)), bgPct: pct(q(bg, 0.5)), lr, rb };
}
async function runRC() {
  if (!RC.img) return; const m = measurePhoto(); const adv = [];
  const side = m.lr > 0.35 ? '左' : m.lr < -0.35 ? '右' : null;
  if (m.clip > 2) adv.push(['白飛び', `被写体の${m.clip.toFixed(0)}%が真っ白です。V1の出力を1/3〜2/3段下げるか、絞りを1/3〜2/3段絞ってください。`]);
  if (RC.bg === 'white' && m.bgPct < 82) adv.push(['背景', `白い背景が${m.bgPct}%でグレーに写っています。被写体を背景に近づけるか、光を背景側に回してください。`]);
  if (RC.bg === 'black' && m.bgPct > 12) adv.push(['背景', `黒い背景が${m.bgPct}%で浮いています。背景を被写体から離すか、部屋を暗くしてください。`]);
  if (m.contrast > 3) adv.push(['影', `明暗差が約${m.contrast.toFixed(1)}段と大きく、影が重いです。影側に白い紙を近づけてください。`]);
  if (m.contrast < 0.8 && !m.clip) adv.push(['立体感', `明暗差が約${m.contrast.toFixed(1)}段しかなく、のっぺりしています。光を横〜斜め後ろへ回すか、影側に黒い紙を立ててください。`]);
  if (RC.bg !== 'black' && m.rb > 1.15) adv.push(['色', '背景が黄色っぽく写っています。ホワイトバランスを「太陽光」に固定し、部屋の電気を消してください。']);
  if (RC.bg !== 'black' && m.rb < 0.87) adv.push(['色', '背景が青っぽく写っています。ホワイトバランスを「太陽光」（またはストロボ）に固定してください。']);
  let cmp = '';
  if (RC.target) {
    ensureStudio(); const t = realSteps.flatMap(s => s.tasks).find(x => x.id === RC.target);
    $('#rcOut').innerHTML = `<div class="busy"><div class="spin"></div>見本を撮影しています…</div>`; await frame2();
    const T = studio.shoot(t.target, { w: 200, h: 250, samples: 24, url: true }); const tm = T.m;
    const tside = tm.boxLR > 0.35 ? '左' : tm.boxLR < -0.35 ? '右' : null; const tc = tm.boxContrast; // 実物と同じ測り方（囲んだ四角の中）
    const d1 = Math.abs(tc - m.contrast), d2 = Math.abs(tm.bgPct - m.bgPct) / 25, d3 = tside && side && tside !== side ? 1 : 0;
    const score = Math.round(100 * Math.exp(-(0.8 * d1 + d2 + d3)));
    cmp = `<h2>見本との比べっこ：${score}点</h2><div class="cmp"><div>3Dの見本<img src="${T.url}"></div><div>あなたの写真<img src="${$('#rcCv').toDataURL('image/jpeg', 0.8)}"></div></div>
      <div class="mrow"><span>明暗差（囲んだ四角の中）</span><b>見本 ${tc.toFixed(1)}段 / 実物 ${m.contrast.toFixed(1)}段</b></div>
      <div class="mrow"><span>背景</span><b>見本 ${tm.bgPct}% / 実物 ${m.bgPct}%</b></div>
      <div class="mrow"><span>光の来る側</span><b>見本 ${tside || '正面か後ろ'} / 実物 ${side || 'はっきりしない'}</b></div>
      <p class="mute">3Dと実物は数値がぴったりは一致しません（3Dの限界）。向きと差の大きさが近ければ、3Dで覚えたことが実物でもできています。</p>`;
    for (let i = adv.length - 1; i >= 0; i--) { if (adv[i][0] === '背景' && Math.abs(tm.bgPct - m.bgPct) < 10) adv.splice(i, 1); if (adv[i] && (adv[i][0] === '影' || adv[i][0] === '立体感') && Math.abs(tc - m.contrast) < 0.5) adv.splice(i, 1); } // 見本どおりなら言わない
    if (tside && side && tside !== side) adv.unshift(['光の向き', `見本は光が${tside}から来ていますが、あなたの写真は${side}側が明るいです。`]);
    else if (tc - m.contrast > 0.5) adv.unshift(['影', '見本より影が薄いです。影側の白い紙を離すか、黒い紙に替えてください。']);
    else if (m.contrast - tc > 0.5) adv.unshift(['影', '見本より影が濃いです。影側に白い紙を近づけてください。']);
  }
  markToday('real'); save();
  $('#rcOut').innerHTML = `<h2>結果</h2>
   <div class="mrow"><span>明暗差（被写体の中）</span><b>約${m.contrast.toFixed(1)}段</b></div>
   <div class="mrow"><span>白飛び（被写体の中）</span><b>${m.clip.toFixed(1)}%</b></div>
   <div class="mrow"><span>背景の明るさ</span><b>${m.bgPct}%</b></div>
   <div class="mrow"><span>明るい側</span><b>${side || 'はっきりしない（正面か後ろからの光）'}</b></div>
   <h3>次に直すこと</h3>${adv.length ? `<div class="adv"><b>${esc(adv[0][0])}</b>：${esc(adv[0][1])}</div>${adv.length > 1 ? `<details><summary class="mute">ほかに気になる点（${adv.length - 1}）</summary>${adv.slice(1).map(a => `<div class="adv"><b>${esc(a[0])}</b>：${esc(a[1])}</div>`).join('')}</details>` : ''}` : '<div class="adv">大きな問題は見つかりませんでした。3Dの見本と比べて、狙いどおりか確認しましょう。</div>'}
   <p class="mute">直すのは1回に1つだけ。直したらもう一度撮って測ると、どれが効いたかがはっきりします。被写体を囲んだ四角には背景も少し入るので、数値は目安です。</p>${cmp}`;
}

/* ================= ホーム・ステップ・手順 ================= */
let planQueue = [];
// プランの続きへ。今日もう終わった項目は飛ばす。続きがなければ false
function nextPlan() {
  const done = doneToday();
  while (planQueue.length) { const it = planQueue.shift(); if (!done[it.dk || it.k]) { it.go(); return true; } }
  return false;
}
// 今日のプランは、その日の最初に決めたら1日変えない（終わった項目が消えたり入れ替わったりしないように）
function planItem(k) {
  const [kind, id] = k.split(':'); const stOf = tid => realSteps.find(s => s.tasks.some(t => t.id === tid) || s.fixes.some(f => f.id === tid));
  if (kind === 'quiz') return { tag: 'q', tagN: 'クイズ', t: 'ウォームアップ：光の読み取り 5問', d: '写真から光の向き・大きさ・反射板を読む。見本合わせの「読む力」の土台', min: 3, go: () => { tab('quiz'); startQuiz(); } };
  if (kind === 'phone') return { tag: 'r', tagN: '手', t: 'スマホが反射板（3ラウンド）', d: '被写体を見ながら反射板の角度を探す動き。白と銀の違い', min: 3, go: () => startPhone(0) };
  if (kind === 'real') return { tag: 'r', tagN: '実物', t: '実物チェック（任意）', d: '家で撮った写真を測って、3Dの見本と比べる', min: 5, go: () => tab('real') };
  if (kind === 'lab') { const st = stepOf(id); return st && { tag: '', tagN: '新', t: `実験：${st.title}`, d: '予想 → 自分で動かして確かめる → 答え合わせ', min: 5, go: () => startLab(st) }; }
  if (kind === 'match' || kind === 'review') { const st = stOf(id); const t = st && st.tasks.find(x => x.id === id); return t && { tag: kind === 'review' ? 'r' : '', tagN: kind === 'review' ? '復習' : '見本', t: `見本合わせ：${t.title}`, d: kind === 'review' ? `${st.title}（間をあけて思い出す）` : st.title, min: kind === 'review' ? 4 : 5, go: () => startMatch(st, t), dk: 'match:' + id }; }
  if (kind === 'fix') { const st = stOf(id); const f = st && st.fixes.find(x => x.id === id); return f && { tag: 'f', tagN: '直す', t: `失敗直し：${f.title}`, d: f.client, min: 3, go: () => startFix(st, f) }; }
  return null;
}
function planKeys() {
  const cur = currentStep(); const curIdx = realSteps.indexOf(cur); const K = ['quiz'];
  if (curIdx >= 2) K.push('phone');
  if (!DB.pred[cur.id]) K.push('lab:' + cur.id);
  const nextT = cur.tasks.find(t => !(DB.best[t.id] && DB.best[t.id].pass));
  if (nextT) K.push('match:' + nextT.id);
  const past = realSteps.slice(0, curIdx).flatMap(s => s.tasks.map(t => ({ t, b: DB.best[t.id] })));
  if (past.length) { past.sort((a, b) => (a.b ? a.b.score : 0) - (b.b ? b.b.score : 0) || ((a.b && a.b.date) || '').localeCompare((b.b && b.b.date) || '')); K.push('review:' + past[0].t.id); }
  else if (nextT) { const t2 = cur.tasks.find(t => t !== nextT && !(DB.best[t.id] && DB.best[t.id].pass)); if (t2) K.push('match:' + t2.id); }
  const pool = realSteps.slice(0, curIdx + 1).flatMap(s => s.fixes); const nextF = cur.fixes.find(f => !DB.fix[f.id]) || (pool.length ? pool[[...today()].reduce((a, c) => a + c.charCodeAt(0), 0) % pool.length] : null);
  if (nextF) K.push('fix:' + nextF.id);
  if (Object.keys(DB.real).some(k => DB.real[k])) K.push('real');
  return K;
}
function todaysPlan() {
  doneToday(); if (!DB.today.plan) { DB.today.plan = planKeys(); save(); }
  const done = DB.today.done;
  return DB.today.plan.map(k => { const it = planItem(k); return it && { ...it, k, done: !!done[it.dk || k] }; }).filter(Boolean);
}
function renderHome() {
  if (!DB.seenIntro) { setTimeout(() => { DB.seenIntro = true; save(); }, 0); }
  const cur = currentStep(); const plan = todaysPlan(); const total = plan.reduce((a, b) => a + b.min, 0);
  const allP = realSteps.map(stepProgress); const done = allP.reduce((a, b) => a + b.done, 0), all = allP.reduce((a, b) => a + b.total, 0);
  $('#v-home').innerHTML = `
  <div class="top"><a href="index.html">‹ ジンバル練習へ</a><span class="mute">${done}/${all} クリア</span></div>
  <h1>ライティング練習ラボ</h1>
  ${DB.seenIntro ? `<details class="why"><summary><b>この練習の目的</b></summary>` : `<div class="why"><b>この練習の目的</b><br>`}反射板やライトがなくても、3Dのスタジオで<b>写真から光を読む目</b>と、<b>どこを動かすと何が変わるか</b>、<b>本番の手順</b>を身につけます。実物でしか覚えられない手の動きは、各ステップの「家で実物で確かめる」で補います。${DB.seenIntro ? '</details>' : '</div>'}
  <h2>今日の練習プラン（約${total}分）</h2>
  <div class="mute">いまのステップ：<b style="color:var(--text)">${cur.lv}・${esc(cur.title)}</b>。終わった項目には✓がつきます。</div>
  <button class="big" id="hStart" style="margin-top:10px">${plan.every(p => p.done) ? '今日のプランは完了 ✓' : plan.some(p => p.done) ? 'プランの続きから' : 'プランを通しで始める'}</button>
  <div class="plan">${plan.map((p, i) => `<button class="drill ${p.done ? 'done' : ''}" data-i="${i}"><span class="no">${p.done ? '✓' : i + 1}</span><span><b><span class="tag ${p.tag}">${p.tagN}</span>${esc(p.t)}</b><small>${esc(p.d)}</small></span><span class="mute">${p.min}分</span></button>`).join('')}</div>
  <h2>自由に触る</h2>
  <div class="row"><button class="ghost" id="hFree">自由ラボ</button><button class="ghost" id="hPhone">スマホが反射板</button><button class="ghost" id="hSteps">ステップ一覧</button><button class="ghost" id="hGear">機材の準備と設定</button><button class="ghost" id="hReal">📷 実物チェック</button></div>
  <div class="card" style="font-size:13px"><b>家で実物で確かめる（任意）</b><br><span class="mute">いまのステップ「${esc(cur.title)}」の実物練習：${esc(cur.real.items)}。手順はステップのページにあります。</span></div>`;
  $$('#v-home .drill').forEach(b => b.onclick = () => { planQueue = []; ST.inPlan = false; plan[+b.dataset.i].go(); });
  $('#hStart').onclick = () => { const rest = plan.filter(p => !p.done); if (!rest.length) { flashHome('今日のプランは全部終わりました。おつかれさまでした！'); return; } planQueue = rest.slice(1); ST.inPlan = true; rest[0].go(); };
  $('#hFree').onclick = () => { planQueue = []; ST.inPlan = false; openStudio({ mode: 'free', title: '自由ラボ', setup: defaultSetup(), brief: '<span class="mute">配置図でライトや反射板をドラッグ。下のタブで種類・高さ・背景・カメラを変えられます。</span>' }); };
  $('#hPhone').onclick = () => { planQueue = []; ST.inPlan = false; startPhone(0); };
  $('#hSteps').onclick = () => tab('steps');
  $('#hReal').onclick = () => tab('real');
  $('#hGear').onclick = () => { tab('guide'); setTimeout(() => { const el = $('#gearSetup'); if (el) el.scrollIntoView(); }, 30); };
}
function flashHome(msg) { const el = document.createElement('div'); el.className = 'why'; el.textContent = msg; $('#v-home').prepend(el); setTimeout(() => el.remove(), 3000); }
function renderSteps() {
  CUR_STEP = null; const cur = currentStep();
  $('#v-steps').innerHTML = `<h1>ステップ</h1><div class="mute">おすすめは上から順。どこからでも始められます。</div>` + STEPS.map(s => {
    if (s.soon) return `<div class="stepcard soon"><span class="chip">${s.lv}</span> <b>${esc(s.title)}</b><div class="mute">第3段階で追加予定</div></div>`;
    const p = stepProgress(s);
    return `<button class="stepcard ${s === cur ? 'cur' : ''}" data-id="${s.id}"><div class="row sp"><span><span class="chip ${p.clear ? 'g' : s === cur ? 'a' : ''}">${s.lv}</span> <b>${esc(s.title)}</b></span><span class="mute">${p.done}/${p.total}</span></div><div class="mute" style="margin-top:4px">${esc(OBJECTS[s.obj].name)}</div><div class="bar"><i style="width:${p.total ? p.done / p.total * 100 : 0}%"></i></div></button>`;
  }).join('');
  $$('#v-steps .stepcard[data-id]').forEach(b => b.onclick = () => openStep(b.dataset.id));
}
let CUR_STEP = null;
function openStep(id) {
  tab('steps'); CUR_STEP = id; const s = stepOf(id); DB.visited[id] = true; save();
  const sc = t => { const b = DB.best[t.id]; return b ? `<span class="score" style="color:${b.pass ? 'var(--good)' : 'var(--warn)'}">${b.score}</span>` : '<span class="mute">未</span>'; };
  $('#v-steps').innerHTML = `<div class="top"><a href="#" id="stBack">‹ ステップ一覧</a><span class="chip a">${s.lv}</span></div>
  <h1>${esc(s.title)}</h1>
  <div class="why"><b>なぜ練習する？</b><br>${esc(s.why)}</div>
  <h2>覚えること</h2><ul class="l">${s.learn.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  <h2>1. 実験（予想してから試す）</h2>
  <button class="drill ${DB.pred[s.id] ? 'done' : ''}" id="sLab"><span class="no">${DB.pred[s.id] ? '✓' : '?'}</span><span><b>${esc(s.lab.predict.q)}</b><small>予想 → 動かして確かめる → 答え合わせ</small></span><span></span></button>
  <h2>2. 見本合わせ</h2><div class="mute">見本と同じ写りを作る。採点は隠れていて、判定は3回まで。</div>
  <div class="plan">${s.tasks.map((t, i) => `<button class="drill ${DB.best[t.id] && DB.best[t.id].pass ? 'done' : ''}" data-t="${i}"><span class="no">${DB.best[t.id] && DB.best[t.id].pass ? '✓' : i + 1}</span><span><b>${esc(t.title)}</b><small>${esc(t.brief)}</small></span>${sc(t)}</button>`).join('')}</div>
  <h2>3. 失敗直し</h2><div class="mute">クライアントの言葉から原因を探して、少ない手数で直す。</div>
  <div class="plan">${s.fixes.map((f, i) => `<button class="drill ${DB.fix[f.id] ? 'done' : ''}" data-f="${i}"><span class="no">${DB.fix[f.id] ? '✓' : i + 1}</span><span><b>${esc(f.title)}</b><small>${esc(f.client)}</small></span><span class="mute">${DB.fix[f.id] ? DB.fix[f.id].moves + '手' : ''}</span></button>`).join('')}</div>
  <h2>4. 家で実物で確かめる（任意・5分）</h2>
  <div class="card"><div class="mute">用意するもの：${esc(s.real.items)}</div>${s.real.how.map((h, i) => `<label class="check"><input type="checkbox" data-r="${i}" ${DB.real[s.id + ':' + i] ? 'checked' : ''}><span>${esc(h)}</span></label>`).join('')}
  <div class="mute" style="margin-top:8px">3Dで分かったことが実物でも同じかを確かめる時間です。違ったところがあれば、それが実物ならではのポイントです。</div><button class="ghost sm" id="sReal" style="margin-top:8px">📷 撮った写真を実物チェックで測る</button></div>`;
  $('#stBack').onclick = e => { e.preventDefault(); renderSteps(); };
  $('#sReal').onclick = () => { RC.target = s.tasks[0] ? s.tasks[0].id : ''; tab('real'); };
  $('#sLab').onclick = () => { planQueue = []; ST.inPlan = false; startLab(s); };
  $$('#v-steps [data-t]').forEach(b => b.onclick = () => { planQueue = []; ST.inPlan = false; startMatch(s, s.tasks[+b.dataset.t]); });
  $$('#v-steps [data-f]').forEach(b => b.onclick = () => { planQueue = []; ST.inPlan = false; startFix(s, s.fixes[+b.dataset.f]); });
  $$('#v-steps [data-r]').forEach(c => c.onchange = () => { DB.real[s.id + ':' + c.dataset.r] = c.checked; if (c.checked) markToday('real:' + s.id); save(); });
  window.scrollTo(0, 0);
}
function renderQuizHome() {
  const st = QUIZ_TYPES.map(q => { const d = DB.quiz[q.id]; return `<tr><td>${esc(q.title)}</td><td>${d ? `${d.ok}/${d.n}` : '-'}</td></tr>`; }).join('');
  $('#v-quiz').innerHTML = `<h1>光の読み取りクイズ</h1>
  <div class="why"><b>なぜ練習する？</b><br>本番では、クライアントの見本写真や自分のカメラの画面を見て「光はどこから・どれくらいの大きさ・影側に何がある」を一瞬で読みます。ここではその読み取りを、30秒に1問のペースでたくさん繰り返します。</div>
  <button class="big" id="qStart" style="margin-top:12px">5問はじめる</button>
  <h2>これまでの正解率</h2><table class="m"><tr><th>種類</th><th>正解</th></tr>${st}</table>
  <p class="mute">問題の種類は、進めたステップに合わせて増えます。</p>`;
  $('#qStart').onclick = startQuiz;
}
function renderGuide() {
  $('#v-guide').innerHTML = `<h1>本番の手順</h1>
  <div class="mute">練習のどのメニューも、この順番で考えるように作っています。本番でもこの順番で。</div>
  <ol class="steps">${WORKFLOW.map(([t, d]) => `<li><b>${esc(t)}</b><small>${esc(d)}</small></li>`).join('')}</ol>
  <h2>撮影中に見るもの</h2>
  <table class="m"><tr><th>見るもの</th><th>何がわかる</th></tr>
  <tr><td>ゼブラ（しま模様）</td><td>白飛びしている所。商品の大事な面に出たら露出を下げる。</td></tr>
  <tr><td>ヒストグラム</td><td>右端に山が張りついたら白飛び、左端なら黒つぶれ。</td></tr>
  <tr><td>影のふち</td><td>光源の大きさと距離が合っているか。</td></tr>
  <tr><td>影側の面</td><td>反射板が効いているか。文字や色が読めるか。</td></tr>
  <tr><td>背景の明るさ</td><td>白背景なら 85〜95%。グレーに濁ったら背景との距離を見直す。</td></tr></table>
  <h2>各メニューが本番で役立つ理由</h2>
  <table class="m"><tr><th>メニュー</th><th>鍛えるもの</th><th>本番では</th></tr>
  <tr><td>クイズ</td><td>写真から光を読む目</td><td>見本写真の再現、テスト撮影の見直し</td></tr>
  <tr><td>実験</td><td>「動かすと何が変わるか」の予想</td><td>迷わず1回で正しい方向に動かせる</td></tr>
  <tr><td>見本合わせ</td><td>読む → 組む → 見比べる の一連</td><td>クライアントの指定どおりに撮る</td></tr>
  <tr><td>失敗直し</td><td>言葉から原因を探す・少ない手数</td><td>撮影現場での修正を早く終える</td></tr>
  <tr><td>スマホが反射板</td><td>被写体を見ながら角度を探す動き</td><td>レフ板持ち・自分で角度を合わせるとき</td></tr>
  <tr><td>家で実物で確かめる</td><td>3Dと実物の違い</td><td>機材の扱い、実物ならではのクセ</td></tr></table>
  <h2 id="gearSetup">機材の準備と設定（手持ちの機材用）</h2>
  <div class="mute">α7C II ＋ X3 Pro S（カメラの上）→ 無線 → V1（スタンドM＋S2ブラケット＋ソフトボックス60cm）</div>
  <h3>1. 組み立て</h3>
  <ol class="steps">
   <li><b>スタンドMを立てる</b><small>脚を広く開いて安定させる。ソフトボックスは風を受けやすいので、重しがあると安心。</small></li>
   <li><b>S2ブラケットを付ける</b><small>スタンドの先にS2ブラケットを差し込んで固定。</small></li>
   <li><b>ソフトボックスを開いてBowensマウントに付ける</b><small>布（2枚付属）を張る。2枚重ねるほどやわらかく、少し暗くなる。</small></li>
   <li><b>V1をS2ブラケットに付ける</b><small>発光部をソフトボックスの奥（正面）にまっすぐ向ける。横を向いていると光がムラになる。</small></li>
  </ol>
  <h3>2. V1 と X3 Pro をつなぐ</h3>
  <ol class="steps">
   <li><b>V1を「無線で受ける側」にする</b><small>X3 Proと同じチャンネル（CH）にそろえ、グループはAにする。操作の詳細はV1の説明書で確認。</small></li>
   <li><b>X3 Pro Sをα7C IIのシューに付ける</b><small>グループAを「M（マニュアル）」にする。TTL（自動）だと毎回明るさが変わり、光の練習にならない。</small></li>
   <li><b>出力は 1/4 から</b><small>3Dの「V1＋ソフトボックス60cm」の出力スライダーと同じ数字。1/3段ずつ動かす。</small></li>
   <li><b>スマホから調整する</b><small>X3 ProはBluetoothで「Godox Flash」アプリにつながる。カメラを三脚に据えたまま出力を変えられる。</small></li>
  </ol>
  <h3>3. α7C II の設定（物撮りの基本）</h3>
  <table class="m"><tr><th>項目</th><th>設定</th><th>理由</th></tr>
  <tr><td>撮影モード</td><td>M（マニュアル）</td><td>明るさを出力と絞りだけで決めるため</td></tr>
  <tr><td>シャッター</td><td>1/160秒</td><td>α7C IIのストロボ同調はフルサイズで1/160秒まで。部屋の電気も写りにくくなる</td></tr>
  <tr><td>シャッター方式</td><td>電子シャッターにしない</td><td>電子シャッターではストロボが光らない</td></tr>
  <tr><td>ISO</td><td>100</td><td>ノイズを減らす。明るさはストロボで足す</td></tr>
  <tr><td>絞り</td><td>f/8 前後</td><td>箱全体にピントが合う。3Dの露出スライダーの f/値と対応</td></tr>
  <tr><td>ホワイトバランス</td><td>太陽光（または 5500K）</td><td>オートだと写真ごとに色が変わる</td></tr>
  <tr><td>画質</td><td>RAW＋JPEG</td><td>あとで色と明るさを直せる</td></tr>
  <tr><td>表示</td><td>ゼブラ・ヒストグラムを出す</td><td>撮った写真の白飛びを確認する</td></tr></table>
  <h3>4. 試し撮りの手順</h3>
  <ol class="steps">
   <li><b>出力1/4・f/8で1枚撮る</b><small>3Dで練習した配置にスタンドを置いてから。</small></li>
   <li><b>明るさだけを合わせる</b><small>暗ければ出力を上げる、明るければ下げる（1/3段ずつ）。白い商品はゼブラが出ない所まで。</small></li>
   <li><b>次に影側を見る</b><small>反射板を置いて1枚。ストロボの光は撮るまで見えないので、1つ動かしたら1枚。</small></li>
   <li><b>同じ配置を記録する</b><small>スタンドの位置・高さ・出力をメモ。X3 Proは設定を保存して呼び出せる。</small></li>
  </ol>
  <p class="mute">出力の数字は3Dの計算からの目安です。実際の明るさはソフトボックスの布の枚数や部屋で変わるので、試し撮りで合わせてください。</p>
  <h2>手持ちの機材で撮るとき</h2>
  <table class="m"><tr><th>機材</th><th>3Dでは</th><th>本番のコツ</th></tr>
  <tr><td>Godox V1</td><td>ライトの種類「V1（そのまま）」「V1 天井バウンス」</td><td>光は撮るまで見えない。1つ動かすたびに1枚撮って確認。モデリングランプは弱く黄色い（3200K）ので向きの目安だけに。</td></tr>
  <tr><td>ソフトボックス 60×60cm（SGUV6060）</td><td>「V1＋ソフトボックス60cm」</td><td>やわらかさは距離で決まる。50cm前後まで寄せるととてもやわらか、1.5m以上離すと硬め。</td></tr>
  <tr><td>送信機 Godox X3 Pro（ソニー用）</td><td>ライトの「出力」スライダー（1/1〜1/256）</td><td>まずはTTLではなくM（マニュアル）で。出力は1/3段ずつ動かせるので3Dと同じ感覚で使える。距離を2倍にしたら2段上げる。Bluetoothでスマホの「Godox Flash」アプリからも出力を変えられるので、カメラを三脚に据えたまま調整できる。</td></tr>
  <tr><td>α7C II</td><td>カメラタブの「露出」（f/値で表示）</td><td>ISO100・1/160秒・f/8が基準。3Dで露出を+1段にした所は、本番では絞りを1段開けるか出力を1段上げる。</td></tr>
  <tr><td>ライトスタンドM</td><td>ライトの「高さ（角度）」と「距離」</td><td>高さは被写体から見た角度で考える。斜め上30〜45°が基本。</td></tr></table>
  <p class="mute">ストロボは一瞬しか光らないので、部屋の電気の色はほとんど写りません（シャッター速度を上げるほど消える）。窓の光と混ぜるときは、窓の光は普通に写る点に注意。</p>
  <h2>この練習の作りについて</h2>
  <ul class="l"><li>見本合わせの点数を隠しているのは、点数を見ながら動かすと「数字合わせ」になって、写真を読む力がつかないからです。</li><li>判定のたびに出るヒントは、見本との違いのうち「直すといちばん写真が近づくもの」を1つだけ、写真の見え方の言葉で伝えます。</li><li>失敗直しは、正解のセットを1つに決めず、結果（明暗差・白飛び・背景の明るさ）で判定します。現場でも直し方は1つではありません。</li><li>今日のプランには、前のステップの復習を混ぜています。間をあけて思い出すほうが、本番で思い出せるからです。</li></ul>
  <h2>3Dと実物の違い</h2><ul class="l">${LIMITS.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  <h2>記録</h2><button class="ghost" id="gReset">練習の記録を消す</button>`;
  $('#gReset').onclick = () => { if (confirmReset()) { localStorage.removeItem(SK); location.reload(); } };
}
let resetArm = 0; function confirmReset() { if (Date.now() - resetArm < 4000) return true; resetArm = Date.now(); $('#gReset').textContent = 'もう一度押すと消えます'; return false; }

function tab(name) { $$('.view').forEach(v => v.classList.remove('on')); $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); $('#v-' + name).classList.add('on'); if (name === 'home') renderHome(); if (name === 'steps') renderSteps(); if (name === 'quiz' && !QZ) renderQuizHome(); if (name === 'guide') renderGuide(); if (name === 'real') renderReal(); window.scrollTo(0, 0); }
$$('#tabbar button').forEach(b => b.onclick = () => { if (b.dataset.tab === 'quiz') QZ = null; tab(b.dataset.tab); });
function renderAll() { renderHome(); }

/* ================= ブラウザの「戻る」＝ひとつ上の階層へ ================= */
// 表示中のいちばん上の層を閉じる。閉じるものがなければ false
function goUp() {
  if ($('#sheet').classList.contains('on')) { closeSheet(); return true; }
  if (ST.open) { closeStudio(); return true; }
  const curTab = ($$('#tabbar button').find(b => b.classList.contains('on')) || {}).dataset?.tab || 'home';
  if (curTab === 'steps' && CUR_STEP) { renderSteps(); window.scrollTo(0, 0); return true; }
  if (curTab !== 'home') { QZ = null; tab('home'); return true; }
  return false;
}
history.replaceState({ nav: 'root' }, ''); history.pushState({ nav: 'guard' }, '');
window.addEventListener('popstate', () => {
  if (goUp()) history.pushState({ nav: 'guard' }, '');
  else location.replace('index.html'); // ホームでさらに戻る → 練習ラボのトップへ
});
renderHome();
window.__lab = { ST, DB, STEPS, startMatch, startFix, startLab, startPhone, startQuiz, openStudio, tab, openStep };
