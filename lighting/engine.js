// ライティング練習ラボ — 3Dスタジオのエンジン
// 方針：
//  ・メイン／補助ライトは「面光源」。毎フレーム光源面の上の別の点から影付きで照らし、結果を平均する（蓄積）。
//    → 影のふちの柔らかさが「光源の大きさ」と「距離」から物理的に決まる。
//  ・反射板・部屋の壁・テーブル・背景の照り返しは、被写体の位置から見た「周りの景色（環境マップ）」として計算する。
//    → 反射板は近いほど・大きいほど効く。黒い板は壁の照り返しを消す。銀は向きが合ったときだけ強く返す。
//  ・数値は display（sRGB, 0〜100%）で測る。カメラのゼブラ・ヒストグラムと同じ考え方。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const D = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- 道具の定義 ---------------- */
// base：既定の距離で被写体の明るさ（照度）がおよそ 3 になる強さ
export const LIGHTS = {
  window: { name: '窓（レース越し）', short: '窓', w: 1.0, h: 1.2, def: 1.4, kelvin: 6000, note: '大きくやわらかい。家でいちばん手に入る光' },
  sun:    { name: '窓（直射日光）', short: '直射', w: 0, h: 0, def: 3, kelvin: 5200, directional: true, note: '太陽は遠くて小さいので、影がくっきり' },
  v1:     { name: 'V1（そのまま）', short: 'V1', w: 0.075, h: 0.075, def: 0.9, kelvin: 5600, flash: true, base: 4, note: 'Godox V1の丸い発光部（直径約7.5cm）。小さいので影がくっきり' },
  v1soft: { name: 'V1＋ソフトボックス60cm', short: 'V1＋ソフト60', w: 0.6, h: 0.6, def: 0.9, kelvin: 5600, flash: true, base: 2, note: 'お持ちのGodox SGUV6060（60×60cm、S2ブラケット）。発光面が60cmになり影がやわらかい' },
  v1bounce:{ name: 'V1 天井バウンス', short: 'バウンス', w: 1.4, h: 1.4, def: 1.6, kelvin: 5600, flash: true, base: 1, note: 'V1を天井に向けて光らせる。天井が大きな光源になり、上からやわらかく当たる' },
  led:    { name: 'LEDライト（そのまま）', short: 'LED', w: 0.07, h: 0.07, def: 0.8, kelvin: 5600, note: '小さいので影が硬い' },
  softbox:{ name: 'ソフトボックス 60cm', short: 'ソフト', w: 0.6, h: 0.6, def: 0.9, kelvin: 5600, note: 'LEDに箱と布をかぶせて大きくした光' },
  strip:  { name: 'ストリップ 30×120cm', short: 'ストリップ', w: 0.3, h: 1.2, def: 0.9, kelvin: 5600, note: '細長いソフトボックス。ツヤのある物に細長い光を写す' },
};
const E_REF = 3; // 既定距離での照度
export const REFL = {
  white: { name: '白', color: '#f4f4f0' },
  silver:{ name: '銀', color: '#c9ccd1' },
  gold:  { name: '金', color: '#d9b36a' },
  black: { name: '黒', color: '#151515' },
};
export const REFL_SIZE = { s: { name: '小 30cm', w: 0.3, h: 0.3 }, m: { name: '中 60cm', w: 0.6, h: 0.45 }, l: { name: '大 100cm', w: 1.0, h: 0.7 } };
export const BGS = {
  white: { name: '白い紙', albedo: 0.86, color: '#f3f2ee' },
  gray:  { name: 'グレーの紙', albedo: 0.3, color: '#8e8e8c' },
  black: { name: '黒い紙', albedo: 0.04, color: '#363636' },
  wood:  { name: '木のテーブル＋白い壁', albedo: 0.3, color: '#a77a52', wall: 0.7 },
};
export const ROOMS = {
  white: { name: '白い壁の部屋（電気は消す）', k: 0.08 },
  dark:  { name: '暗い部屋（壁が暗い）', k: 0.008 },
  lamp:  { name: '白い壁＋天井の電気がついたまま', k: 0.08, lamp: true },
};
export const OBJECTS = {
  box_white: { name: '白い商品箱', group: 'マット' },
  box_kraft: { name: 'クラフトの箱', group: 'マット' },
  box_black: { name: '黒い商品箱', group: 'マット' },
  wood:      { name: '木のブロック', group: 'マット' },
  towel:     { name: 'たたんだタオル', group: 'マット' },
  bread:     { name: 'ロールパン', group: '食品' },
  cookies:   { name: 'クッキー', group: '食品' },
  apple:     { name: 'りんご', group: '食品' },
  orange:    { name: 'オレンジ', group: '食品' },
  icecoffee: { name: 'アイスコーヒー', group: 'ドリンク' },
  juice:     { name: 'オレンジジュース', group: 'ドリンク' },
  phone:     { name: 'スマホ', group: 'ガジェット' },
  earbuds:   { name: 'イヤホンケース', group: 'ガジェット' },
  bottle:    { name: '化粧品ボトル', group: '光沢' },
  glassbottle:{ name: 'ガラス瓶（空）', group: 'ガラス' },
  tumbler:   { name: 'ステンレスタンブラー', group: '金属' },
  ring:      { name: '指輪', group: '金属' },
};

export function defaultSetup() {
  return {
    obj: 'box_white', room: 'white',
    bg: { type: 'white', dist: 0.45 },
    cam: { el: 30, focal: 50, ev: 0 },
    key: { type: 'window', az: -60, el: 30, dist: 1.4, pow: 0 },
    fill: null,
    refl: [],
  };
}
export const cloneSetup = s => JSON.parse(JSON.stringify(s));

/* ---------------- 色温度 ---------------- */
export function kelvinRGB(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = new THREE.Color(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255);
  c.convertSRGBToLinear();
  const w = new THREE.Color(1, 1, 1); // 5500K を白に（WB 太陽光）
  const ref = kelvinRef || (kelvinRef = (() => { const x = 55; const rr = 255, gg = 99.47 * Math.log(x) - 161.12, bb = 138.52 * Math.log(x - 10) - 305.04; const cc = new THREE.Color(rr / 255, gg / 255, bb / 255); cc.convertSRGBToLinear(); return cc; })());
  return new THREE.Color(c.r / ref.r, c.g / ref.g, c.b / ref.b);
}
let kelvinRef = null;

/* ---------------- 便利関数 ---------------- */
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
export function polar(az, el, d, cy) { // az: 0=カメラ側, +=右, 180=奥（逆光）
  return new THREE.Vector3(d * Math.cos(el * D) * Math.sin(az * D), cy + d * Math.sin(el * D), d * Math.cos(el * D) * Math.cos(az * D));
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---------------- 被写体 ---------------- */
function std(o) { return new THREE.MeshStandardMaterial(o); }
// ツヤのある物の材質：映り込み（鏡面）は「光源の形も写る景色」だけから、拡散光は「光源を含まない景色」から取る。
// こうすると、ライトの形がそのままハイライトの形になり、明るさも二重に足されない。
export const SPEC_MATS = new Set();
function patchSpec(m) {
  m.userData.spec = true; m.userData.uniforms = { envMapDiffuse: { value: null } };
  m.onBeforeCompile = sh => {
    sh.uniforms.envMapDiffuse = m.userData.uniforms.envMapDiffuse;
    sh.fragmentShader = 'uniform sampler2D envMapDiffuse;\n' + sh.fragmentShader
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  { vec3 wn = inverseTransformDirection( geometryNormal, viewMatrix ); iblIrradiance = PI * textureCubeUV( envMapDiffuse, wn, 1.0 ).rgb * envMapIntensity; }
#endif`)
      .replace('#include <aomap_fragment>', `reflectedLight.directSpecular = vec3( 0.0 );
#ifdef USE_CLEARCOAT
  clearcoatSpecularDirect = vec3( 0.0 );
#endif
#include <aomap_fragment>`);
  };
  m.customProgramCacheKey = () => 'spec';
  SPEC_MATS.add(m); return m;
}
function phys(o) { return new THREE.MeshPhysicalMaterial(o); }

function labelTex(bg, ink, sub, big = 'LUMEN') {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = ink; g.textAlign = 'center';
    g.font = '700 84px Helvetica, Arial, sans-serif'; g.fillText(big, w / 2, h * 0.47);
    g.font = '400 30px Helvetica, Arial, sans-serif'; g.fillText(sub, w / 2, h * 0.58);
    g.fillRect(w * 0.38, h * 0.66, w * 0.24, 4);
  });
}
function woodTex(seed = 3) {
  const r = rng(seed);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8895c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) { const y = r() * h; g.strokeStyle = `rgba(${90 + r() * 40},${55 + r() * 25},${30 + r() * 15},${0.12 + r() * 0.25})`; g.lineWidth = 1 + r() * 3; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4 + (r() - 0.5) * 2); g.stroke(); }
  });
}
function noiseTex(seed, size, f) {
  const r = rng(seed);
  return canvasTex(size, size, (g, w, h) => { const im = g.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = f(r, i % w, Math.floor(i / w)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } g.putImageData(im, 0, 0); }, false);
}

