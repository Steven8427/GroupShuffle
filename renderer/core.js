'use strict';

/**
 * 与 DOM 无关的核心算法：随机数、解析、洗牌、分组、Fenwick 树。
 * 浏览器里挂到 window.RGCore，Node 里可 require 直接测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHUNK = 50000;
  const noop = () => {};

  /**
   * 分片之间让出事件循环。
   * 不能用 setTimeout：嵌套后被钳到 4ms，窗口最小化/后台时更会被节流到 1s 一次
   * （实测 10 万行会从 40ms 变成 3 秒）。MessageChannel 不受这两条限制。
   */
  const nextTick = (function () {
    if (typeof MessageChannel !== 'function' || typeof window === 'undefined') {
      return () => new Promise((r) => setTimeout(r, 0));
    }
    const waiting = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const resolve = waiting.shift();
      if (resolve) resolve();
    };
    return () => new Promise((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(0);
    });
  })();

  /** crypto 播种的 xoshiro128**，返回 uint32 */
  function createRng(seed) {
    let s;
    if (seed) {
      s = Uint32Array.from(seed);
    } else {
      s = new Uint32Array(4);
      globalThis.crypto.getRandomValues(s); // 浏览器与 Node 18+ 都有
    }
    let a = s[0] || 1, b = s[1] || 2, c = s[2] || 3, d = s[3] || 4;
    return function next() {
      let r = Math.imul(a, 5);
      r = Math.imul((r << 7) | (r >>> 25), 9);
      const t = b << 9;
      c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
      d = (d << 11) | (d >>> 21);
      return r >>> 0;
    };
  }

  /** 拒绝采样，避免直接取模带来的分布偏差 */
  function makeRandBelow(next) {
    return function randBelow(n) {
      if (n <= 1) return 0;
      const limit = 4294967296 - (4294967296 % n);
      let r;
      do { r = next(); } while (r >= limit);
      return r % n;
    };
  }

  /** 按行切分，丢弃纯空白行，其余内容原样保留 */
  async function parseItems(text, onProgress = noop) {
    const raw = text.split(/\r?\n/);
    const total = raw.length;
    const out = [];
    for (let i = 0; i < total; i += CHUNK) {
      const end = Math.min(total, i + CHUNK);
      for (let j = i; j < end; j++) {
        const line = raw[j];
        if (line.length === 0 || !/\S/.test(line)) continue;
        out.push(line);
      }
      if (end < total) {
        onProgress(end / total);
        await nextTick();
      }
    }
    return out;
  }

  /** 原地 Fisher–Yates，分片执行避免长任务 */
  async function shuffle(arr, randBelow, onProgress = noop) {
    const n = arr.length;
    let i = n - 1;
    while (i > 0) {
      const stop = Math.max(0, i - CHUNK);
      for (; i > stop; i--) {
        const j = randBelow(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      if (i > 0) {
        onProgress(1 - i / n);
        await nextTick();
      }
    }
    return arr;
  }

  /**
   * 组边界前缀和。组间人数差 ≤ 1，多出的名额随机落在哪些组，
   * 不会永远堆在前几组。返回长度 k+1 的 Uint32Array。
   */
  function computeOffsets(n, k, randBelow) {
    const base = Math.floor(n / k);
    const rem = n % k;
    const sizes = new Uint32Array(k).fill(base);

    const pick = new Uint32Array(k);
    for (let i = 0; i < k; i++) pick[i] = i;
    for (let i = k - 1; i > 0; i--) {
      const j = randBelow(i + 1);
      const t = pick[i]; pick[i] = pick[j]; pick[j] = t;
    }
    for (let i = 0; i < rem; i++) sizes[pick[i]] += 1;

    const offsets = new Uint32Array(k + 1);
    for (let g = 0; g < k; g++) offsets[g + 1] = offsets[g] + sizes[g];
    return offsets;
  }

  /** 变高虚拟滚动用：O(log n) 的高度前缀和与坐标定位 */
  class Fenwick {
    constructor(n) {
      this.n = n;
      this.t = new Int32Array(n + 1);
      this.mask = n > 0 ? 1 << (31 - Math.clz32(n)) : 0;
    }
    build(arr) {
      const { t, n } = this;
      for (let i = 1; i <= n; i++) t[i] = arr[i - 1];
      for (let i = 1; i <= n; i++) {
        const p = i + (i & -i);
        if (p <= n) t[p] += t[i];
      }
    }
    add(i, delta) {
      for (let x = i + 1; x <= this.n; x += x & -x) this.t[x] += delta;
    }
    /** [0, i) 的高度和 */
    prefix(i) {
      let s = 0;
      for (let x = i; x > 0; x -= x & -x) s += this.t[x];
      return s;
    }
    total() { return this.prefix(this.n); }
    /** 落在坐标 y 上的行下标 */
    findIndex(y) {
      let pos = 0, rest = y;
      for (let bit = this.mask; bit > 0; bit >>= 1) {
        const nxt = pos + bit;
        if (nxt <= this.n && this.t[nxt] <= rest) {
          pos = nxt;
          rest -= this.t[nxt];
        }
      }
      return pos;
    }
  }

  return { createRng, makeRandBelow, parseItems, shuffle, computeOffsets, Fenwick, CHUNK };
});
