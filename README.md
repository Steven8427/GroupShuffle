# 随机分组（Random Grouper）

把一份名单/文本按行随机、平均地分成若干组的 Windows 桌面应用。Electron + 原生 HTML/CSS/JS，**零运行时依赖**，为 10 万+ 行数据做过专门优化。

## 运行

```bash
npm install
```

```bash
npm start
```

## 打包

```bash
npm run dist
```

产物在 `dist/`：NSIS 安装包 + portable 免安装 exe（均为 x64）。首次打包需要下载 Electron 二进制，耗时较长。

## 功能

- 每行一条内容，纯空白行自动忽略，其余内容原样保留（不去空格、不去重）
- 分组数量：2 / 3 / 4 / 5 快捷按钮，或自定义 1~1000
- 组间人数差 **≤ 1**，且「多 1 人」的组是随机的，不会永远落在前几组
- 每组独立的「复制本组」「导出 TXT」，另有「全部导出到文件夹」一次性写出 `group-1.txt … group-N.txt`
- 「复制 / 导出时包含序号」开关（默认关闭，粘到微信/Teams 更干净）
- 「长内容自动换行」开关；关闭后长行单行截断，滚动最省资源
- 导入 TXT：点按钮选文件，或直接把 `.txt` 拖到输入区
- `Ctrl + Enter` 快速分组

导出文件为 **UTF-8 + BOM、CRLF 行尾**，记事本 / Excel 打开不乱码、不粘成一行。

### 只渲染看得见的那二十行

不管输入是 10 行还是 10 万行，界面上**永远只挂载可见的约 20 行**，其余靠滚动条按需渲染 —— 输入预览和每个分组卡片都是如此。10 万行分 5 组时，整个窗口的行节点数只有 100 个上下。列表内容不足 20 行时会自动收缩，不留空白。

### 大内容会自动折叠

超过 5000 行时，输入内容不进 `<textarea>`，而是收进一块**可滚动的只读预览**（顶部显示「已载入 N 行」，正文存在内存里，分组照常）。点「编辑内容」可以放回文本框编辑。

这不是偷懒，是这个应用最大的性能坑：一个装了 10 万行的原生文本控件内部高达 200 万像素，**光是排版它就要 2.6 秒**，而且虚拟列表每次撑高都会连带把它重排一遍。实测对比：

| 场景 | 折叠前 | 折叠后 |
|---|---|---|
| 粘贴 10 万行后的首次布局 | 2615 ms | **4 ms** |
| 点「开始随机分组」到出结果 | 3677 ms | **46 ms** |
| 结果列表滚动一帧 | 600~1100 ms | **≤ 5 ms** |

## 性能设计

| 瓶颈 | 处理方式 |
|---|---|
| 字符串复制 | 原始行只存一份；打乱和分组全程操作 `Uint32Array` 下标，10 万行额外内存仅 400 KB |
| 主线程长任务 | 解析与洗牌按 5 万/批分片，批间让出事件循环并刷新进度条 |
| 让出事件循环 | 用 MessageChannel 而不是 `setTimeout(0)`——后者嵌套后被钳到 4ms，窗口最小化时更会被节流到 1 秒一次 |
| 随机性 | `crypto` 播种的 xoshiro128\*\* + 拒绝采样，无取模偏差；原地 Fisher–Yates |
| 分组均衡 | `base = ⌊n/k⌋`、余数随机分配，前缀和存进 `offsets`，不生成 k 个数组 |
| DOM 爆炸 | 输入预览和每个分组各一个虚拟列表，只挂载可视区约 20 行，节点池复用；组数多时卡片按需懒挂载，挂载前按行数预留高度避免塌陷 |
| 换行导致行高不定 | `Uint16Array` 存高度 + Fenwick 树维护前缀和，O(log n) 定位；估算高度按实测校正并补偿 scrollTop |
| 撑高元素频繁重排 | 总高度的小幅漂移攒够 400px 或滚到接近末尾才写回 DOM |

实测（10 万行、分 5 组）：解析 26 ms、洗牌 9 ms、分组 <1 ms，端到端 46 ms。

## 造测试数据

在 PowerShell 里生成 10 万行长文本，然后用「导入 TXT」载入：

```bash
node -e "const a=[];for(let i=0;i<100000;i++)a.push('residential.wealthproxies.com:3128:user'+i+':7u1aHTqmZBWjBArn-S'+Math.random().toString(16).slice(2)+'-walmart-US');require('fs').writeFileSync('sample-100k.txt',a.join('\r\n'),'utf8')"
```

## 结构

```
main.js              主进程：窗口、原生对话框、fs 读写
preload.js           contextBridge 白名单（openTxt / saveTxt / saveAll / reveal）
renderer/index.html  界面结构
renderer/styles.css  样式（自动跟随系统深浅色）
renderer/core.js     与 DOM 无关的核心算法（随机数 / 解析 / 洗牌 / 分组 / Fenwick）
renderer/app.js      界面交互与虚拟滚动
```

`core.js` 不依赖任何 DOM，可以直接在 Node 里 `require` 出来测：

```bash
node -e "require('./renderer/core.js').parseItems('a\nb\n\nc').then(r=>console.log(r))"
```

排查渲染进程报错时，用 `RG_DEBUG=1` 启动，控制台输出会转发到终端。

渲染进程 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，不直接接触文件系统；所有读写都经由 preload 暴露的四个方法走主进程。