function finish(group, info) {
  group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.layers.enable(2); } });
  group.position.y = 0; group.userData = info; return group;
}

function makeBox(kind) {
  const W = 0.12, H = 0.17, Dp = 0.07;
  const g = new THREE.Group();
  const geo = new RoundedBoxGeometry(W, H, Dp, 3, 0.003);
  let side, face, top;
  if (kind === 'box_white') {
    face = labelTex('#f1efea', '#2b2b2b', 'hand cream 50g');
    side = labelTex('#f1efea', '#6b6b6b', 'made in japan', '');
    top = canvasTex(64, 64, g2 => { g2.fillStyle = '#f1efea'; g2.fillRect(0, 0, 64, 64); });
  } else if (kind === 'box_black') {
    face = labelTex('#1b1b1c', '#9a9a9a', 'night serum 30ml');
    side = labelTex('#1b1b1c', '#5a5a5a', 'made in japan', '');
    top = canvasTex(64, 64, g2 => { g2.fillStyle = '#1b1b1c'; g2.fillRect(0, 0, 64, 64); });
  } else {
    face = labelTex('#b48a5f', '#3a2614', 'organic soap', 'SAVON');
    side = labelTex('#b48a5f', '#4a3220', 'handmade', '');
    top = canvasTex(64, 64, g2 => { g2.fillStyle = '#b48a5f'; g2.fillRect(0, 0, 64, 64); });
  }
  const rough = kind === 'box_black' ? 0.62 : 0.85;
  const mats = [side, side, top, top, face, face].map(t => std({ map: t, roughness: rough }));
  const m = new THREE.Mesh(geo, mats); m.position.y = H / 2; m.rotation.y = -0.45; g.add(m);
  return finish(g, { r: Math.hypot(W, H, Dp) / 2, cy: H / 2, h: H });
}
function makeWood() {
  const s = 0.09, g = new THREE.Group();
  const m = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, 0.004), std({ map: woodTex(5), roughness: 0.75 }));
  m.position.y = s / 2; m.rotation.y = 0.5; g.add(m);
  const m2 = new THREE.Mesh(new RoundedBoxGeometry(s * 0.7, s * 0.7, s * 0.7, 2, 0.004), std({ map: woodTex(9), roughness: 0.75 }));
  m2.position.set(0.075, s * 0.35, 0.05); m2.rotation.y = -0.3; g.add(m2);
  return finish(g, { r: 0.09, cy: 0.045, h: s });
}
function makeTowel() {
  const g = new THREE.Group(); const col = '#9fb8c4';
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.026, 0.11, 4, 0.012), phys({ color: col, roughness: 1, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color('#dfeef5') }));
    m.position.set(i * 0.004, 0.013 + i * 0.025, i * 0.003); m.rotation.y = i * 0.03; g.add(m);
  }
  return finish(g, { r: 0.1, cy: 0.04, h: 0.078 });
}
function makeBread() {
  const g = new THREE.Group(); const r = rng(11);
  const geo = new THREE.SphereGeometry(1, 96, 64); const p = geo.attributes.position; const col = new Float32Array(p.count * 3);
  const c1 = new THREE.Color('#8a4a1a'), c2 = new THREE.Color('#c98a45'), c3 = new THREE.Color('#b47c42'), tmp = new THREE.Color();
  const bumps = Array.from({ length: 26 }, () => [r() * 2 - 1, r() * 0.8 + 0.1, r() * 2 - 1, 0.04 + r() * 0.05]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d = 1; for (const b of bumps) { const dd = (x - b[0]) ** 2 + (y - b[1]) ** 2 + (z - b[2]) ** 2; d += b[3] * Math.exp(-dd * 18) * 0.5; }
    const u = x * 0.8 + z * 0.6; let slash = 0; for (const c of [-0.45, 0, 0.45]) slash = Math.max(slash, Math.exp(-((u - c) ** 2) * 220)); slash *= (y > 0.25 ? 1 : 0) * clamp((0.75 - Math.abs(z * 0.8 - x * 0.6)) * 3, 0, 1);
    d -= slash * 0.035;
    x *= d; y *= d; z *= d; if (y < 0) y *= 0.32;
    p.setXYZ(i, x * 0.08, (y + 0.33) * 0.062, z * 0.058);
    const t = clamp((y + 0.1) / 1.1, 0, 1); tmp.copy(c2).lerp(c1, Math.pow(t, 1.4)); if (y < -0.12) tmp.copy(c3).lerp(c2, clamp((y + 0.33) / 0.2, 0, 1));
    if (slash > 0.3) tmp.lerp(c3, 0.6);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const bump = noiseTex(4, 256, (rr) => 110 + rr() * 60);
  const mat = phys({ vertexColors: true, roughness: 0.62, bumpMap: bump, bumpScale: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.45 });
  const m = new THREE.Mesh(geo, mat); g.add(m);
  const m2 = m.clone(); m2.position.set(0.1, 0, -0.07); m2.rotation.y = 0.9; m2.scale.setScalar(0.92); g.add(m2);
  g.position.x = -0.03;
  return finish(g, { r: 0.12, cy: 0.035, h: 0.07 });
}
function makeCookies() {
  const g = new THREE.Group(); const r = rng(21);
  const mkCookie = (seed) => {
    const rr = rng(seed); const geo = new THREE.CylinderGeometry(0.03, 0.031, 0.01, 64, 4); const p = geo.attributes.position; const col = new Float32Array(p.count * 3);
    const base = new THREE.Color('#c88a48'), dark = new THREE.Color('#3b2213'), edge = new THREE.Color('#9c5f2c'), t = new THREE.Color();
    const chips = Array.from({ length: 7 }, () => [rr() * 0.044 - 0.022, rr() * 0.044 - 0.022]);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const rad = Math.hypot(x, z);
      let ny = y; if (y > 0) ny = y + 0.0009 * (Math.sin(x * 170 + z * 90) * Math.sin(z * 140 - x * 60)) + 0.0025 * (1 - (rad / 0.031) ** 2);
      let chip = 0; for (const c of chips) chip = Math.max(chip, Math.exp(-((x - c[0]) ** 2 + (z - c[1]) ** 2) / 0.00002));
      if (y > 0) ny += chip * 0.003;
      p.setY(i, ny);
      t.copy(base).lerp(edge, clamp((rad - 0.02) / 0.012, 0, 1)); if (y > 0) t.lerp(dark, chip > 0.5 ? 0.9 : 0);
      col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    return new THREE.Mesh(geo, std({ vertexColors: true, roughness: 0.82, bumpMap: noiseTex(seed, 128, rrr => 90 + rrr() * 90), bumpScale: 1.2 }));
  };
  const a = mkCookie(3); a.position.set(-0.03, 0.005, 0.02); g.add(a);
  const b = mkCookie(7); b.position.set(0.035, 0.005, -0.01); g.add(b);
  const c = mkCookie(9); c.position.set(0.0, 0.013, 0.0); c.rotation.set(0.18, 0, 0.12); c.position.y = 0.016; g.add(c);
  return finish(g, { r: 0.075, cy: 0.012, h: 0.03 });
}
function makeApple() {
  const g = new THREE.Group(); const pts = [];
  for (let i = 0; i <= 48; i++) { const t = i / 48; const a = t * Math.PI; let rr = Math.sin(a) * (1 + 0.1 * Math.sin(a)) * (1 - 0.12 * t); let y = -Math.cos(a) * 0.92; if (t > 0.9) y -= (t - 0.9) * 1.4; if (t < 0.06) y += (0.06 - t) * 0.8; pts.push(new THREE.Vector2(Math.max(rr, 0.0001) * 0.043, (y + 1) * 0.043)); }
  const geo = new THREE.LatheGeometry(pts, 96);
  const tex = canvasTex(512, 256, (c, w, h) => { const r = rng(5); c.fillStyle = '#a3141e'; c.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { const x = r() * w; c.strokeStyle = `rgba(${200 + r() * 55},${120 + r() * 80},40,${0.05 + r() * 0.15})`; c.lineWidth = 1 + r() * 4; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (r() - 0.5) * 20, h); c.stroke(); } const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,210,90,0.25)'); gr.addColorStop(0.25, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const m = new THREE.Mesh(geo, phys({ map: tex, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 })); g.add(m);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0025, 0.018, 8), std({ color: '#5b3a1c', roughness: 0.9 })); stem.position.set(0, 0.079, 0); stem.rotation.z = 0.25; g.add(stem);
  return finish(g, { r: 0.06, cy: 0.04, h: 0.085 });
}
function makeOrangeMesh() {
  const geo = new THREE.SphereGeometry(0.038, 96, 64); geo.translate(0, 0.036, 0); geo.scale(1, 0.94, 1);
  const bump = noiseTex(8, 512, (r, x, y) => { const v = Math.sin(x * 1.7) * Math.sin(y * 1.9) * 0.5 + r() * 0.5; return 128 + v * 90; });
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(3, 2);
  return new THREE.Mesh(geo, phys({ color: '#f0861a', roughness: 0.42, bumpMap: bump, bumpScale: 1.5, clearcoat: 0.3, clearcoatRoughness: 0.4 }));
}
function makeOrange() {
  const g = new THREE.Group(); const o = makeOrangeMesh(); g.add(o);
  const half = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 64), phys({ map: canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#f7a23a'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, 7); c.fill(); c.fillStyle = '#ffd9a0'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.43, 0, 7); c.fill(); c.fillStyle = '#f5952a'; for (let i = 0; i < 10; i++) { c.beginPath(); c.moveTo(w / 2, h / 2); c.arc(w / 2, h / 2, w * 0.4, i * 0.628 + 0.05, i * 0.628 + 0.57); c.fill(); } c.fillStyle = '#fff2d8'; c.beginPath(); c.arc(w / 2, h / 2, 10, 0, 7); c.fill(); }), roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
  half.position.set(0.075, 0.006, 0.035); half.rotation.set(0, 0, 0); g.add(half);
  return finish(g, { r: 0.06, cy: 0.035, h: 0.07 });
}
function makeGlassDrink(kind) {
  const g = new THREE.Group();
  const H = 0.13, R0 = 0.032, R1 = 0.038, T = 0.0025;
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R0, 0), new THREE.Vector2(R1, H), new THREE.Vector2(R1 - T, H), new THREE.Vector2(R0 - T, 0.008), new THREE.Vector2(0, 0.008)];
  const gm = patchSpec(phys({ color: '#000000', roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1, envMapIntensity: 1.6 })); // 薄いガラス：映り込みだけを足す
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), gm); glass.renderOrder = 2;
  g.add(glass);
  const lh = kind === 'icecoffee' ? 0.095 : 0.1;
  const lgeo = new THREE.CylinderGeometry(R0 - T + (R1 - R0) * (lh / H) - 0.0004, R0 - T - 0.0004, lh - 0.008, 72); lgeo.translate(0, 0.008 + (lh - 0.008) / 2, 0);
  const liquid = kind === 'icecoffee'
    ? phys({ color: '#e8b488', transmission: 1, roughness: 0.06, thickness: 0.06, ior: 1.34, attenuationColor: new THREE.Color('#a0541c'), attenuationDistance: 0.035 })
    : phys({ color: '#ffe2b8', transmission: 1, roughness: 0.06, thickness: 0.06, ior: 1.34, attenuationColor: new THREE.Color('#ffb54a'), attenuationDistance: 0.05 });
  patchSpec(liquid);
  g.add(new THREE.Mesh(lgeo, liquid));
  if (kind === 'icecoffee') {
    const r = rng(3); for (let i = 0; i < 4; i++) { const im = patchSpec(phys({ color: '#2a2a2a', roughness: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); const ice = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.02, 0.022, 2, 0.004), im); ice.position.set((r() - 0.5) * 0.03, lh - 0.012 + i * 0.006 - 0.01 * (i % 2), (r() - 0.5) * 0.03); ice.rotation.set(r(), r(), r()); g.add(ice); }
    const milk = new THREE.Mesh(new THREE.CylinderGeometry(R0 - T - 0.0006, R0 - T - 0.0006, 0.012, 64), phys({ color: '#e9dcc8', roughness: 0.5 })); milk.position.y = 0.016; g.add(milk);
  } else {
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 48), phys({ color: '#ffb546', roughness: 0.35, sheen: 0.4 })); slice.position.set(R1 - 0.004, H - 0.008, 0.004); slice.rotation.set(Math.PI / 2, 0.25, 0); g.add(slice);
  }
  return finish(g, { r: 0.075, cy: H / 2, h: H });
}

