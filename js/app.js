/* 我的日历 — static PWA. Personal items: localStorage. Photos: IndexedDB (this device only). */
(function () {
  "use strict";

  const STORAGE_KEY = "calendar2027.diy.items.v1";
  const QUOTE_KEY = "calendar2027.diy.quote.v1";
  const APP_NAME = "我的日历";
  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
  const IMPORTANCE = ["高", "中", "低"];
  const STATUS = ["未开办", "正常进行", "已完结"];
  const FALLBACK_MIN_YM = "2026-11";
  const FALLBACK_MAX_YM = "2027-12";
  const SRC_LONG_EDGE = 1600;
  const IS_NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  const WHERE = IS_NATIVE ? "这台手机的应用里" : "这台手机的浏览器里";
  const CAM_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg>';

  const $app = document.getElementById("app");
  let DATA = null;
  let items = [];
  let quoteText = "";
  let photos = {};          // ym -> {ym, hero, card, thumb, crop, updatedAt}
  let dbPromise = null;
  let dbOk = false;
  let pendingYM = null;
  let toastTimer = null;

  /* ---------- time & helpers ---------- */
  function todayISO() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  }
  function rangeYM() {
    const start = (DATA && DATA.meta && DATA.meta.range && DATA.meta.range.start) || (FALLBACK_MIN_YM + "-01");
    const end = (DATA && DATA.meta && DATA.meta.range && DATA.meta.range.end) || (FALLBACK_MAX_YM + "-31");
    return { min: start.slice(0, 7), max: end.slice(0, 7), start: start, end: end };
  }
  function currentMonthYM() {
    return clampYM(todayISO().slice(0, 7));
  }
  function todayInRange() {
    const r = rangeYM();
    const t = todayISO();
    return t >= r.start && t <= r.end;
  }
  function weekdayName(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay(); // 0 Sun
    return "日一二三四五六"[wd];
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymOf(iso) { return iso.slice(0, 7); }
  function parseYM(ym) {
    const [y, m] = ym.split("-").map(Number);
    return { y, m };
  }
  function addMonth(ym, delta) {
    const { y, m } = parseYM(ym);
    const dt = new Date(y, m - 1 + delta, 1);
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1);
  }
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }
  function monthCells(y, m) {
    const first = new Date(y, m - 1, 1);
    const padStart = (first.getDay() + 6) % 7; // Monday start
    const count = daysInMonth(y, m);
    const cells = [];
    for (let i = 0; i < padStart; i++) cells.push(null);
    for (let d = 1; d <= count; d++) cells.push(y + "-" + pad(m) + "-" + pad(d));
    while (cells.length % 7) cells.push(null);
    return cells;
  }
  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "i-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function rec(iso) { return DATA && DATA.days ? DATA.days[iso] : null; }

  /* ---------- items ---------- */
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      items = Array.isArray(arr) ? arr : [];
    } catch (e) {
      items = [];
    }
  }
  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
  function itemsOn(iso) {
    return items
      .filter((it) => it.date === iso)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.title.localeCompare(b.title));
  }
  function countsFor(today) {
    const todo = items.filter((it) => it.date === today && it.status !== "已完结").length;
    const due = items.filter((it) => it.date === today && it.status !== "已完结").length;
    const overdue = items.filter((it) => it.date < today && it.status !== "已完结").length;
    return { todo, due, overdue };
  }


  /* ---------- routing ---------- */
  function route() {
    const hash = (location.hash || "#/").replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean);
    const today = todayISO();
    if (parts[0] === "m" && parts[1] && /^\d{4}-\d{2}$/.test(parts[1])) {
      return { view: "month", ym: clampYM(parts[1]), day: parts[2] || null, settings: false, today };
    }
    if (parts[0] === "settings") {
      return { view: "settings", ym: null, day: null, settings: true, today };
    }
    return { view: "year", ym: null, day: parts[0] === "d" ? parts[1] : null, settings: false, today };
  }
  function clampYM(ym) {
    const r = rangeYM();
    if (ym < r.min) return r.min;
    if (ym > r.max) return r.max;
    return ym;
  }
  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }


  /* ---------- captions ---------- */
  function shortLabel(iso, compact) {
    const d = rec(iso);
    if (!d) return "";
    if (d.holiday) {
      if (d.holiday.type === "班") return compact ? "班" : "调休上班";
      const s = d.holiday.short || "";
      return compact ? s.slice(0, 2) : s;
    }
    if (d.solarTerm) return d.solarTerm;
    if (d.traditionalFestival) return compact ? d.traditionalFestival.slice(0, 2) : d.traditionalFestival;
    if (d.gregorianFestival) return compact ? d.gregorianFestival.slice(0, 2) : d.gregorianFestival;
    return compact ? "" : "";
  }
  function monthDayLabel(iso) {
    const d = rec(iso);
    if (!d) return "";
    if (d.solarTerm) return d.solarTerm;
    if (d.traditionalFestival) return d.traditionalFestival;
    if (d.gregorianFestival) return d.gregorianFestival;
    return d.label || d.lunarText || "";
  }
  function badgeText(kind) {
    if (kind === "国定" || kind === "休") return "休";
    if (kind === "班") return "班";
    return "";
  }
  function legendHtml(opts) {
    const today = opts && opts.today;
    const style = opts && opts.style ? ` style="${opts.style}"` : "";
    return `<div class="legend"${style}>
          <span><i style="background:var(--国定)"></i>休</span>
          <span><i style="background:var(--班)"></i>班</span>
          <span><i style="background:var(--周末)"></i>周末</span>
          ${today ? `<span><i style="background:var(--今天)"></i>今天</span>` : ""}
        </div>`;
  }

  /* ---------- render ---------- */
  function render() {
    if (!DATA) return;
    const r = route();
    if (r.view === "month") renderMonth(r);
    else if (r.view === "settings") renderSettings(r);
    else renderYear(r);
    if (r.day) openDay(r.day, false);
  }

  function topbar(title, leftHtml, rightHtml) {
    return `<header class="topbar">
      <div class="left">${leftHtml || ""}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="right">${rightHtml || ""}</div>
    </header>`;
  }


  /* ---------- user quote ---------- */
  function loadQuote() {
    try { quoteText = localStorage.getItem(QUOTE_KEY) || ""; } catch (e) { quoteText = ""; }
  }
  function saveQuote(t) {
    quoteText = t;
    try { localStorage.setItem(QUOTE_KEY, t); } catch (e) {}
  }
  function openQuoteEditor() {
    closePhotoSheet();
    const bd = document.createElement("div");
    bd.className = "pbackdrop";
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="grab"></div>
      <h2>写一句话</h2>
      <div class="meta">显示在首页，只保存在这台手机上。</div>
      <div class="form"><label>内容（最多 80 字）<textarea id="q-text" maxlength="80" placeholder="例如：今天也要好好吃饭">${escapeHtml(quoteText)}</textarea></label></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn-primary" type="button" id="q-save">保存</button>
        <button class="btn-ghost" type="button" id="q-clear">清空</button>
        <button class="btn-ghost" type="button" id="q-cancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.remove(); });
    bd.querySelector("#q-cancel").addEventListener("click", () => bd.remove());
    bd.querySelector("#q-save").addEventListener("click", () => {
      saveQuote(bd.querySelector("#q-text").value.trim().slice(0, 80));
      bd.remove(); render();
    });
    bd.querySelector("#q-clear").addEventListener("click", () => {
      saveQuote(""); bd.remove(); render();
    });
  }

  /* ---------- IndexedDB (photos stay on this device) ---------- */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no indexedDB")); return; }
      const q = indexedDB.open("calendar-diy-photos", 1);
      q.onupgradeneeded = () => {
        const db = q.result;
        db.createObjectStore("photos", { keyPath: "ym" });
        db.createObjectStore("src", { keyPath: "ym" });
      };
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error || new Error("idb error"));
      q.onblocked = () => reject(new Error("idb blocked"));
    });
    return dbPromise;
  }
  function idbRun(stores, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let out;
      try { out = fn(tx); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    }));
  }
  function idbGetAll(store) {
    return idbRun([store], "readonly", (tx) => tx.objectStore(store).getAll());
  }
  async function loadPhotos() {
    try {
      const list = await Promise.race([
        idbGetAll("photos"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))
      ]);
      photos = {};
      (list || []).forEach((p) => { if (p && p.ym) photos[p.ym] = p; });
      dbOk = true;
    } catch (e) {
      dbOk = false;
    }
  }

  /* ---------- image processing (canvas, in the browser) ---------- */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片无法读取"));
      img.src = url;
    });
  }
  function canvasOf(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  async function fileToSrc(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const k = Math.min(1, SRC_LONG_EDGE / Math.max(iw, ih));
      const c = canvasOf(iw * k, ih * k);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.86);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function maxCropW(iw, ih) {
    return Math.min(1, (ih * 4) / (3 * iw));
  }
  function drawCrop(img, crop, W, H) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sw = crop.w * iw, sh = sw * 0.75;
    const c = canvasOf(W, H);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, crop.x * iw, crop.y * ih, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  /* portrait background: the 4:3 crop in the middle, blurred fill above and below
     (no ctx.filter: iOS Safari lacks it, so blur by down/up scaling). */
  function portraitOf(cropCanvas, W, H) {
    const out = canvasOf(W, H);
    const ctx = out.getContext("2d");
    const cw = cropCanvas.width, ch = cropCanvas.height;
    const k = Math.max(W / cw, H / ch);
    const small = canvasOf(Math.max(4, W / 24), Math.max(4, H / 24));
    small.getContext("2d").drawImage(cropCanvas, (cw - W / k) / 2, (ch - H / k) / 2, W / k, H / k, 0, 0, small.width, small.height);
    const mid = canvasOf(small.width * 3, small.height * 3);
    mid.getContext("2d").imageSmoothingQuality = "high";
    mid.getContext("2d").drawImage(small, 0, 0, mid.width, mid.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mid, 0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, W, H);
    const bh = W * 0.75;
    ctx.drawImage(cropCanvas, 0, (H - bh) / 2, W, bh);
    return out;
  }
  function derive(img, crop) {
    const hero = drawCrop(img, crop, 1440, 1080);
    const card = portraitOf(hero, 600, 900);
    const thumb = portraitOf(hero, 330, 440);
    return {
      hero: hero.toDataURL("image/jpeg", 0.85),
      card: card.toDataURL("image/jpeg", 0.8),
      thumb: thumb.toDataURL("image/jpeg", 0.8)
    };
  }
  async function savePhoto(ym, srcData, crop) {
    const img = await loadImage(srcData);
    const d = derive(img, crop);
    const recd = { ym: ym, hero: d.hero, card: d.card, thumb: d.thumb, crop: crop, updatedAt: Date.now() };
    photos[ym] = recd;
    if (!dbOk) { try { await openDB(); dbOk = true; } catch (e) {} }
    try {
      await idbRun(["photos", "src"], "readwrite", (tx) => {
        tx.objectStore("photos").put(recd);
        tx.objectStore("src").put({ ym: ym, data: srcData });
      });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      return true;
    } catch (e) {
      showToast("这次没能保存到本机，请检查存储空间；重新打开后图片可能会消失");
      return false;
    }
  }
  async function removePhoto(ym) {
    delete photos[ym];
    try {
      await idbRun(["photos", "src"], "readwrite", (tx) => {
        tx.objectStore("photos").delete(ym);
        tx.objectStore("src").delete(ym);
      });
    } catch (e) {}
  }
  async function clearAllPhotos() {
    photos = {};
    try {
      await idbRun(["photos", "src"], "readwrite", (tx) => {
        tx.objectStore("photos").clear();
        tx.objectStore("src").clear();
      });
    } catch (e) {}
  }
  async function getSrc(ym) {
    const list = await idbRun(["src"], "readonly", (tx) => tx.objectStore("src").get(ym));
    return list && list.data;
  }

  /* ---------- photo menu + file picking ---------- */
  function ymLabel(ym) {
    const p = parseYM(ym);
    return p.y + "年" + p.m + "月";
  }
  function closePhotoSheet() {
    document.querySelectorAll(".pbackdrop").forEach((el) => el.remove());
  }
  function pickFile(ym) {
    pendingYM = ym;
    const inp = document.getElementById("photo-file");
    if (inp) inp.click();
  }
  function photoMenu(ym) {
    closePhotoSheet();
    if (!photos[ym]) { pickFile(ym); return; }
    const bd = document.createElement("div");
    bd.className = "pbackdrop";
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="grab"></div>
      <h2>${ymLabel(ym)} 的照片</h2>
      <div class="meta">照片只保存在${WHERE}，不会上传。</div>
      <div class="menu-list">
        <button type="button" data-act="change">从相册换一张</button>
        <button type="button" data-act="adjust">调整位置和大小</button>
        <button type="button" data-act="remove" class="danger">删除这张照片</button>
        <button type="button" data-act="cancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.remove(); });
    bd.querySelector('[data-act="cancel"]').addEventListener("click", () => bd.remove());
    bd.querySelector('[data-act="change"]').addEventListener("click", () => { bd.remove(); pickFile(ym); });
    bd.querySelector('[data-act="adjust"]').addEventListener("click", async () => {
      bd.remove();
      try {
        const src = await getSrc(ym);
        if (!src) { showToast("找不到原图，请重新选择照片"); pickFile(ym); return; }
        await cropAndSave(ym, src, photos[ym] && photos[ym].crop);
      } catch (e) { showToast("读取失败，请重新选择照片"); }
    });
    bd.querySelector('[data-act="remove"]').addEventListener("click", async () => {
      if (!confirm("删除 " + ymLabel(ym) + " 的照片？")) return;
      bd.remove();
      await removePhoto(ym);
      showToast("已删除");
      render();
    });
  }
  async function onPhotoChosen(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    const ym = pendingYM;
    if (!file || !ym) return;
    try {
      showToast("正在处理照片…");
      const src = await fileToSrc(file);
      await cropAndSave(ym, src, null);
    } catch (e) {
      showToast("这张图片无法打开，换一张试试（支持 JPG、PNG、HEIC）");
    }
  }
  async function cropAndSave(ym, src, crop0) {
    const crop = await openCropper(ym, src, crop0);
    if (!crop) return;
    showToast("正在保存…");
    const ok = await savePhoto(ym, src, crop);
    render();
    if (ok) showToast("已保存到这台手机");
  }

  /* ---------- batch add (pick many, fill empty months in order) ---------- */
  function batchTargets() {
    const r = rangeYM();
    let start = currentMonthYM();
    if (start < r.min || start > r.max) start = r.min;
    const out = [];
    for (let ym = start; ym <= r.max; ym = addMonth(ym, 1)) {
      if (!photos[ym]) out.push(ym);
    }
    return out;
  }
  function pickBatch() {
    const targets = batchTargets();
    if (!targets.length) { showToast("从本月起的月份都已有照片，先删除或换图再批量添加"); return; }
    const inp = document.getElementById("photo-files");
    if (inp) inp.click();
  }
  function centerCrop(iw, ih) {
    const w = maxCropW(iw, ih);
    const h = (w * iw * 0.75) / ih;
    return { x: (1 - w) / 2, y: Math.max(0, (1 - h) / 2), w: w };
  }
  async function onBatchChosen(ev) {
    const files = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = "";
    if (!files.length) return;
    const targets = batchTargets();
    if (!targets.length) { showToast("从本月起的月份都已有照片"); return; }
    const use = files.slice(0, targets.length);
    const extra = files.length - use.length;
    let done = 0, failed = 0;
    for (let i = 0; i < use.length; i++) {
      showToast("正在添加 " + (i + 1) + " / " + use.length + "…");
      try {
        const src = await fileToSrc(use[i]);
        const img = await loadImage(src);
        const crop = centerCrop(img.naturalWidth, img.naturalHeight);
        if (await savePhoto(targets[i], src, crop)) done++; else failed++;
      } catch (e) { failed++; }
    }
    render();
    const first = targets[0], last = targets[Math.max(0, use.length - 1)];
    let msg = "已添加 " + done + " 张（" + ymLabel(first) + (use.length > 1 ? " 起至 " + ymLabel(last) : "") + "）";
    if (failed) msg += "，" + failed + " 张无法读取";
    if (extra > 0) msg += "；多出的 " + extra + " 张没有位置，未使用";
    showToast(msg);
  }

  /* ---------- cropper ---------- */
  function openCropper(ym, srcData, crop0) {
    return new Promise(async (resolve) => {
      let img;
      try { img = await loadImage(srcData); } catch (e) { showToast("图片无法读取"); resolve(null); return; }
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const maxW = maxCropW(iw, ih);
      const el = document.createElement("div");
      el.className = "cropper";
      el.innerHTML = `<div class="cr-head">
          <button type="button" class="cr-cancel">取消</button>
          <b>${ymLabel(ym)} · 调整照片</b>
          <button type="button" class="cr-done">完成</button>
        </div>
        <div class="cr-stage">
          <div class="cr-frame"><img alt="" draggable="false"><i class="g g1"></i><i class="g g2"></i><i class="g g3"></i><i class="g g4"></i></div>
        </div>
        <div class="cr-ctl">
          <span>缩小</span>
          <input class="cr-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="缩放">
          <span>放大</span>
        </div>
        <p class="cr-tip">拖动照片调整位置，双指或滑块缩放。取景框是首页的 4:3 大图，月历背景会自动补满。</p>`;
      document.body.appendChild(el);
      const oldToast = document.querySelector(".toast");
      if (oldToast) oldToast.remove();
      const stage = el.querySelector(".cr-stage");
      const frame = el.querySelector(".cr-frame");
      const im = frame.querySelector("img");
      const slider = el.querySelector(".cr-zoom");
      im.src = srcData;
      const fw = Math.max(200, Math.min(window.innerWidth - 32, 560, (window.innerHeight - 250) * 4 / 3));
      const fh = fw * 0.75;
      frame.style.width = fw + "px";
      frame.style.height = fh + "px";
      let z = 1, cx = iw / 2, cy = ih / 2;
      function cropWpx() { return (maxW * iw) / z; }
      function clamp() {
        const hw = cropWpx() / 2, hh = hw * 0.75;
        cx = Math.min(Math.max(cx, hw), Math.max(hw, iw - hw));
        cy = Math.min(Math.max(cy, hh), Math.max(hh, ih - hh));
      }
      function paint() {
        clamp();
        const s = fw / cropWpx();
        im.style.width = iw * s + "px";
        im.style.height = ih * s + "px";
        im.style.transform = "translate(" + (fw / 2 - cx * s) + "px," + (fh / 2 - cy * s) + "px)";
        slider.value = String(z);
      }
      if (crop0 && crop0.w > 0) {
        z = Math.min(4, Math.max(1, maxW / crop0.w));
        cx = crop0.x * iw + cropWpx() / 2;
        cy = crop0.y * ih + (cropWpx() * 0.75) / 2;
      } else {
        const hw = cropWpx() / 2, hh = hw * 0.75;
        cx = iw / 2;
        cy = hh + Math.max(0, ih - 2 * hh) * 0.4;
      }
      paint();
      const ptrs = new Map();
      let lastDist = 0;
      stage.addEventListener("pointerdown", (e) => {
        stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) {
          const [a, b] = Array.from(ptrs.values());
          lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
      });
      stage.addEventListener("pointermove", (e) => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        const s = fw / cropWpx();
        if (ptrs.size === 1) {
          cx -= (e.clientX - p.x) / s;
          cy -= (e.clientY - p.y) / s;
          p.x = e.clientX; p.y = e.clientY;
        } else if (ptrs.size === 2) {
          const before = Array.from(ptrs.values());
          const mx0 = (before[0].x + before[1].x) / 2, my0 = (before[0].y + before[1].y) / 2;
          p.x = e.clientX; p.y = e.clientY;
          const [a, b] = Array.from(ptrs.values());
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (lastDist > 0) z = Math.min(4, Math.max(1, z * d / lastDist));
          lastDist = d;
          cx -= ((a.x + b.x) / 2 - mx0) / s;
          cy -= ((a.y + b.y) / 2 - my0) / s;
        }
        paint();
      });
      function up(e) { ptrs.delete(e.pointerId); lastDist = 0; }
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);
      stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        z = Math.min(4, Math.max(1, z * Math.exp(-e.deltaY * 0.002)));
        paint();
      }, { passive: false });
      slider.addEventListener("input", () => { z = Number(slider.value); paint(); });
      function close(v) { el.remove(); resolve(v); }
      el.querySelector(".cr-cancel").addEventListener("click", () => close(null));
      el.querySelector(".cr-done").addEventListener("click", () => {
        clamp();
        const w = cropWpx();
        close({ x: (cx - w / 2) / iw, y: (cy - (w * 0.75) / 2) / ih, w: w / iw });
      });
    });
  }

  function bindPhotoButtons() {
    $app.querySelectorAll("[data-photo]").forEach((el) => {
      const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        photoMenu(el.getAttribute("data-photo"));
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
    });
  }


  function specialLabel() { return ""; }

  function quoteBlock() {
    const has = !!quoteText;
    return `<div class="quote${has ? "" : " blank"}" role="button" tabindex="0" aria-label="编辑这句话">${has ? escapeHtml(quoteText) : "点这里，写一句想对自己说的话"}</div>`;
  }
  function bindQuoteCard() {
    const el = document.querySelector(".quote");
    if (!el) return;
    el.addEventListener("click", (e) => { e.preventDefault(); openQuoteEditor(); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openQuoteEditor(); }
    });
  }

  function renderYear(r) {
    const today = r.today;
    const c = countsFor(today);
    const d = rec(today);
    const lunar = d
      ? [d.lunarText, d.solarTerm, d.traditionalFestival, d.gregorianFestival].filter(Boolean).join(" · ")
      : (todayInRange() ? "" : "今天不在日历范围内");
    const statusLine = d && d.holiday
      ? `${d.holiday.type === "班" ? "调休上班" : "休息"} · ${d.holiday.name}`
      : (d && (d.kind === "周末") ? "周末" : "");

    let months = "";
    for (let m = 1; m <= 12; m++) {
      months += miniMonth(2027, m, today);
    }

    $app.innerHTML = `<div class="app">
      ${topbar(APP_NAME, "", `<button class="btn-text" data-go="#/settings">设置</button>`)}
      <div class="page">
        <section class="today-card">
          ${heroBlock()}
          <div class="body">
            <div class="when">
              <div class="date">${formatLong(today)}</div>
              <div class="week">星期${weekdayName(today)}</div>
              <div class="lunar">${escapeHtml(lunar)}${statusLine ? "<br>" + escapeHtml(statusLine) : ""}</div>
            </div>
            <div class="stats">
              <div class="stat"><b>${c.todo}</b><span>今日待办</span></div>
              <div class="stat due"><b>${c.due}</b><span>今日到期</span></div>
              <div class="stat overdue"><b>${c.overdue}</b><span>逾期</span></div>
            </div>
            ${quoteBlock()}
          </div>
        </section>
        ${thisMonthBlock(today)}
        <div class="sec-title"><span>全年总览</span><button type="button" id="btn-batch-year">批量添加照片</button></div>
        ${legendHtml({ today: true })}
        <div class="year-grid">${months}</div>
      </div>
    </div>`;
    bindNav();
    bindQuoteCard();
    bindPhotoButtons();
    const by = document.getElementById("btn-batch-year");
    if (by) by.addEventListener("click", pickBatch);
  }

  function heroBlock() {
    const ym = currentMonthYM();
    const ph = photos[ym];
    if (ph) {
      return `<div class="hero has-img" data-photo="${ym}" role="button" tabindex="0" aria-label="换图">
            <img src="${ph.hero}" alt="" decoding="async">
            <div class="fade"></div>
            <span class="hero-chip">${CAM_SVG}<em>换图</em></span>
          </div>`;
    }
    return `<div class="hero blank" data-photo="${ym}" role="button" tabindex="0" aria-label="点击添加照片">
            <div class="ph">
              <span class="plus">+</span>
              <b>点击添加照片</b>
              <small>${ymLabel(ym)} · 只保存在这台手机上</small>
            </div>
          </div>`;
  }
  function monthPhotoImg(ym, kind, eager) {
    const ph = photos[ym];
    if (!ph) return "";
    const src = kind === "year" ? ph.thumb : ph.card;
    return `<img class="photo-bg" src="${src}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
  }

  function thisMonthBlock(today) {
    if (!todayInRange()) return "";
    const ym = currentMonthYM();
    const { y, m } = parseYM(ym);
    return `<div class="sec-title">本月 <button data-go="#/m/${ym}">打开详情</button></div>
        <div class="this-month">${miniMonth(y, m, today, true)}</div>`;
  }

  function formatLong(iso) {
    const [y, m, d] = iso.split("-");
    return `${Number(y)}年${Number(m)}月${Number(d)}日`;
  }


  function miniMonth(y, m, today, featured) {
    const cells = monthCells(y, m);
    const ym = y + "-" + pad(m);
    const title = featured ? (y + "年" + m + "月") : (m + "月");
    const photoCls = photos[ym] ? " has-photo" : "";
    const daysHtml = cells.map((iso) => {
      if (!iso) return `<div class="cell is-muted"></div>`;
      const d = rec(iso);
      const kind = d ? d.kind : "";
      const mark = specialLabel(iso);
      const lab = mark || shortLabel(iso, true);
      const cls = [
        "cell",
        kind ? "kind-" + kind : "",
        iso === today ? "is-today" : "",
        itemsOn(iso).length ? "has-item" : "",
        mark ? "has-special" : ""
      ].filter(Boolean).join(" ");
      return `<div class="${cls}"><span class="n">${Number(iso.slice(-2))}</span>${lab ? `<span class="lab${mark ? " special" : ""}">${escapeHtml(lab)}</span>` : ""}</div>`;
    }).join("");
    return `<div role="button" tabindex="0" class="mini${featured ? " featured" : ""}${photoCls}" data-go="#/m/${ym}">
      ${photoCls ? monthPhotoImg(ym, featured ? "card" : "year", !!featured) : ""}
      <div class="mtitle"><span>${title}</span><span class="photo-btn" role="button" tabindex="0" data-photo="${ym}" aria-label="${photoCls ? "换图" : "添加照片"}">${CAM_SVG}</span></div>
      <div class="dow">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="days">${daysHtml}</div>
    </div>`;
  }

  function renderMonth(r) {
    const { y, m } = parseYM(r.ym);
    const today = r.today;
    const prev = addMonth(r.ym, -1);
    const next = addMonth(r.ym, 1);
    const canPrev = r.ym > rangeYM().min;
    const canNext = r.ym < rangeYM().max;
    const title = `${y}年${m}月`;
    const cells = monthCells(y, m);
    const grid = cells.map((iso) => {
      if (!iso) return `<div class="mcell is-muted"></div>`;
      const d = rec(iso);
      const kind = d ? d.kind : (function () {
        const wd = new Date(iso + "T00:00:00").getDay();
        return (wd === 0 || wd === 6) ? "周末" : "工作";
      })();
      const badge = badgeText(kind);
      const lab = monthDayLabel(iso);
      const mark = specialLabel(iso);
      const labIsLunar = d && lab && lab === d.label && !d.solarTerm && !d.traditionalFestival && !d.gregorianFestival;
      const list = itemsOn(iso);
      const show = list.slice(0, 2);
      const more = list.length - show.length;
      const its = show.map((it) => {
        const cls = it.status === "已完结" ? "it done" : "it imp-" + (it.importance || "中");
        return `<div class="${cls}">${escapeHtml(it.title)}</div>`;
      }).join("") + (more > 0 ? `<div class="more">另有 ${more} 项</div>` : "");
      const cls = [
        "mcell",
        kind ? "kind-" + kind : "",
        iso === today ? "is-today" : "",
        mark ? "has-special" : ""
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-day="${iso}">
        <div class="hd"><span class="n">${Number(iso.slice(-2))}</span>${badge ? `<span class="badge badge-${kind}">${badge}</span>` : ""}</div>
        ${mark ? `<div class="mark">${escapeHtml(mark)}</div>` : ""}
        ${lab ? `<div class="lab${labIsLunar ? " lunar" : ""}">${escapeHtml(lab)}</div>` : ""}
        ${its}
      </button>`;
    }).join("");

    $app.innerHTML = `<div class="app">
      ${topbar(
        title,
        `<button class="btn-text" data-go="#/">全年</button>`,
        `<span>
          <button class="btn-icon" data-go="${canPrev ? "#/m/" + prev : "#/m/" + r.ym}" ${canPrev ? "" : "disabled"} aria-label="上一月">‹</button>
          <button class="btn-icon" data-go="${canNext ? "#/m/" + next : "#/m/" + r.ym}" ${canNext ? "" : "disabled"} aria-label="下一月">›</button>
        </span>`
      )}
      <div class="page">
        <div class="month-wrap${photos[r.ym] ? " has-photo" : ""}" id="month-wrap">
          ${monthPhotoImg(r.ym, "card", true)}
          <div class="month-tools"><button type="button" class="photo-chip" data-photo="${r.ym}">${CAM_SVG}<span>${photos[r.ym] ? "换背景图" : "添加背景图"}</span></button></div>
          <div class="month-dow">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
          <div class="month-grid">${grid}</div>
        </div>
        ${legendHtml({ style: "margin-top:12px" })}
      </div>
    </div>`;
    bindNav();
    bindPhotoButtons();
    $app.querySelectorAll("[data-day]").forEach((el) => {
      el.addEventListener("click", () => openDay(el.getAttribute("data-day"), true));
    });
    bindSwipe(r.ym, canPrev, canNext, prev, next);
  }

  function bindSwipe(ym, canPrev, canNext, prev, next) {
    const wrap = document.getElementById("month-wrap");
    if (!wrap) return;
    let x0 = null, y0 = null, locked = null;
    wrap.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      x0 = t.clientX; y0 = t.clientY; locked = null;
    }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0 && canPrev) go("#/m/" + prev);
      if (dx < 0 && canNext) go("#/m/" + next);
    }, { passive: true });
  }


  function photoCount() { return Object.keys(photos).length; }

  function renderSettings(r) {
    const icsHttps = new URL("national-2027.ics", location.href).href;
    const webcal = icsHttps.replace(/^https:/, "webcal:").replace(/^http:/, "webcal:");
    const counts = (DATA.meta && DATA.meta.counts) || {};
    const countLines = Object.keys(counts).map((k) => `<li>${k} ${counts[k]} 天</li>`).join("");
    $app.innerHTML = `<div class="app">
      ${topbar("设置", `<button class="btn-text" data-go="#/">返回</button>`, "")}
      <div class="page settings">
        <div class="block">
          <h3>我的照片</h3>
          <p>首页大图和每个月的日历背景都由你自己选。点首页大图、月份卡片上的相机图标，就能从相册选照片、拖动缩放来裁剪。照片只保存在${WHERE}，不会上传。目前已添加 <strong>${photoCount()}</strong> 张。</p>
          <div class="actions">
            <button class="btn-primary" type="button" id="btn-batch">批量添加照片</button>
            <button class="btn-danger" type="button" id="btn-clear-photos"${photoCount() ? "" : " disabled"}>清空全部图片</button>
          </div>
          <p class="hint">${dbOk ? "" : "⚠️ 当前不能保存图片，关闭后图片会消失。"}${IS_NATIVE ? "照片和事项都保存在应用自己的存储里，卸载应用或清除应用数据会一并删除，换手机或卸载前请先「导出备份」。" : "iPhone 的 Safari 可能在存储吃紧或长期不用时清理网站数据，建议每隔一段时间用下面的「导出备份」存一份。"}</p>
        </div>
        <div class="block">
          <h3>备份与恢复</h3>
          <p>备份文件（JSON）包含你的事项、首页那句话和所有照片的原图。换机或清理网站数据前请先导出。导入时，同一个月的照片会被备份里的替换，事项合并到现有事项。</p>
          <div class="actions">
            <button class="btn-primary" type="button" id="btn-export">导出备份</button>
            <button class="btn-ghost" type="button" id="btn-import">导入备份</button>
          </div>
          <input id="import-file" type="file" accept="application/json,.json" hidden>
        </div>
        ${IS_NATIVE ? `<div class="block">
          <h3>节假日日历文件</h3>
          <p>把国家法定节假日和调休上班日导出成 .ics 文件，可用系统日历或其他日历应用打开导入。</p>
          <div class="actions">
            <button class="btn-primary" type="button" id="btn-ics-share">导出节假日日历</button>
          </div>
        </div>` : `        <div class="block">
          <h3>订阅与下载</h3>
          <p>把国家法定节假日和调休上班日加到 iPhone 自带的「日历」里。系统通知比网页更稳。订阅日历在 iPhone 上<strong>可能不会弹出提醒</strong>，请以日历中的全天事件为准。</p>
          <div class="actions">
            <a class="btn-primary" href="${escapeHtml(webcal)}">订阅到 iPhone 日历</a>
            <a class="btn-ghost" href="${escapeHtml(icsHttps)}" download="national-2027.ics">下载节假日日历</a>
          </div>
          <p class="hint">用 <strong>Safari</strong> 打开本页，点底部分享按钮，再选「添加到主屏幕」，就可以像 App 一样从桌面打开。安装后可离线查看日历。网页版不能在后台到点推送通知。</p>
        </div>`}
        <div class="block">
          <h3>关于</h3>
          <p>这是你的个人日历「${APP_NAME}」。休班按国务院公布的国家法定节假日和调休安排标注，农历、节气来自公开历法数据。</p>
          <ul>
            ${countLines}
          </ul>
          <p style="margin-top:8px">${(DATA.meta.notes || []).map(escapeHtml).join("<br>")}</p>
        </div>
      </div>
    </div>`;
    bindNav();
    document.getElementById("btn-batch").addEventListener("click", pickBatch);
    document.getElementById("btn-export").addEventListener("click", exportBackup);
    const icsBtn = document.getElementById("btn-ics-share");
    if (icsBtn) icsBtn.addEventListener("click", shareIcs);
    document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
    document.getElementById("import-file").addEventListener("change", importBackup);
    document.getElementById("btn-clear-photos").addEventListener("click", async () => {
      if (!photoCount()) return;
      if (!confirm("清空全部 " + photoCount() + " 张图片？事项不会受影响。建议先导出备份。")) return;
      await clearAllPhotos();
      showToast("已清空全部图片");
      render();
    });
  }

  function bindNav() {
    $app.querySelectorAll("[data-go]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (el.hasAttribute("disabled")) return;
        go(el.getAttribute("data-go"));
      });
    });
  }

  /* ---------- day sheet ---------- */
  function closeSheet(keepHash) {
    const r = route();
    if (!keepHash) {
      if (r.view === "month") {
        history.replaceState(null, "", "#/m/" + r.ym);
      } else {
        history.replaceState(null, "", "#/");
      }
    }
    const bd = document.querySelector(".backdrop");
    if (bd) bd.remove();
  }

  function openDay(iso, pushHash) {
    const r = route();
    if (pushHash) {
      const base = r.view === "month" ? "#/m/" + r.ym + "/" + iso : "#/m/" + ymOf(iso) + "/" + iso;
      if (location.hash !== base) history.replaceState(null, "", base);
    }
    const existing = document.querySelector(".backdrop");
    if (existing) existing.remove();
    const d = rec(iso);
    const holiday = d && d.holiday;
    const kind = d ? d.kind : "";
    const lunar = d
      ? [d.lunarText, d.solarTerm, d.traditionalFestival, d.gregorianFestival].filter(Boolean).join(" · ")
      : "";
    const mark = specialLabel(iso);
    let pill = "";
    if (holiday) {
      const typeLabel = holiday.type === "班" ? "班" : "休";
      const label = typeLabel + " · " + holiday.name;
      pill += `<span class="pill pill-${holiday.type === "班" ? "班" : "国定"}">${escapeHtml(label)}</span>`;
    } else if (kind === "周末") {
      pill += `<span class="pill pill-周末">周末</span>`;
    }
    if (mark) {
      pill += `<span class="pill pill-special">${escapeHtml(mark)}</span>`;
    }
    const list = itemsOn(iso);
    const listHtml = list.length
      ? list.map((it) => itemCard(it)).join("")
      : `<div class="empty">这一天还没有事项。</div>`;

    const bd = document.createElement("div");
    bd.className = "backdrop";
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="day-title">
      <div class="grab"></div>
      <h2 id="day-title">${formatLong(iso)} 星期${weekdayName(iso)}</h2>
      <div class="meta">${escapeHtml(lunar)}</div>
      ${pill}
      <div id="day-items">${listHtml}</div>
      <div class="actions">
        <button class="btn-primary" type="button" id="btn-add">添加事项</button>
        <button class="btn-ghost" type="button" id="btn-close">关闭</button>
      </div>
      <div id="day-form" hidden></div>
    </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
    bd.querySelector("#btn-close").addEventListener("click", () => closeSheet());
    bd.querySelector("#btn-add").addEventListener("click", () => showForm(iso, null));
    bd.querySelectorAll("[data-edit]").forEach((el) => {
      el.addEventListener("click", () => showForm(iso, el.getAttribute("data-edit")));
    });
    bd.querySelectorAll("[data-del]").forEach((el) => {
      el.addEventListener("click", () => deleteItem(iso, el.getAttribute("data-del")));
    });
  }

  function itemCard(it) {
    const done = it.status === "已完结";
    const sub = [
      it.time || "",
      it.importance ? it.importance + "优先级" : "",
      it.status || "",
      it.location || ""
    ].filter(Boolean).join(" · ");
    return `<div class="item-card">
      <div class="ttl ${done ? "done" : ""}">${escapeHtml(it.title || "未命名")}</div>
      <div class="sub"><span class="tag-${escapeHtml(it.importance || "中")}">${escapeHtml(sub)}</span>${it.note ? "<br>" + escapeHtml(it.note) : ""}</div>
      <div class="row-btns">
        <button type="button" data-edit="${escapeHtml(it.id)}">编辑</button>
        <button type="button" data-del="${escapeHtml(it.id)}">删除</button>
      </div>
    </div>`;
  }

  function showForm(iso, id) {
    const it = id ? items.find((x) => x.id === id) : {
      id: "", date: iso, title: "", time: "", importance: "中", location: "", note: "", status: "未开办"
    };
    const box = document.getElementById("day-form");
    box.hidden = false;
    box.innerHTML = `<div class="form">
      <label>事项名称<input id="f-title" type="text" maxlength="80" value="${escapeHtml(it.title)}" placeholder="例如：做 AC 维保"></label>
      <div class="pair">
        <label>时间（可选）<input id="f-time" type="time" value="${escapeHtml(it.time || "")}"></label>
        <label>重要程度
          <select id="f-imp">${IMPORTANCE.map((v) => `<option ${v === (it.importance || "中") ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
      </div>
      <label>地点<input id="f-loc" type="text" maxlength="80" value="${escapeHtml(it.location || "")}" placeholder="可选"></label>
      <label>状态
        <select id="f-status">${STATUS.map((v) => `<option ${v === (it.status || "未开办") ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <label>备注<textarea id="f-note" maxlength="400" placeholder="可选">${escapeHtml(it.note || "")}</textarea></label>
      <div class="actions">
        <button class="btn-primary" type="button" id="f-save">保存</button>
        <button class="btn-ghost" type="button" id="f-cancel">取消</button>
      </div>
    </div>`;
    document.getElementById("f-cancel").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
    document.getElementById("f-save").addEventListener("click", () => {
      const title = document.getElementById("f-title").value.trim();
      if (!title) { showToast("请填写事项名称"); document.getElementById("f-title").focus(); return; }
      const record = {
        id: it.id || uid(),
        date: iso,
        title,
        time: document.getElementById("f-time").value || "",
        importance: document.getElementById("f-imp").value,
        location: document.getElementById("f-loc").value.trim(),
        note: document.getElementById("f-note").value.trim(),
        status: document.getElementById("f-status").value
      };
      const idx = items.findIndex((x) => x.id === record.id);
      if (idx >= 0) items[idx] = record;
      else items.push(record);
      saveItems();
      showToast("已保存（只存在这台手机上）");
      // re-render month/year under the sheet, then reopen sheet
      const open = iso;
      render();
      openDay(open, false);
    });
    setTimeout(() => document.getElementById("f-title").focus(), 50);
  }

  function deleteItem(iso, id) {
    if (!confirm("删除这条事项？")) return;
    items = items.filter((x) => x.id !== id);
    saveItems();
    showToast("已删除");
    render();
    openDay(iso, false);
  }


  /* ---------- native (Capacitor) file sharing ---------- */
  async function shareFileNative(name, text, mime) {
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!P || !P.Filesystem || !P.Share) { showToast("这个设备不能导出文件"); return false; }
    try {
      showToast("正在生成文件…");
      const w = await P.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      await P.Share.share({ title: name, text: name, url: w.uri, dialogTitle: "保存或分享：" + name });
      return true;
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return false;
      showToast("导出失败：" + String((e && e.message) || e).slice(0, 40));
      return false;
    }
  }
  async function shareIcs() {
    try {
      const res = await fetch("./national-2027.ics");
      const text = await res.text();
      await shareFileNative("国家节假日-2027.ics", text, "text/calendar");
    } catch (e) { showToast("读取节假日文件失败"); }
  }

  /* ---------- backup ---------- */
  async function exportBackup() {
    let srcs = [];
    try { srcs = await idbGetAll("src"); } catch (e) {}
    const srcMap = {};
    srcs.forEach((s) => { srcMap[s.ym] = s.data; });
    const photoList = Object.keys(photos).sort().map((ym) => ({
      ym: ym,
      crop: photos[ym].crop,
      src: srcMap[ym] || photos[ym].hero
    }));
    const payload = {
      app: APP_NAME,
      version: 2,
      exportedAt: new Date().toISOString(),
      quote: quoteText,
      items: items,
      photos: photoList
    };
    const json = JSON.stringify(payload);
    const name = "我的日历-备份-" + todayISO() + ".json";
    if (IS_NATIVE) {
      if (await shareFileNative(name, json, "application/json")) {
        showToast("已导出：" + items.length + " 条事项、" + photoList.length + " 张照片");
      }
      return;
    }
    const file = new File([json], name, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        showToast("已导出：" + items.length + " 条事项、" + photoList.length + " 张照片");
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showToast("已导出：" + items.length + " 条事项、" + photoList.length + " 张照片");
  }
  function importBackup(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : (data.items || []);
        if (!Array.isArray(incoming)) throw new Error("格式不对");
        const cleaned = incoming.map((it) => ({
          id: it.id || uid(),
          date: String(it.date || ""),
          title: String(it.title || "").slice(0, 80),
          time: String(it.time || ""),
          importance: IMPORTANCE.indexOf(it.importance) >= 0 ? it.importance : "中",
          location: String(it.location || "").slice(0, 80),
          note: String(it.note || "").slice(0, 400),
          status: STATUS.indexOf(it.status) >= 0 ? it.status : "未开办"
        })).filter((it) => /^\d{4}-\d{2}-\d{2}$/.test(it.date) && it.title);
        const r = rangeYM();
        const plist = (Array.isArray(data.photos) ? data.photos : []).filter((p) =>
          p && /^\d{4}-\d{2}$/.test(p.ym) && p.ym >= r.min && p.ym <= r.max &&
          typeof p.src === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(p.src));
        const q = typeof data.quote === "string" ? data.quote.slice(0, 80) : "";
        if (!cleaned.length && !plist.length && !q) { showToast("文件里没有可用内容"); return; }
        if (!confirm("导入 " + cleaned.length + " 条事项、" + plist.length + " 张照片？\n事项会合并到现有事项，同一个月的照片会被替换。")) return;
        const map = new Map(items.map((it) => [it.id, it]));
        cleaned.forEach((it) => map.set(it.id, it));
        items = Array.from(map.values());
        saveItems();
        if (q) saveQuote(q);
        let n = 0;
        for (const p of plist) {
          showToast("正在恢复照片 " + (n + 1) + "/" + plist.length + "…");
          try {
            const img = await loadImage(p.src);
            let crop = p.crop && p.crop.w > 0 ? p.crop : null;
            const mw = maxCropW(img.naturalWidth, img.naturalHeight);
            if (!crop) crop = { x: 0, y: 0, w: mw };
            crop = { x: Math.max(0, Math.min(crop.x, 1)), y: Math.max(0, Math.min(crop.y, 1)), w: Math.min(crop.w, mw) };
            crop.x = Math.min(crop.x, 1 - crop.w);
            crop.y = Math.min(crop.y, 1 - (crop.w * img.naturalWidth * 0.75) / img.naturalHeight);
            crop.y = Math.max(0, crop.y);
            if (await savePhoto(p.ym, p.src, crop)) n++;
          } catch (e) { /* skip a bad photo */ }
        }
        showToast("已导入：事项共 " + items.length + " 条，恢复照片 " + n + " 张");
        render();
      } catch (err) {
        showToast("导入失败，请选择本应用导出的 JSON");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function showToast(msg) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), msg.length > 22 ? 4200 : 2200);
  }


  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch("./data/calendar-data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      DATA = await res.json();
      loadItems();
      loadQuote();
      await loadPhotos();
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.id = "photo-file";
      inp.hidden = true;
      inp.addEventListener("change", onPhotoChosen);
      document.body.appendChild(inp);
      const inp2 = document.createElement("input");
      inp2.type = "file";
      inp2.accept = "image/*";
      inp2.multiple = true;
      inp2.id = "photo-files";
      inp2.hidden = true;
      inp2.addEventListener("change", onBatchChosen);
      document.body.appendChild(inp2);
      render();
      window.addEventListener("hashchange", render);
      if (!IS_NATIVE && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      }
    } catch (err) {
      $app.innerHTML = `<div class="err">日历数据加载失败。<br>${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  boot();
})();
