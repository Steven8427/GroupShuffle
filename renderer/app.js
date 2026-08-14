'use strict';

/**
 * GroupShuffle —— 渲染进程
 *
 * 大数据量的三个关键约束：
 *  1. 不复制字符串：items 只保留一份，全程用 Uint32Array 下标操作。
 *  2. 不阻塞主线程：解析与洗牌按 5 万/批分片，批间让出事件循环。
 *  3. 不堆 DOM：每组一个虚拟列表，只挂载可视区约 30 行。
 */
(() => {
  const { createRng, makeRandBelow, parseItems, shuffle, computeOffsets, Fenwick } = window.RGCore;
  const { t, fmt, setLang, getLang, getName, locale, has, detect, languages } = window.RGI18n;
  const api = window.api || null;
  const $ = (id) => document.getElementById(id);

  const el = {
    input: $('input'),
    lineStat: $('lineStat'),
    btnImport: $('btnImport'),
    seg: $('seg'),
    kInput: $('kInput'),
    btnRun: $('btnRun'),
    btnClear: $('btnClear'),
    optIndex: $('optIndex'),
    optWrap: $('optWrap'),
    collapsedInput: $('collapsedInput'),
    collapsedText: $('collapsedText'),
    btnExpand: $('btnExpand'),
    previewList: $('previewList'),
    resultPanel: $('resultPanel'),
    resultStat: $('resultStat'),
    btnExportAll: $('btnExportAll'),
    cards: $('cards'),
    progress: $('progress'),
    progressBar: $('progressBar'),
    toast: $('toast'),
    langPick: $('langPick'),
    btnLang: $('btnLang'),
    langName: $('langName'),
    langMenu: $('langMenu'),
    inputPanel: $('input').closest('.panel'),
  };

  /** @type {string[]} */ let items = [];
  /** @type {Uint32Array|null} */ let order = null;   // 打乱后的下标
  /** @type {Uint32Array|null} */ let offsets = null; // 长度 k+1 的组边界
  /** @type {VList[]} */ const lists = [];
  let wrapMode = true;
  let busy = false;

  // 输入超过这个行数就折叠：一个几十万像素高的 textarea 会让
  // 虚拟列表每次撑高都连带重排整个文本框（实测 600~900ms/次）
  const COLLAPSE_LINES = 5000;
  // 超过这个行数不再放回 textarea。实测原生排版：10 万行 0.9 秒、100 万行 8 秒，
  // 而且排完之后那个两千万像素高的布局会一直拖累窗口拖动和滚动
  const EXPAND_MAX_LINES = 50000;
  let rawText = '';
  let lineCount = 0;
  /**
   * 每行在 rawText 里的起始下标。100 万行只占 4MB，
   * 而切成 100 万个字符串要 120MB —— 且每切一次就是一次全量扫描。
   */
  /** @type {Uint32Array|null} */ let lineStarts = null;
  let previewCount = 0;
  let collapsed = false;
  /** @type {VList|null} */ let previewList = null;
  /** 上次分组的统计数据，切语言时要用它重新格式化 */
  let lastStats = null;

  const groupSize = (g) => offsets[g + 1] - offsets[g];
  const itemAt = (g, i) => items[order[offsets[g] + i]];

  function groupText(g, withIndex) {
    const len = groupSize(g);
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = withIndex ? `${i + 1}. ${itemAt(g, i)}` : itemAt(g, i);
    }
    return out.join('\r\n');
  }

  // ==========================================================
  // 虚拟列表
  // ==========================================================
  const measureCtx = document.createElement('canvas').getContext('2d');
  const OVERSCAN = 160; // px
  const LIST_MAX_H = 520; // 与 styles.css 的 .vlist max-height 保持一致（约 20 行）
  /**
   * 撑高元素的高度上限。Chromium 把元素高度硬钳在 33,554,428px（2^25），
   * 超过就静默截断 —— 列表尾部会滚不到，且不报任何错。
   * 100 万行、每行折成两行（46px）时总高 4600 万像素，正好会踩到。
   * 这里留出余量，超过就改走等比坐标映射。
   */
  const MAX_PAD_H = 30000000;

  class VList {
    /** @param {number} count 行数 @param {(i:number)=>string} getText 取第 i 行文本 */
    constructor(viewport, pad, count, getText) {
      this.vp = viewport;
      this.pad = pad;
      this.count = count;
      this.getText = getText;
      this.rows = [];
      this.heights = null;
      this.fen = null;
      this.baseH = 26;
      this.lineH = 20;
      this.availW = 0;
      this.unitW = 8;
      this.padH = -1;
      this.raf = 0;
      this.mounted = false;
      this.adjusting = false;
      this.onScroll = () => this.schedule();
    }

    mount() {
      if (this.mounted || this.count === 0) return;
      this.mounted = true;
      this.vp.addEventListener('scroll', this.onScroll, { passive: true });
      this.ro = new ResizeObserver(() => this.relayout(false));
      this.ro.observe(this.vp);
      this.relayout(true);
    }

    destroy() {
      if (this.ro) this.ro.disconnect();
      this.vp.removeEventListener('scroll', this.onScroll);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.mounted = false;
    }

    makeRow() {
      const row = document.createElement('div');
      row.className = 'vrow';
      const idx = document.createElement('span');
      idx.className = 'vidx';
      const txt = document.createElement('span');
      txt.className = 'vtxt';
      row.append(idx, txt);
      return row;
    }

    /** 用一个真实行量出行高与可用文本宽度，比硬编码常量可靠 */
    probe() {
      const row = this.makeRow();
      row.style.position = 'static';
      row.children[0].textContent = '000.';
      row.children[1].textContent = 'M';
      this.pad.appendChild(row);
      const cs = getComputedStyle(row.children[1]);
      this.lineH = parseFloat(cs.lineHeight) || 20;
      this.baseH = row.offsetHeight || Math.round(this.lineH + 6);
      this.availW = row.children[1].clientWidth || 300;
      measureCtx.font = `${cs.fontSize} ${cs.fontFamily}`;
      this.unitW = measureCtx.measureText('0').width || 8;
      row.remove();
    }

    buildHeights() {
      const n = this.count;
      const heights = new Uint16Array(n);
      const avail = Math.max(40, this.availW);
      const unit = this.unitW;
      const base = this.baseH;
      const lineH = this.lineH;
      for (let i = 0; i < n; i++) {
        const s = this.getText(i);
        let units = 0;
        // 粗估宽度：CJK / 全角按 2 个字符宽算
        for (let c = 0; c < s.length; c++) units += s.charCodeAt(c) < 0x2e80 ? 1 : 2;
        const lines = Math.max(1, Math.ceil((units * unit) / avail));
        heights[i] = Math.min(65535, Math.round(base + (lines - 1) * lineH));
      }
      this.heights = heights;
      this.fen = new Fenwick(n);
      this.fen.build(heights);
    }

    relayout(force) {
      if (!this.mounted) return;
      const prevAvail = this.availW;
      this.probe();
      if (wrapMode) {
        if (force || !this.fen || Math.abs(prevAvail - this.availW) > 1) this.buildHeights();
      }
      this.padH = -1;
      this.render();
      this.setPadHeight(this.totalH(), true);
    }

    totalH() { return wrapMode ? this.fen.total() : this.count * this.baseH; }
    offsetOf(i) { return wrapMode ? this.fen.prefix(i) : i * this.baseH; }
    heightOf(i) { return wrapMode ? this.heights[i] : this.baseH; }
    indexAt(y) {
      if (y <= 0) return 0;
      const i = wrapMode ? this.fen.findIndex(y) : Math.floor(y / this.baseH);
      return Math.min(this.count - 1, Math.max(0, i));
    }

    /**
     * 把浏览器的滚动位置换算成内容里的虚拟偏移。
     * 总高没超上限时两者相等，行为和以前完全一样；超了之后按滚动进度等比映射。
     * 代价是这时一个物理像素对应多个虚拟像素、滚动精度变粗，
     * 但至少能滚到最后一行 —— 不映射的话尾部是彻底摸不到的。
     */
    toVirtual(scrollTop) {
      const total = this.totalH();
      if (total <= MAX_PAD_H) return scrollTop;
      const viewH = this.vp.clientHeight || 0;
      const physRange = Math.max(1, MAX_PAD_H - viewH);
      const virtRange = Math.max(0, total - viewH);
      return Math.min(virtRange, (scrollTop / physRange) * virtRange);
    }

    schedule() {
      if (this.adjusting || this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render();
      });
    }

    render() {
      if (!this.mounted || this.count === 0) return;
      if (wrapMode && !this.fen) this.buildHeights();

      const vp = this.vp;
      const scrollTop = vp.scrollTop;
      const viewH = vp.clientHeight || 300;

      this.setPadHeight(this.totalH(), false);

      // 虚拟坐标（内容里的位置）与 pad 内的实际位置差一个 shift；
      // 没超高度上限时 shift 恒为 0，等同于以前直接用 offsetOf 定位
      const vTop = this.toVirtual(scrollTop);
      const shift = scrollTop - vTop;

      const first = this.indexAt(vTop);
      const limit = vTop + viewH + OVERSCAN;
      const visible = [];
      let y = this.offsetOf(first);
      for (let i = first; i < this.count && y < limit; i++) {
        visible.push(i);
        y += this.heightOf(i);
      }

      while (this.rows.length < visible.length) {
        const row = this.makeRow();
        this.pad.appendChild(row);
        this.rows.push(row);
      }
      for (let p = visible.length; p < this.rows.length; p++) this.rows[p].hidden = true;

      const beforeFirst = this.offsetOf(first);
      for (let p = 0; p < visible.length; p++) {
        const i = visible[p];
        const row = this.rows[p];
        row.hidden = false;
        row.children[0].textContent = i + 1 + '.';
        row.children[1].textContent = this.getText(i);
        row.style.transform = `translateY(${this.offsetOf(i) + shift}px)`;
      }

      if (!wrapMode) return;

      // 估算高度与实际渲染高度的校正：只测量已挂载的这几十行
      let changed = false;
      for (let p = 0; p < visible.length; p++) {
        const i = visible[p];
        const h = this.rows[p].offsetHeight;
        if (h > 0 && h !== this.heights[i]) {
          this.fen.add(i, h - this.heights[i]);
          this.heights[i] = Math.min(65535, h);
          changed = true;
        }
      }
      if (!changed) return;

      // 校正会挪动后续行的位置，按锚点补偿 scrollTop，避免视觉跳动。
      // 超上限走等比映射时 scrollTop 和内容偏移不是一一对应的，补偿没有意义，跳过
      const afterFirst = this.offsetOf(first);
      if (this.totalH() <= MAX_PAD_H && afterFirst !== beforeFirst && scrollTop > 0) {
        this.adjusting = true;
        vp.scrollTop = scrollTop + (afterFirst - beforeFirst);
        this.adjusting = false;
      }
      const shift2 = vp.scrollTop - this.toVirtual(vp.scrollTop);
      for (let p = 0; p < visible.length; p++) {
        this.rows[p].style.transform = `translateY(${this.offsetOf(visible[p]) + shift2}px)`;
      }
      this.setPadHeight(this.totalH(), false);
    }

    /**
     * 撑高元素每变一次，浏览器就要重排一遍；估算高度被校正后总高会不停微调，
     * 所以小幅变化先攒着，只有偏差够大、或已经滚到接近末尾时才真正写回。
     */
    setPadHeight(total, force) {
      const h = Math.min(total, MAX_PAD_H); // 超上限也没用，浏览器会钳掉
      if (!force && this.padH >= 0) {
        const nearEnd = this.vp.scrollTop + this.vp.clientHeight * 3 >= this.padH;
        if (!nearEnd && Math.abs(h - this.padH) < 400) return;
      }
      this.pad.style.height = h + 'px';
      this.padH = h;
    }
  }

  // ==========================================================
  // 结果渲染
  // ==========================================================
  let cardObserver = null;

  function clearResults() {
    lists.forEach((l) => l.destroy());
    lists.length = 0;
    if (cardObserver) cardObserver.disconnect();
    el.cards.textContent = '';
  }

  function renderResults() {
    clearResults();
    const k = offsets.length - 1;
    const frag = document.createDocumentFragment();
    const cardEls = [];

    for (let g = 0; g < k; g++) {
      const size = groupSize(g);

      const card = document.createElement('div');
      card.className = 'card';
      card.style.setProperty('--idxw', String(size).length * 7 + 4 + 'px');

      const head = document.createElement('div');
      head.className = 'card-head';

      const title = document.createElement('span');
      title.className = 'card-title';
      title.textContent = t('card.title', { n: g + 1 });

      const count = document.createElement('span');
      count.className = 'card-count';
      count.textContent = t('card.count', { n: fmt(size) });

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'btn mini';
      btnCopy.textContent = t('btn.copy');
      btnCopy.addEventListener('click', () => copyGroup(g, btnCopy));

      const btnExport = document.createElement('button');
      btnExport.type = 'button';
      btnExport.className = 'btn mini';
      btnExport.textContent = t('btn.export');
      btnExport.addEventListener('click', () => exportGroup(g, btnExport));

      actions.append(btnCopy, btnExport);
      head.append(title, count, actions);
      card.appendChild(head);

      if (size === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-group';
        empty.textContent = t('card.empty');
        card.appendChild(empty);
      } else {
        const vp = document.createElement('div');
        vp.className = 'vlist' + (wrapMode ? '' : ' nowrap');
        // 懒挂载前先按行数预留高度，卡片不会先塌成 0 再弹开
        vp.style.minHeight = Math.min(LIST_MAX_H, size * 26) + 'px';
        const pad = document.createElement('div');
        pad.className = 'vpad';
        vp.appendChild(pad);
        card.appendChild(vp);

        const list = new VList(vp, pad, size, (i) => itemAt(g, i));
        lists.push(list);
        card.__list = list;
      }

      cardEls.push(card);
      frag.appendChild(card);
    }

    el.cards.appendChild(frag);

    // 组数很多时不必一次性初始化，滚动到才挂载
    cardObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const list = entry.target.__list;
        if (list) list.mount();
        cardObserver.unobserve(entry.target);
      }
    }, { rootMargin: '250px' });
    cardEls.forEach((c) => { if (c.__list) cardObserver.observe(c); });

    el.resultPanel.hidden = false;
  }

  function refreshWrapMode() {
    document.querySelectorAll('.vlist').forEach((vp) => vp.classList.toggle('nowrap', !wrapMode));
    lists.forEach((l) => { if (l.mounted) l.relayout(true); });
    if (previewList) previewList.relayout(true);
  }

  // ==========================================================
  // 复制 / 导出
  // ==========================================================
  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400);
  }

  async function copyGroup(g, btn) {
    if (groupSize(g) === 0) return;
    const ok = await writeClipboard(groupText(g, el.optIndex.checked));
    if (ok) flash(btn, t('toast.copied'));
    else toast(t('toast.copyFail'));
  }

  function downloadText(name, text) {
    const blob = new Blob(['﻿' + text.replace(/\r?\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function exportGroup(g, btn) {
    if (groupSize(g) === 0) return;
    const name = `group-${g + 1}.txt`;
    const text = groupText(g, el.optIndex.checked);
    if (!api) { downloadText(name, text); return; }
    const res = await api.saveTxt(name, text);
    if (res.canceled) return;
    if (res.ok) {
      flash(btn, t('toast.exported'));
      toast(t('toast.saved', { path: res.path }), t('toast.openLocation'), () => api.reveal(res.path));
    } else {
      toast(t('toast.exportFail', { err: res.error }));
    }
  }

  async function exportAll() {
    if (!offsets) return;
    const k = offsets.length - 1;
    const withIndex = el.optIndex.checked;
    const files = [];
    for (let g = 0; g < k; g++) {
      if (groupSize(g) === 0) continue;
      files.push({ name: `group-${g + 1}.txt`, content: groupText(g, withIndex) });
    }
    if (!files.length) return;

    if (!api) {
      files.forEach((f, i) => setTimeout(() => downloadText(f.name, f.content), i * 120));
      return;
    }
    const res = await api.saveAll(files);
    if (res.canceled) return;
    if (res.ok) {
      toast(t('toast.exportedAll', { n: res.written, dir: res.dir }), t('toast.openFolder'), () => api.reveal(res.dir));
    } else {
      toast(t('toast.exportFail', { err: res.error }));
    }
  }

  // ==========================================================
  // 主流程
  // ==========================================================
  function setBusy(on) {
    busy = on;
    [el.btnRun, el.btnClear, el.btnImport, el.btnExportAll].forEach((b) => { b.disabled = on; });
    el.btnRun.textContent = on ? t('btn.running') : t('btn.run');
    el.progress.classList.toggle('on', on);
    if (!on) el.progressBar.style.width = '0%';
  }

  const showProgress = (p) => { el.progressBar.style.width = Math.min(100, Math.round(p * 100)) + '%'; };

  function readK() {
    let k = parseInt(el.kInput.value, 10);
    if (!Number.isFinite(k) || k < 1) k = 1;
    if (k > 1000) k = 1000;
    el.kInput.value = String(k);
    el.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.k) === k));
    return k;
  }

  async function run() {
    if (busy) return;
    const k = readK();
    setBusy(true);
    const t0 = performance.now();
    try {
      showProgress(0.02);
      syncRawText();
      items = await parseItems(rawText, (p) => showProgress(p * 0.35));

      const n = items.length;
      if (n === 0) {
        toast(t('toast.noContent'));
        el.resultPanel.hidden = true;
        offsets = null; lastStats = null;
        clearResults();
        return;
      }

      order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;

      const randBelow = makeRandBelow(createRng());
      await shuffle(order, randBelow, (p) => showProgress(0.35 + p * 0.5));
      offsets = computeOffsets(n, k, randBelow);
      showProgress(0.92);

      el.cards.classList.toggle('wide', avgLength(items) > 46);
      if (lineCount > COLLAPSE_LINES) collapseInput();
      renderResults();

      const ms = Math.round(performance.now() - t0);
      let lo = Infinity, hi = 0;
      for (let g = 0; g < k; g++) {
        const s = groupSize(g);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      lastStats = { n, k, lo, hi, ms };
      renderResultStat();
      if (n < k) toast(t('toast.emptyGroups', { n, k: k - n }));
      showProgress(1);
    } finally {
      setBusy(false);
    }
  }

  function renderResultStat() {
    if (!lastStats) { el.resultStat.textContent = ''; return; }
    const { n, k, lo, hi, ms } = lastStats;
    el.resultStat.textContent = t('stat.result', {
      n: fmt(n), k, ms,
      size: lo === hi ? fmt(lo) : `${fmt(lo)}~${fmt(hi)}`,
    });
  }

  function avgLength(arr) {
    const step = Math.max(1, Math.floor(arr.length / 200));
    let sum = 0, cnt = 0;
    for (let i = 0; i < arr.length; i += step) { sum += arr[i].length; cnt++; }
    return cnt ? sum / cnt : 0;
  }

  // ==========================================================
  // 交互绑定
  // ==========================================================
  function countLines(t) {
    if (!t.length) return 0;
    let n = 1;
    for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) n++;
    return n;
  }

  /** 扫出每行的起始下标。只记位置，不切字符串 */
  function indexLines(text) {
    const n = countLines(text);
    const starts = new Uint32Array(n);
    let k = 1;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts[k++] = i + 1;
    return starts;
  }

  /** 取第 i 行；行尾的 \r 不算内容 */
  function lineAt(i) {
    const from = lineStarts[i];
    let to = i + 1 < lineStarts.length ? lineStarts[i + 1] - 1 : rawText.length;
    if (to > from && rawText.charCodeAt(to - 1) === 13) to--;
    return rawText.slice(from, to);
  }

  function setRaw(text) {
    rawText = text;
    lineStarts = indexLines(text);
    lineCount = lineStarts.length;
  }

  /**
   * 追加一段内容，只扫新增的那一块。
   * 每次粘贴都重扫全量是「一次一次加、加到后面越来越卡」的另一半原因：
   * 攒到 100 万行时，单次粘贴光数行数就要 2.1 秒。
   */
  function appendRaw(chunk) {
    if (!chunk) return 0;
    if (rawText.length && rawText.charCodeAt(rawText.length - 1) !== 10) rawText += '\n';
    const base = rawText.length;
    const added = countLines(chunk);
    const starts = new Uint32Array(added);
    starts[0] = base;
    let k = 1;
    for (let i = chunk.indexOf('\n'); i >= 0; i = chunk.indexOf('\n', i + 1)) starts[k++] = base + i + 1;
    rawText += chunk;

    const old = lineStarts;
    // 原文以换行结尾时，尾部那个空行的起点正好被新块第一行顶替，去重
    const keep = old && old.length && old[old.length - 1] === base ? old.length - 1 : (old ? old.length : 0);
    const next = new Uint32Array(keep + added);
    if (keep) next.set(old.subarray(0, keep));
    next.set(starts, keep);
    lineStarts = next;
    lineCount = next.length;
    return added;
  }

  /** 折叠状态下正文在 rawText 里，展开状态下以 textarea 为准 */
  function syncRawText() {
    if (!collapsed) setRaw(el.input.value);
    return rawText;
  }

  function updateLineStat() {
    syncRawText();
    el.lineStat.textContent = t('stat.lines', { n: fmt(lineCount) });
    el.collapsedText.textContent = t('collapsed.loaded', { n: fmt(lineCount) });
  }

  function collapseInput() {
    if (collapsed) return;
    syncRawText();
    collapsed = true;
    el.input.value = ''; // 关键：把巨大的文本控件从布局里拿掉
    el.input.hidden = true;
    el.collapsedInput.hidden = false;
    el.collapsedText.textContent = t('collapsed.loaded', { n: fmt(lineCount) });
    buildPreview();
  }

  /** 折叠后仍然要能看内容：同一套虚拟列表，只挂载可见的十几行 */
  function buildPreview() {
    destroyPreview();
    // 原文以换行结尾时末尾会多出一个空行，不显示它
    previewCount = lineCount;
    if (previewCount > 0 && lineStarts[previewCount - 1] >= rawText.length) previewCount--;
    el.previewList.classList.toggle('nowrap', !wrapMode);
    el.previewList.style.setProperty('--idxw', String(previewCount).length * 7 + 4 + 'px');
    previewList = new VList(el.previewList, el.previewList.querySelector('.vpad'), previewCount, lineAt);
    previewList.mount();
  }

  function destroyPreview() {
    if (previewList) { previewList.destroy(); previewList = null; }
    previewCount = 0;
    const pad = el.previewList.querySelector('.vpad');
    pad.textContent = '';
    pad.style.height = '';
    el.previewList.scrollTop = 0;
  }

  async function expandInput() {
    if (!collapsed) return;
    // 放回 textarea 要付一次原生排版的钱，而且排完那个几千万像素高的布局
    // 会一直拖累窗口拖动和滚动。超过上限就不做，内容照样能分组
    if (lineCount > EXPAND_MAX_LINES) {
      toast(t('toast.tooLargeToEdit', { n: fmt(lineCount), max: fmt(EXPAND_MAX_LINES) }));
      return;
    }
    if (lineCount > 20000) {
      toast(t('toast.expanding', { n: fmt(lineCount) }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    collapsed = false;
    destroyPreview();
    el.input.hidden = false;
    el.collapsedInput.hidden = true;
    el.input.value = rawText;
    el.input.focus();
  }

  let countTimer = 0;
  el.input.addEventListener('input', () => {
    clearTimeout(countTimer);
    countTimer = setTimeout(updateLineStat, 200);
  });

  el.btnExpand.addEventListener('click', expandInput);

  /**
   * 大内容永远不进 textarea。
   *
   * 判断标准是「粘完之后有多大」，不是「怎么粘的」。早先只拦整体替换，
   * 在末尾追加的粘贴从缝里溜过去 —— 于是 10 万行一次地累加时文本框一路涨到
   * 100 万行、内部两千万像素高，每次粘贴同步重排 8 秒，排完之后连拖动窗口
   * 和滚动都一直被这个巨型布局拖着。
   *
   * 挂在整个输入面板而不是 textarea 上：折叠态下 textarea 是隐藏的，
   * 但用户还要继续往里粘。
   */
  el.inputPanel.addEventListener('paste', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!text) return;

    if (collapsed) {
      // 折叠态没有光标可言，粘贴一律理解为追加。
      // 换成替换会把已经攒了几十万行的内容悄悄冲掉
      e.preventDefault();
      const added = appendRaw(text);
      buildPreview();
      updateLineStat();
      toast(t('toast.appended', { n: fmt(added), total: fmt(lineCount) }));
      return;
    }

    // 展开态：粘完仍在阈值内就交回浏览器，小输入照常编辑
    if (lineCount + countLines(text) <= COLLAPSE_LINES) return;
    e.preventDefault();
    const cur = el.input.value;
    const merged = cur.slice(0, el.input.selectionStart) + text + cur.slice(el.input.selectionEnd);
    loadText(merged);
    toast(t('toast.collapsedNow', { n: fmt(lineCount) }));
  });

  el.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-k]');
    if (!btn) return;
    el.kInput.value = btn.dataset.k;
    readK();
  });
  el.kInput.addEventListener('change', readK);

  el.btnRun.addEventListener('click', run);

  el.btnClear.addEventListener('click', () => {
    rawText = '';
    collapsed = false;
    destroyPreview();
    el.input.hidden = false;
    el.collapsedInput.hidden = true;
    el.input.value = '';
    items = []; order = null; offsets = null; lastStats = null;
    clearResults();
    el.resultPanel.hidden = true;
    updateLineStat();
    el.input.focus();
  });

  el.optWrap.addEventListener('change', () => {
    wrapMode = el.optWrap.checked;
    refreshWrapMode();
  });

  el.btnExportAll.addEventListener('click', exportAll);

  el.btnImport.addEventListener('click', async () => {
    if (!api) {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.txt,.csv,.log,text/plain';
      picker.addEventListener('change', async () => {
        const file = picker.files && picker.files[0];
        if (file) setInputText(await file.text());
      });
      picker.click();
      return;
    }
    const res = await api.openTxt();
    if (res.canceled) return;
    if (res.error) { toast(res.error); return; }
    setInputText(res.text);
  });

  /** 载入一份新内容，按体量决定进文本框还是进折叠预览。不弹提示，交给调用方说 */
  function loadText(text) {
    setRaw(text);
    if (lineCount > COLLAPSE_LINES) {
      // 大内容直接以折叠态载入，避免先把几十万像素高的文本控件建出来
      collapsed = true;
      el.input.value = '';
      el.input.hidden = true;
      el.collapsedInput.hidden = false;
      el.collapsedText.textContent = t('collapsed.loaded', { n: fmt(lineCount) });
      buildPreview();
    } else {
      collapsed = false;
      destroyPreview();
      el.input.hidden = false;
      el.collapsedInput.hidden = true;
      el.input.value = text;
    }
    updateLineStat();
  }

  function setInputText(text) {
    loadText(text);
    toast(t('toast.imported', { n: fmt(lineCount) }));
  }

  // 拖拽 .txt 到输入区
  let dragDepth = 0;
  el.inputPanel.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.inputPanel.classList.add('dropping');
  });
  el.inputPanel.addEventListener('dragover', (e) => e.preventDefault());
  el.inputPanel.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; el.inputPanel.classList.remove('dropping'); }
  });
  el.inputPanel.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.inputPanel.classList.remove('dropping');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setInputText(await file.text());
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(message, actionLabel, onAction) {
    clearTimeout(toastTimer);
    el.toast.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    el.toast.appendChild(span);
    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => { el.toast.hidden = true; onAction(); });
      el.toast.appendChild(btn);
    }
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, actionLabel ? 6000 : 2600);
  }

  // ==========================================================
  // 语言切换
  // ==========================================================
  const LANG_KEY = 'groupshuffle.lang';

  function applyI18n() {
    document.documentElement.lang = locale();
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
    el.seg.querySelectorAll('button[data-k]').forEach((btn) => {
      btn.textContent = t('seg.groups', { n: btn.dataset.k });
    });
    el.btnRun.textContent = busy ? t('btn.running') : t('btn.run');
    el.langName.textContent = getName();
    el.langMenu.querySelectorAll('[data-code]').forEach((item) => {
      item.setAttribute('aria-checked', String(item.dataset.code === getLang()));
    });
    updateLineStat();
    renderResultStat();
    // 结果里的组名/按钮也要换，重建一次卡片即可（数据不动）
    if (offsets) renderResults();
  }

  function switchLang(next) {
    setLang(next);
    try { localStorage.setItem(LANG_KEY, getLang()); } catch (_) { /* 隐私模式忽略 */ }
    // 主进程的对话框/托盘文案跟着走；失败不影响界面，吞掉即可
    if (api && api.setLang) Promise.resolve(api.setLang(getLang())).catch(() => {});
    applyI18n();
  }

  /** 菜单项由注册表生成，加语言不用碰这里 */
  function buildLangMenu() {
    const tick = $('tplTick').content.firstElementChild;
    for (const { code, name } of languages()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.dataset.code = code;
      const label = document.createElement('span');
      label.textContent = name; // 母语名，不随界面语言变
      item.append(label, tick.cloneNode(true));
      item.addEventListener('click', () => { switchLang(code); closeLangMenu(true); });
      el.langMenu.appendChild(item);
    }
  }

  function openLangMenu() {
    el.langMenu.hidden = false;
    el.btnLang.setAttribute('aria-expanded', 'true');
    const cur = el.langMenu.querySelector('[aria-checked="true"]') || el.langMenu.firstElementChild;
    if (cur) cur.focus();
  }

  function closeLangMenu(refocus) {
    if (el.langMenu.hidden) return;
    el.langMenu.hidden = true;
    el.btnLang.setAttribute('aria-expanded', 'false');
    if (refocus) el.btnLang.focus();
  }

  el.btnLang.addEventListener('click', () => {
    if (el.langMenu.hidden) openLangMenu();
    else closeLangMenu(true);
  });

  // 点到别处就收起。用 pointerdown 而不是 click：菜单项自己的 click 先跑完，不会打架
  document.addEventListener('pointerdown', (e) => {
    if (!el.langMenu.hidden && !el.langPick.contains(e.target)) closeLangMenu(false);
  });

  el.langPick.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.langMenu.hidden) return;
      e.preventDefault();
      closeLangMenu(true);
      return;
    }
    if (el.langMenu.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); openLangMenu(); }
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(el.langMenu.children);
    const at = items.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = at < 0
      ? (step > 0 ? 0 : items.length - 1)
      : (at + step + items.length) % items.length;
    items[next].focus();
  });

  buildLangMenu();

  let initial = null;
  try { initial = localStorage.getItem(LANG_KEY); } catch (_) { /* 忽略 */ }
  if (!initial || !has(initial)) initial = detect(navigator.languages || navigator.language);
  switchLang(initial);

  el.input.focus();
})();