/* ---- 上級：写り込みが主役の被写体（周りの景色＝光源・反射板・黒い板が表面に写る） ---- */
const specMat = o => { const m = phys(o); m.userData.spec = true; return patchSpec(m); };
function makePhone() {
  const g = new THREE.Group(); const W = 0.072, H = 0.152, T = 0.008;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, T, 4, 0.006), specMat({ color: '#8a8d92', metalness: 1, roughness: 0.32 }));
  const screen = new THREE.Mesh(new RoundedBoxGeometry(W - 0.003, H - 0.003, 0.0006, 3, 0.0003), specMat({ color: '#030304', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 }));
  screen.position.z = T / 2;
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.002, 24), specMat({ color: '#111', roughness: 0.1, metalness: 0.5 })); cam.rotation.x = Math.PI / 2; cam.position.set(-0.022, 0.06, -T / 2 - 0.001);
  const ph = new THREE.Group(); ph.add(body, screen, cam);
  ph.rotation.x = -0.32; ph.position.set(0, H / 2 * Math.cos(0.32) + 0.002, -0.01); // 少し後ろに傾けて立てる
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.03), std({ color: '#2a2a2a', roughness: 0.6 })); stand.position.set(0, 0.006, 0.012);
  g.add(ph, stand); g.rotation.y = -0.35;
  return finish(g, { r: 0.1, cy: 0.072, h: 0.145 });
}
function makeEarbuds() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.05, 0.024, 8, 0.0115), specMat({ color: '#ececea', roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.08 }));
  m.position.y = 0.025; g.add(m);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 16), new THREE.MeshBasicMaterial({ color: '#3a3' })); led.position.set(0, 0.03, 0.0121); g.add(led);
  g.rotation.y = -0.4;
  return finish(g, { r: 0.04, cy: 0.025, h: 0.05 });
}
function makeBottle() {
  const g = new THREE.Group(); const pts = [];
  const prof = [[0, 0], [0.026, 0], [0.03, 0.006], [0.031, 0.02], [0.031, 0.1], [0.028, 0.112], [0.016, 0.118], [0.012, 0.124]];
  prof.forEach(([r, y]) => pts.push(new THREE.Vector2(r, y)));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), specMat({ color: '#1f2b3d', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 64), specMat({ color: '#d8b56d', metalness: 1, roughness: 0.18 })); cap.position.y = 0.144;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0312, 0.0312, 0.035, 96, 1, true, -0.7, 1.4), std({ map: canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#1f2b3d'; c.fillRect(0, 0, w, h); c.fillStyle = '#d9d4c7'; c.font = '700 44px Helvetica, Arial'; c.textAlign = 'center'; c.fillText('ROSÉ', w / 2, 70); c.font = '20px Helvetica, Arial'; c.fillText('body milk', w / 2, 100); }), roughness: 0.5, transparent: true }));
  label.position.y = 0.06; label.rotation.y = Math.PI / 2 + 0.0;
  g.add(body, cap, label); g.rotation.y = -0.2;
  return finish(g, { r: 0.085, cy: 0.082, h: 0.164 });
}
function makeGlassBottle() {
  const g = new THREE.Group(); const o = [[0.0, 0], [0.03, 0], [0.032, 0.004], [0.032, 0.09], [0.028, 0.11], [0.012, 0.135], [0.011, 0.165], [0.013, 0.168]];
  const T = 0.0025; const pts = o.map(([r, y]) => new THREE.Vector2(r, y));
  const inner = [...o].reverse().filter(([r]) => r > 0.005).map(([r, y]) => new THREE.Vector2(Math.max(r - T, 0.001), Math.min(Math.max(y, 0.006), 0.168)));
  const geo = new THREE.LatheGeometry([...pts, ...inner, new THREE.Vector2(0.0, 0.006)], 96);
  const m = new THREE.Mesh(geo, specMat({ color: '#f4fbf6', transmission: 1, roughness: 0.02, thickness: 0.006, ior: 1.5, attenuationColor: new THREE.Color('#d9efe2'), attenuationDistance: 0.05, specularIntensity: 1, side: THREE.DoubleSide }));
  g.add(m);
  return finish(g, { r: 0.088, cy: 0.084, h: 0.168 });
}
function makeTumbler() {
  const g = new THREE.Group(); const pts = [[0, 0], [0.031, 0], [0.034, 0.004], [0.036, 0.13], [0.0365, 0.135], [0.033, 0.135], [0.033, 0.01], [0, 0.01]].map(([r, y]) => new THREE.Vector2(r, y));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), specMat({ color: '#e6e8ea', metalness: 1, roughness: 0.12 })); g.add(m);
  const r = makeRingMesh(); r.position.set(0.07, 0.0026, 0.05); r.rotation.set(-Math.PI / 2 + 0.05, 0, 0); g.add(r);
  return finish(g, { r: 0.09, cy: 0.068, h: 0.136 });
}
function makeRingMesh() { return new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0026, 32, 96), specMat({ color: '#e9c46a', metalness: 1, roughness: 0.08 })); }
function makeRing() {
  const g = new THREE.Group(); const r = makeRingMesh(); r.rotation.set(-0.25, 0.4, 0); r.position.y = 0.0128; g.add(r);
  const r2 = makeRingMesh(); r2.material = specMat({ color: '#d9dadc', metalness: 1, roughness: 0.08 }); r2.rotation.set(-Math.PI / 2, 0, 0); r2.position.set(0.024, 0.0026, 0.012); g.add(r2);
  return finish(g, { r: 0.032, cy: 0.012, h: 0.025 });
}
export function makeObject(id) {
  switch (id) {
    case 'box_white': case 'box_kraft': case 'box_black': return makeBox(id);
    case 'wood': return makeWood();
    case 'towel': return makeTowel();
    case 'bread': return makeBread();
    case 'cookies': return makeCookies();
    case 'apple': return makeApple();
    case 'orange': return makeOrange();
    case 'icecoffee': case 'juice': return makeGlassDrink(id);
    case 'phone': return makePhone();
    case 'earbuds': return makeEarbuds();
    case 'bottle': return makeBottle();
    case 'glassbottle': return makeGlassBottle();
    case 'tumbler': return makeTumbler();
    case 'ring': return makeRing();
  }
  return makeBox('box_white');
}

/* ---------------- 背景（ホリゾント） ---------------- */
function sweepGeometry(dist, R = 0.22, width = 1.8, height = 1.6, front = 0.9) { // 撮影台の大きさ（幅1.8m・手前0.9m）
  const prof = [];
  prof.push([front, 0]);
  const zc = -dist + R;
  prof.push([zc, 0]);
  for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; prof.push([zc - Math.sin(a) * R, R - Math.cos(a) * R]); }
  prof.push([-dist, height]);
  const pos = [], uv = [], idx = [];
  let acc = 0; const lens = [0]; for (let i = 1; i < prof.length; i++) { acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); lens.push(acc); }
  for (let i = 0; i < prof.length; i++) for (let j = 0; j <= 1; j++) { pos.push((j - 0.5) * width, prof[i][1], prof[i][0]); uv.push(j * width, lens[i]); }
  for (let i = 0; i < prof.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

/* ---------------- シェーダー（蓄積と表示） ---------------- */
const quadVS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
const accumFS = `uniform sampler2D tPrev; uniform sampler2D tNew; uniform float w; varying vec2 vUv;
void main(){ vec4 a=texture2D(tPrev,vUv); vec4 b=texture2D(tNew,vUv); gl_FragColor=mix(a,b,w); }`;
const displayFS = `uniform sampler2D tAcc; uniform float uExp; uniform vec3 uWB; uniform float uZebra; uniform float uMask; varying vec2 vUv;
vec3 l2s(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(vec3(0.0031308),c)); }
void main(){ vec3 c=texture2D(tAcc,vUv).rgb*uExp*uWB; c=clamp(c,0.,1.); vec3 s=l2s(c);
 if(uZebra>0.5){ float m=max(max(s.r,s.g),s.b); if(m>0.985){ float st=step(0.5,fract((gl_FragCoord.x+gl_FragCoord.y)/12.)); s=mix(s,vec3(st),0.55);} }
 gl_FragColor=vec4(s,1.); }`;

/* ---------------- スタジオ ---------------- */
export class Studio {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.mobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || opts.mobile;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 0.8, 0.01, 30); this.cam.layers.enable(0);
    this.setCam = new THREE.PerspectiveCamera(45, 0.8, 0.01, 40); this.setCam.layers.enable(0); this.setCam.layers.enable(1);
    this.view = 'photo';
    this.objCache = {}; this.obj = null; this.objId = null;
    this.zebra = false; this.wb = new THREE.Color(1, 1, 1);
    this.sample = 0; this.maxSamples = this.mobile ? 40 : 64; this.dirty = true; this.envDirty = true;
    this.setup = defaultSetup();
    this._buildStatic();
    this._buildLights();
    this._buildPost();
    this.resize();
    this.apply(this.setup);
  }
  _buildStatic() {
    this.bgMat = phys({ color: '#f3f2ee', roughness: 0.95 }); this.bgMat.shadowSide = THREE.DoubleSide;
    this.bgMesh = new THREE.Mesh(sweepGeometry(0.45), this.bgMat); this.bgMesh.receiveShadow = true; this.bgMesh.castShadow = true; this.scene.add(this.bgMesh); // 背景紙は後ろからの光をさえぎる
    this.wallMat = std({ color: '#d8d8d6', roughness: 0.95 });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), this.wallMat); this.wall.receiveShadow = true; this.wall.castShadow = true; this.wallMat.shadowSide = THREE.DoubleSide; this.wall.visible = false; this.scene.add(this.wall);
    this.woodMat = std({ map: woodTex(17), roughness: 0.55 }); this.woodMat.shadowSide = THREE.DoubleSide; this.woodMat.map.wrapS = this.woodMat.map.wrapT = THREE.RepeatWrapping; this.woodMat.map.repeat.set(3, 3);
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, color: '#000', alphaMap: canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#666'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false) }));
    this.contact.rotation.x = -Math.PI / 2; this.contact.position.y = 0.0006; this.contact.renderOrder = 1; this.contact.visible = false;
    // セット表示用：光源のパネルと反射板・カメラ
    this.helpers = new THREE.Group(); this.scene.add(this.helpers);
    this.reflGroup = new THREE.Group(); this.scene.add(this.reflGroup);
    const camBody = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.07), std({ color: '#222', roughness: 0.5 })); camBody.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 32), std({ color: '#111', roughness: 0.4 })); lens.rotation.x = Math.PI / 2; lens.position.z = -0.075; camBody.add(lens);
    camBody.traverse(m => { m.layers.set(1); }); this.camModel = camBody; this.scene.add(camBody);
  }
  _buildLights() {
    const mk = () => { const s = new THREE.SpotLight(0xffffff, 1, 0, 1.0, 0.35, 2); s.castShadow = true; s.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048); s.shadow.bias = -0.00006; s.shadow.normalBias = 0.0028; s.shadow.camera.near = 0.08; s.shadow.camera.far = 8; s.shadow.radius = 2; this.scene.add(s); this.scene.add(s.target); return s; };
    this.keySpot = mk(); this.fillSpot = mk(); this.fillSpot.shadow.mapSize.set(1024, 1024);
    const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -1; sc.right = 1; sc.top = 1; sc.bottom = -1; sc.near = 0.1; sc.far = 12; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.001; this.scene.add(sun); this.scene.add(sun.target);
    this.keySun = sun; this.fillSun = sun.clone(); this.fillSun.castShadow = false; this.scene.add(this.fillSun); this.scene.add(this.fillSun.target);
    this.panelGeo = new THREE.PlaneGeometry(1, 1);
    this.keyPanel = new THREE.Mesh(this.panelGeo, new THREE.MeshBasicMaterial({ color: '#fff', side: THREE.DoubleSide })); this.keyPanel.layers.set(0); this.scene.add(this.keyPanel);
    this.fillPanel = this.keyPanel.clone(); this.fillPanel.material = this.keyPanel.material.clone(); this.scene.add(this.fillPanel);
    // 環境マップ（照り返し）
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envRoom = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: '#000' })); this.envScene.add(this.envRoom);
    this.envCeil = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); this.envCeil.rotation.x = Math.PI / 2; this.envScene.add(this.envCeil);
    this.envTable = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); this.envTable.rotation.x = -Math.PI / 2; this.envScene.add(this.envTable);
    this.envBg = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); this.envScene.add(this.envBg);
    this.envPanels = new THREE.Group(); this.envScene.add(this.envPanels);
    this.envRT = null;
  }
  _buildPost() {
    const ht = this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rtType = ht;
    const mk = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: ht, depthBuffer: true, samples: 0 });
    this.mkRT = mk;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.accumMat = new THREE.ShaderMaterial({ uniforms: { tPrev: { value: null }, tNew: { value: null }, w: { value: 1 } }, vertexShader: quadVS, fragmentShader: accumFS, depthTest: false, depthWrite: false });
    this.dispMat = new THREE.ShaderMaterial({ uniforms: { tAcc: { value: null }, uExp: { value: 1 }, uWB: { value: new THREE.Vector3(1, 1, 1) }, uZebra: { value: 0 }, uMask: { value: 0 } }, vertexShader: quadVS, fragmentShader: displayFS, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumMat); this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.maskMat = new THREE.MeshBasicMaterial({ color: '#fff' });
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(); const w = Math.max(64, Math.round(r.width * this.dpr)), h = Math.max(64, Math.round(r.height * this.dpr));
    if (this.W === w && this.H === h) return; this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    [this.rtS, this.rtA, this.rtB].forEach(t => t && t.dispose());
    this.rtS = this.mkRT(w, h); this.rtA = this.mkRT(w, h); this.rtB = this.mkRT(w, h);
    this.aspect = w / h; this.cam.aspect = this.aspect; this.setCam.aspect = this.aspect; this.cam.updateProjectionMatrix(); this.setCam.updateProjectionMatrix();
    this.reset();
  }
  reset() { this.sample = 0; this.dirty = true; }

  /* ---- セットの反映 ---- */
  apply(setup) {
    const s = this.setup = cloneSetup(setup);
    if (this.objId !== s.obj) {
      if (this.obj) this.scene.remove(this.obj);
      this.obj = this.objCache[s.obj] || (this.objCache[s.obj] = makeObject(s.obj)); this.objId = s.obj; this.scene.add(this.obj);
    }
    const info = this.obj.userData; this.info = info;
    this.center = new THREE.Vector3(0, info.cy, 0);
    // 背景
    const bg = BGS[s.bg.type];
    this.bgMesh.geometry.dispose(); this.bgMesh.geometry = sweepGeometry(s.bg.dist);
    if (s.bg.type === 'wood') { this.bgMesh.material = this.woodMat; this.wall.visible = true; this.wall.position.set(0, 0.9, -s.bg.dist - 0.002); this.bgMesh.geometry.dispose(); this.bgMesh.geometry = sweepGeometry(s.bg.dist + 0.001, 0.0005); }
    else { this.bgMesh.material = this.bgMat; this.bgMat.color.set(bg.color); this.bgMat.roughness = s.bg.type === 'black' ? 1 : 0.95; this.bgMat.envMapIntensity = s.bg.type === 'black' ? 0.25 : 1; this.bgMat.specularIntensity = s.bg.type === 'black' ? 0.15 : 0.5; this.wall.visible = false; }
    this.contact.scale.set(info.r * 2.6, info.r * 2.2, 1);
    // カメラ
    const fov = 2 * Math.atan(12 / s.cam.focal) / D; // 縦（フルサイズ24mm）
    this.cam.fov = fov; this.cam.updateProjectionMatrix();
    const half = Math.min(Math.tan(fov * D / 2), Math.tan(fov * D / 2) * this.aspect);
    const dist = info.r * 1.55 / half;
    const el = s.cam.el;
    const cp = polar(0, el, dist, info.cy * 0.9);
    this.cam.position.copy(cp); this.cam.up.set(0, 1, 0); if (el > 80) this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, info.cy * 0.9, 0);
    this.camModel.position.copy(cp); this.camModel.lookAt(0, info.cy * 0.9, 0); this.camModel.rotateY(Math.PI);
    this.camDist = dist;
    this.dispMat.uniforms.uExp.value = Math.pow(2, s.cam.ev) * 0.85;
    // ライト（反射板の向きはメインライトの位置で決まるので先に置く）
    this._placeLight(s.key, this.keySpot, this.keySun, this.keyPanel, true);
    this._placeLight(s.fill, this.fillSpot, this.fillSun, this.fillPanel, false);
    // 反射板
    while (this.reflGroup.children.length) { const c = this.reflGroup.children.pop(); c.geometry.dispose(); }
    this.reflInfo = s.refl.map(r => this._reflPose(r));
    this.reflInfo.forEach((ri, i) => {
      const r = s.refl[i]; const m = new THREE.Mesh(new THREE.PlaneGeometry(ri.w, ri.h), this._reflMat(r.type));
      m.position.copy(ri.pos); m.lookAt(ri.pos.clone().add(ri.n)); m.layers.set(0); m.receiveShadow = true; this.reflGroup.add(m);
    });
    this.envDirty = true; this.reset();
  }
  _reflMat(t) {
    this._rm = this._rm || {};
    if (!this._rm[t]) this._rm[t] = t === 'white' ? std({ color: '#f4f4f0', roughness: 0.95, side: THREE.DoubleSide }) : t === 'black' ? std({ color: '#111', roughness: 1, side: THREE.DoubleSide }) : std({ color: t === 'gold' ? '#d9b36a' : '#d4d7dc', metalness: 1, roughness: 0.35, side: THREE.DoubleSide });
    return this._rm[t];
  }
  lightPose(l) { // 光源の位置・向き・大きさ
    const T = LIGHTS[l.type]; const pos = polar(l.az, l.el, l.dist, this.center.y);
    const n = this.center.clone().sub(pos).normalize();
    return { pos, n, w: T.w, h: T.h, I: E_REF * T.def * T.def * Math.pow(2, l.pow), T };
  }
  _reflPose(r) {
    // 反射板：机の上に立てて置く（lift で台に載せて高くする）。向きは「被写体」と「メインライト」の真ん中に自動で向ける。
    const S = REFL_SIZE[r.size || 'm'];
    const base = polar(r.az, 0, r.dist, 0);
    const kp = this.keyPose ? this.keyPose.pos : polar(-60, 30, 1.4, this.center.y);
    const pos0 = new THREE.Vector3(base.x, S.h / 2 + (r.lift || 0), base.z);
    const toObj = this.center.clone().sub(pos0).normalize();
    const toKey = (this.keyPose && this.keyPose.T.directional ? this.keyPose.pos.clone().sub(this.center) : kp.clone().sub(pos0)).normalize();
    const n = (r.type === 'black') ? toObj.clone() : toObj.clone().add(toKey).normalize();
    if (n.lengthSq() < 0.5) n.copy(toObj);
    if (Math.abs(((r.az + 540) % 360) - 180) < 50 && !r.lift) { n.y = Math.max(n.y, 0.93); n.normalize(); } // カメラ側の板は机に寝かせて下から返す
    n.applyAxisAngle(new THREE.Vector3(0, 1, 0), (r.yaw || 0) * D);
    if (r.pitch) { const ax = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize(); n.applyAxisAngle(ax, -r.pitch * D); }
    if (n.dot(toObj) < 0.05) n.copy(toObj);
    // 下の端が机に乗るように高さを合わせる
    const tilt = Math.sqrt(Math.max(0, 1 - n.y * n.y));
    // 寝かせた板は、被写体側の端が dist の位置に来るように少し外へずらす
    const out = new THREE.Vector3(base.x, 0, base.z).normalize().multiplyScalar(S.h / 2 * Math.max(0, n.y));
    const pos = new THREE.Vector3(base.x + out.x, Math.max(0.01, S.h / 2 * tilt) + (r.lift || 0), base.z + out.z);
    return { pos, n, w: S.w, h: S.h, A: S.w * S.h };
  }
  _placeLight(l, spot, sun, panel, isKey) {
    spot.visible = false; sun.visible = false; panel.visible = false;
    if (isKey) { this.keyPose = null; } else { this.fillPose = null; }
    if (!l) return;
    const p = this.lightPose(l); const col = kelvinRGB(LIGHTS[l.type].kelvin);
    if (p.T.directional) {
      sun.visible = true; sun.color.copy(col); sun.intensity = E_REF * Math.pow(2, l.pow);
      sun.position.copy(this.center.clone().add(p.pos.clone().sub(this.center).normalize().multiplyScalar(5))); sun.target.position.copy(this.center); sun.target.updateMatrixWorld();
    } else {
      spot.visible = true; spot.color.copy(col); spot.intensity = p.I; spot.target.position.copy(this.center); spot.target.updateMatrixWorld();
      spot.angle = (l.type === 'led' || l.type === 'v1') ? 0.75 : l.type === 'v1bounce' ? 1.3 : 1.05; spot.penumbra = (l.type === 'led' || l.type === 'v1') ? 0.4 : 0.6;
      panel.visible = true; panel.position.copy(p.pos); panel.lookAt(this.center); panel.scale.set(p.w, p.h, 1);
      const Lp = Math.min(40, p.I / Math.max(p.w * p.h, 1e-4)); panel.material.color.copy(col).multiplyScalar(Lp); // 発光面（写真に入れば白く写る）
    }
    const pose = { ...p, col, l };
    if (isKey) this.keyPose = pose; else this.fillPose = pose;
  }
  // 被写体の位置での照度（向き・距離・強さ）
  _E(pose, at, normal) {
    if (!pose) return 0;
    if (pose.T.directional) { const dir = pose.pos.clone().sub(this.center).normalize(); return E_REF * Math.pow(2, pose.l.pow) * Math.max(0, normal ? normal.dot(dir) : 1); }
    const v = pose.pos.clone().sub(at); const d2 = v.lengthSq(); v.normalize();
    const cosE = Math.max(0, -v.dot(pose.n)) > 0.2 ? 1 : 0.3; // 発光面の向き（ほぼ正面なら1）
    return pose.I / d2 * (normal ? Math.max(0, normal.dot(v)) : 1) * cosE;
  }
  // 反射板・パネルの明るさ（輝度）
  reflRadiance(r, ri) {
    const lights = [this.keyPose, this.fillPose].filter(Boolean); const out = new THREE.Color(0, 0, 0);
    if (r.type === 'black') return out;
    for (const lp of lights) {
      if (r.type === 'white') {
        const E = this._E(lp, ri.pos, ri.n); out.add(lp.col.clone().multiplyScalar(0.85 * E / Math.PI));
      } else {
        // 鏡に近い反射：光源の「像」が被写体の方向に来るか
        const lightDir = lp.T.directional ? lp.pos.clone().sub(this.center).normalize() : lp.pos.clone().sub(ri.pos).normalize();
        const facing = ri.n.dot(lightDir); if (facing <= 0) continue;
        const refl = lightDir.clone().reflect(ri.n).negate(); // 反射して出ていく方向
        const toObj = this.center.clone().sub(ri.pos).normalize();
        const ang = Math.acos(clamp(refl.dot(toObj), -1, 1));
        const dl = lp.T.directional ? 1e6 : lp.pos.distanceTo(ri.pos); const dpo = ri.pos.distanceTo(this.center);
        const srcHalf = lp.T.directional ? 0.01 : Math.atan(Math.max(lp.w, lp.h) / 2 / dl);
        const sigma = Math.max(12 * D, srcHalf); // 銀の面は少しざらつく
        const align = Math.exp(-((ang / sigma) ** 2));
        const omegaP = ri.A * Math.max(0.05, ri.n.dot(toObj)) / (dpo * dpo);
        let L;
        if (lp.T.directional) { const E = E_REF * Math.pow(2, lp.l.pow) * facing; L = 0.9 * E / Math.max(omegaP, 1e-3) * Math.min(1, omegaP / (Math.PI * sigma * sigma)); }
        else { const Lsrc = lp.I / Math.max(lp.w * lp.h, 1e-4); const omegaImg = (lp.w * lp.h) / ((dl + dpo) ** 2); L = 0.9 * Lsrc * Math.min(1, omegaImg / Math.max(omegaP, 1e-4)); }
        const tint = r.type === 'gold' ? new THREE.Color(1, 0.72, 0.38) : new THREE.Color(1, 1, 1);
        out.add(lp.col.clone().multiply(tint).multiplyScalar(L * align));
      }
    }
    return out;
  }
  _updateEnv() {
    const s = this.setup; const c = this.center;
    // 部屋の照り返し：メインライトの強さに比例
    const Ek = Math.max(this._E(this.keyPose, c, null), 0.0001) + 0.5 * this._E(this.fillPose, c, null);
    const room = ROOMS[s.room]; const Lw = room.k * Ek;
    this.envRoom.material.color.setRGB(Lw, Lw, Lw);
    const flashKey = this.keyPose && this.keyPose.T.flash; // ストロボならシャッター速度で部屋の電気はほぼ消える
    this.envCeil.visible = !!room.lamp; if (room.lamp) { this.envCeil.material.color.copy(kelvinRGB(2700)).multiplyScalar(flashKey ? 0.12 : 1.6); this.envCeil.position.set(0, 2.2 - c.y, 0.3); }
    // テーブル：被写体の足元の明るさ
    const up = new THREE.Vector3(0, 1, 0); const foot = new THREE.Vector3(0, 0.001, 0.12);
    const bg = BGS[s.bg.type];
    const Et = this._E(this.keyPose, foot, up) + this._E(this.fillPose, foot, up);
    const tCol = new THREE.Color(bg.color).convertSRGBToLinear();
    const aT = s.bg.type === 'wood' ? 0.3 : bg.albedo;
    const LT = 0.35 * aT * Et / Math.PI + Lw * aT; this.envTable.material.color.setRGB(LT, LT, LT).multiply(s.bg.type === 'wood' ? new THREE.Color(1, 0.75, 0.5) : new THREE.Color(1, 1, 1));
    this.envTable.scale.set(1.8, s.bg.dist + 0.9, 1); this.envTable.position.set(0, -c.y, (0.9 - s.bg.dist) / 2); // 撮影台の範囲だけ
    // 背景
    const bgPt = new THREE.Vector3(0, 0.35, -s.bg.dist); const bgN = new THREE.Vector3(0, 0, 1);
    const Eb = this._E(this.keyPose, bgPt, bgN) + this._E(this.fillPose, bgPt, bgN);
    const aB = s.bg.type === 'wood' ? bg.wall : bg.albedo;
    const Lb = aB * Eb / Math.PI + Lw * aB; this.envBg.material.color.setRGB(Lb, Lb, Lb);
    this.envBg.position.set(0, 0.8 - c.y, -s.bg.dist);
    // 光源パネルと反射板
    while (this.envPanels.children.length) this.envPanels.children.pop();
    const addPanel = (pos, n, w, h, col) => { const m = new THREE.Mesh(this.panelGeo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.copy(pos).sub(c); m.lookAt(m.position.clone().add(n)); m.scale.set(w, h, 1); this.envPanels.add(m); };
    s.refl.forEach((r, i) => { const ri = this.reflInfo[i]; addPanel(ri.pos, ri.n, ri.w, ri.h, this.reflRadiance(r, ri)); });
    const old = this.envRT; this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.01, 20);
    this.scene.environment = this.envRT.texture; if (old) old.dispose();
    // ツヤのある物用：光源そのものも写り込む景色
    for (const lp of [this.keyPose, this.fillPose]) {
      if (!lp || lp.T.directional) continue;
      const L = lp.I / (lp.w * lp.h); addPanel(lp.pos, lp.n, lp.w, lp.h, lp.col.clone().multiplyScalar(L));
    }
    const old2 = this.envSpecRT; this.envSpecRT = this.pmrem.fromScene(this.envScene, 0, 0.01, 20); if (old2) old2.dispose();
    this.obj.traverse(m => { if (m.isMesh && !Array.isArray(m.material) && m.material.userData.spec) { if (m.material.envMap !== this.envSpecRT.texture) { m.material.envMap = this.envSpecRT.texture; m.material.needsUpdate = true; } m.material.userData.uniforms.envMapDiffuse.value = this.envRT.texture; } });
    // 接地の影（環境光が床で遮られる分）
    this.envDirty = false;
  }
  _jitter(i) {
    const u = halton(i + 1, 2), v = halton(i + 1, 3);
    for (const [pose, spot, sun] of [[this.keyPose, this.keySpot, this.keySun], [this.fillPose, this.fillSpot, this.fillSun]]) {
      if (!pose) continue;
      if (pose.T.directional) { const dir = pose.pos.clone().sub(this.center).normalize(); const ax = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(); const ay = new THREE.Vector3().crossVectors(ax, dir); const a = 0.0047; const p = dir.clone().add(ax.multiplyScalar((u - 0.5) * 2 * a)).add(ay.multiplyScalar((v - 0.5) * 2 * a)).normalize(); sun.position.copy(this.center).add(p.multiplyScalar(5)); continue; }
      const right = new THREE.Vector3().crossVectors(pose.n, new THREE.Vector3(0, 1, 0)); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      const upv = new THREE.Vector3().crossVectors(right, pose.n).normalize();
      spot.position.copy(pose.pos).addScaledVector(right, (u - 0.5) * pose.w).addScaledVector(upv, (v - 0.5) * pose.h);
    }
  }
  _renderSampleTo(rtS, rtPrev, rtOut, n, camera) {
    this._jitter(n);
    const r = this.renderer;
    // 1画素の中でカメラも少しずつずらして平均する（ふちのギザギザを消す）
    const W = rtS.width, H = rtS.height; camera.setViewOffset(W, H, halton(n + 1, 5) - 0.5, halton(n + 1, 7) - 0.5, W, H);
    r.setRenderTarget(rtS); r.setClearColor(0x000000, 1); r.clear(); r.render(this.scene, camera);
    camera.clearViewOffset();
    this.quad.material = this.accumMat; this.accumMat.uniforms.tPrev.value = rtPrev.texture; this.accumMat.uniforms.tNew.value = rtS.texture; this.accumMat.uniforms.w.value = 1 / (n + 1);
    r.setRenderTarget(rtOut); r.render(this.quadScene, this.quadCam);
  }
  // 画面への描画（1フレーム分）
  frame(budget = 1) {
    if (this.envDirty) this._updateEnv();
    const cam = this.view === 'set' ? this.setCam : this.cam;
    this.helpers.visible = this.view === 'set'; this.camModel.visible = this.view === 'set';
    let did = false;
    for (let k = 0; k < budget && this.sample < this.maxSamples; k++) {
      this._renderSampleTo(this.rtS, this.rtA, this.rtB, this.sample, cam);
      [this.rtA, this.rtB] = [this.rtB, this.rtA]; this.sample++; did = true;
    }
    if (did || this.dirty) {
      this.quad.material = this.dispMat; this.dispMat.uniforms.tAcc.value = this.rtA.texture; this.dispMat.uniforms.uZebra.value = this.zebra && this.view === 'photo' ? 1 : 0;
      this.renderer.setRenderTarget(null); this.renderer.render(this.quadScene, this.quadCam); this.dirty = false;
    }
    return did;
  }
  get done() { return this.sample >= this.maxSamples; }

  /* ---- 別のセットを裏で撮る（見本・採点・クイズ用） ---- */
  shoot(setup, opt = {}) {
    const w = opt.w || 96, h = opt.h || 120, N = opt.samples || 16;
    const keep = cloneSetup(this.setup), keepView = this.view, keepAspect = this.aspect;
    this.aspect = w / h; this.cam.aspect = this.aspect; this.cam.updateProjectionMatrix();
    this.apply(setup); this._updateEnv(); this.helpers.visible = false; this.camModel.visible = false;
    const S = this.mkRT(w, h), A = this.mkRT(w, h), B = this.mkRT(w, h);
    let a = A, b = B;
    for (let n = 0; n < N; n++) { this._renderSampleTo(S, a, b, n, this.cam); [a, b] = [b, a]; }
    const out = new THREE.WebGLRenderTarget(w, h);
    this.quad.material = this.dispMat; this.dispMat.uniforms.tAcc.value = a.texture; this.dispMat.uniforms.uZebra.value = 0;
    this.renderer.setRenderTarget(out); this.renderer.render(this.quadScene, this.quadCam);
    const px = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(out, 0, 0, w, h, px);
    // マスク
    const mrt = new THREE.WebGLRenderTarget(w, h); const ov = this.scene.overrideMaterial; this.scene.overrideMaterial = this.maskMat;
    const lay = this.cam.layers.mask; this.cam.layers.set(2); const bgc = this.scene.background; this.scene.background = null;
    this.renderer.setRenderTarget(mrt); this.renderer.setClearColor(0x000000, 1); this.renderer.clear(); this.renderer.render(this.scene, this.cam);
    this.cam.layers.mask = lay; this.scene.overrideMaterial = ov; this.scene.background = bgc;
    const mk = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(mrt, 0, 0, w, h, mk);
    const key = this._keyOnly(w, h);
    [S, A, B, out, mrt].forEach(t => t.dispose());
    this.renderer.setRenderTarget(null);
    // 元に戻す
    this.aspect = keepAspect; this.cam.aspect = keepAspect; this.cam.updateProjectionMatrix();
    this.apply(keep); this.view = keepView;
    const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = mk[i * 4] > 127 ? 1 : 0;
    const img = { w, h, px, mask, key, ang: this.keyAngle(setup) };
    img.m = measure(img);
    if (opt.url) img.url = toURL(img);
    return img;
  }
  // メインライトだけで照らした明るさ（影になっている所を見分けるため）
  _keyOnly(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h);
    const env = this.scene.environment; this.scene.environment = null;
    const vis = [this.fillSpot.visible, this.fillSun.visible]; this.fillSpot.visible = false; this.fillSun.visible = false;
    const kp = this.keyPose; if (kp && !kp.T.directional) this.keySpot.position.copy(kp.pos);
    if (kp && kp.T.directional) this.keySun.position.copy(this.center).add(kp.pos.clone().sub(this.center).normalize().multiplyScalar(5));
    this._keyMat = this._keyMat || new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const ov = this.scene.overrideMaterial; this.scene.overrideMaterial = this._keyMat;
    const refl = this.reflGroup.visible; this.reflGroup.visible = false;
    this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x000000, 1); this.renderer.clear(); this.renderer.render(this.scene, this.cam);
    this.scene.overrideMaterial = ov; this.scene.environment = env; this.fillSpot.visible = vis[0]; this.fillSun.visible = vis[1]; this.reflGroup.visible = refl;
    const px = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
    const k = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) k[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    return k;
  }
  behindBg(l, setup) { if (!l) return false; const p = polar(l.az, l.el, l.dist, this.center ? this.center.y : 0.08); return p.z < -setup.bg.dist + 0.03 && Math.abs(p.x) < 0.9 && p.y < 1.6; }
  keyAngle(setup) { const l = setup.key; const T = LIGHTS[l.type]; return T.directional ? 0.0093 : 2 * Math.atan(Math.max(T.w, T.h) / 2 / l.dist); }
  // 今の画面を小さく撮る（採点用。蓄積が終わった状態で呼ぶ）
  shootCurrent(opt = {}) { return this.shoot(this.setup, opt); }
  // 画面に出ている写真をそのまま計測（重い再描画をしない）
  measureNow(w = 80, h = 100) {
    const out = new THREE.WebGLRenderTarget(w, h);
    this.quad.material = this.dispMat; this.dispMat.uniforms.tAcc.value = this.rtA.texture; this.dispMat.uniforms.uZebra.value = 0;
    this.renderer.setRenderTarget(out); this.renderer.render(this.quadScene, this.quadCam);
    const px = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(out, 0, 0, w, h, px);
    const ov = this.scene.overrideMaterial; this.scene.overrideMaterial = this.maskMat; const lay = this.cam.layers.mask; this.cam.layers.set(2);
    this.renderer.setRenderTarget(out); this.renderer.setClearColor(0x000000, 1); this.renderer.clear(); this.renderer.render(this.scene, this.cam);
    this.cam.layers.mask = lay; this.scene.overrideMaterial = ov;
    const mk = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(out, 0, 0, w, h, mk); out.dispose();
    const key = this._keyOnly(w, h);
    this.renderer.setRenderTarget(null); this.dirty = true;
    const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = mk[i * 4] > 127 ? 1 : 0;
    const img = { w, h, px, mask, key, ang: this.keyAngle(this.setup) }; img.m = measure(img); return img;
  }
  // 反射板の効き（スマホ反射板モード用の速い計算）：影側の明暗差（段）
  quickContrast(setup) {
    const keep = this.setup; const s = setup;
    const c = this.center; const kp = this.keyPose; if (!kp) return 0;
    const toKey = kp.pos.clone().sub(c).normalize(); const Ek = this._E(kp, c, toKey);
    const room = ROOMS[s.room]; const Lw = room.k * Ek;
    let Lshadow = Lw * 0.6, Llit = Ek / Math.PI + Lw * 0.6;
    s.refl.forEach((r, i) => {
      const ri = this._reflPose(r); const L = this.reflRadiance(r, ri); const Lg = 0.2126 * L.r + 0.7152 * L.g + 0.0722 * L.b;
      const d = ri.pos.distanceTo(c); const toP = ri.pos.clone().sub(c).normalize();
      const omega = ri.A * Math.max(0, ri.n.dot(toP.clone().negate())) / (d * d);
      const shadowN = toKey.clone().negate(); shadowN.y = 0; shadowN.normalize();
      Lshadow += Lg * Math.min(omega, 2.5) * Math.max(0, shadowN.dot(toP)) / Math.PI;
    });
    return Math.log2(Llit / Math.max(Lshadow, 1e-5));
  }
}

/* ---------------- 計測 ---------------- */
const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LUT = new Float32Array(256).map((_, i) => s2l(i));
export function measure(img) {
  const { w, h, px, mask, key } = img; const objY = [], bgY = [], objK = []; let clip = 0, crush = 0, nObj = 0; const hist = new Uint32Array(64);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (h - 1 - y) * w + x; const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const Y = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]; const mx = Math.max(r, g, b);
    hist[Math.min(63, Math.floor((0.2126 * r + 0.7152 * g + 0.0722 * b) / 4))]++;
    if (mask[i]) { objY.push(Y); objK.push(key ? key[i] : 0); nObj++; if (mx >= 250) clip++; if (mx <= 6) crush++; }
    else if (y < h * 0.3) bgY.push(Y);
  }
  const sorted = [...objY].sort((a, b) => a - b); bgY.sort((a, b) => a - b);
  const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0;
  const pct = Y => Math.round(100 * (Y <= 0.0031308 ? Y * 12.92 : 1.055 * Math.pow(Y, 1 / 2.4) - 0.055));
  // 影側：メインライトが当たっていない所。光側：メインライトがしっかり当たっている所
  let lit = 0, nl = 0, sh = 0, ns = 0;
  if (key && nObj) {
    const ks = [...objK].sort((a, b) => a - b); const kmax = Math.max(8, ks[Math.floor(ks.length * 0.95)]);
    for (let i = 0; i < nObj; i++) { if (objK[i] > 0.4 * kmax) { lit += objY[i]; nl++; } else if (objK[i] < 0.06 * kmax) { sh += objY[i]; ns++; } }
  }
  // ガラスの縁：被写体のふちの明るさと、そのすぐ外の背景の明るさ
  let eY = 0, ne = 0, oY = 0, no = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (h - 1 - y) * w + x; const nb = [i - 1, i + 1, i - w, i + w];
    const Y = 0.2126 * LUT[px[i * 4]] + 0.7152 * LUT[px[i * 4 + 1]] + 0.0722 * LUT[px[i * 4 + 2]];
    if (mask[i] && nb.some(j => !mask[j])) { eY += Y; ne++; } else if (!mask[i] && nb.some(j => mask[j])) { oY += Y; no++; }
  }
  // 実物チェックと同じ測り方（被写体を囲む四角の中の明るさの分布と、左右の明るさの差）
  let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[(h - 1 - y) * w + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const boxY = []; let bl = 0, nbl = 0, br = 0, nbr = 0; const xm = (bx0 + bx1) / 2;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const i = (h - 1 - y) * w + x; const Y = 0.2126 * LUT[px[i * 4]] + 0.7152 * LUT[px[i * 4 + 1]] + 0.0722 * LUT[px[i * 4 + 2]]; boxY.push(Y); if (x < xm) { bl += Y; nbl++; } else { br += Y; nbr++; } }
  boxY.sort((a, b) => a - b);
  let hiY, loY;
  if (nl > nObj * 0.04 && ns > nObj * 0.04) { hiY = lit / nl; loY = sh / ns; }
  else { hiY = q(sorted, 0.9); loY = q(sorted, 0.12); }
  return {
    contrast: Math.max(0, Math.log2((hiY + 0.003) / (loY + 0.003))),
    clip: nObj ? clip / nObj * 100 : 0, crush: nObj ? crush / nObj * 100 : 0,
    hiPct: pct(hiY), loPct: pct(loY), midPct: pct(q(sorted, 0.5)), bgPct: pct(q(bgY, 0.5)), hist,
    boxContrast: boxY.length ? Math.log2((q(boxY, 0.9) + 0.003) / (q(boxY, 0.1) + 0.003)) : 0, boxLR: Math.log2((bl / Math.max(nbl, 1) + 0.003) / (br / Math.max(nbr, 1) + 0.003)),
    spread: Math.log2((q(sorted, 0.95) + 0.003) / (q(sorted, 0.08) + 0.003)), edgePct: pct(ne ? eY / ne : 0), outPct: pct(no ? oY / no : 0),
  };
}
export function toURL(img) {
  const c = document.createElement('canvas'); c.width = img.w; c.height = img.h; const g = c.getContext('2d'); const im = g.createImageData(img.w, img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const s = ((img.h - 1 - y) * img.w + x) * 4, d = (y * img.w + x) * 4; im.data[d] = img.px[s]; im.data[d + 1] = img.px[s + 1]; im.data[d + 2] = img.px[s + 2]; im.data[d + 3] = 255; }
  g.putImageData(im, 0, 0); return c.toDataURL('image/jpeg', 0.9);
}
// 2枚の写真の違い（段）。被写体の部分を重く見る。さらに「明暗差」と「影のふちの硬さ（光源の見かけの大きさ）」の違いも加える
export function compare(a, b) {
  const G = 16; const bw = a.w / G, bh = a.h / G; let sum = 0, wsum = 0, signed = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let ya = 0, yb = 0, n = 0, mo = 0;
    for (let y = Math.floor(gy * bh); y < Math.floor((gy + 1) * bh); y++) for (let x = Math.floor(gx * bw); x < Math.floor((gx + 1) * bw); x++) {
      const i = y * a.w + x; const f = j => 0.2126 * LUT[j[i * 4]] + 0.7152 * LUT[j[i * 4 + 1]] + 0.0722 * LUT[j[i * 4 + 2]];
      ya += f(a.px); yb += f(b.px); n++; mo += a.mask[i] | b.mask[i];
    }
    if (!n) continue; ya /= n; yb /= n;
    const d = Math.log2((yb + 0.01) / (ya + 0.01)); const wt = mo / n > 0.3 ? 4 : 1;
    sum += Math.abs(d) * wt; signed += d * wt; wsum += wt;
  }
  const grid = sum / wsum;
  const dc = Math.abs(a.m.contrast - b.m.contrast);
  const ds = (a.ang != null && b.ang != null) ? Math.min(1.5, Math.abs(Math.log2((a.ang + 0.02) / (b.ang + 0.02)))) : 0;
  const diff = grid + 0.6 * dc + 0.3 * ds;
  return { diff, grid, dc, ds, bias: signed / wsum, score: Math.round(100 * Math.exp(-Math.pow(diff / 0.65, 1.3))) };
}
