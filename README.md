<p align="center">
  <img src="assets/icon.png" width="128" alt="GroupShuffle">
</p>

# GroupShuffle

<p align="center"><a href="README.en.md">English</a> · <b>简体中文</b></p>

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

产物在 `dist/`（均为 x64）：

| 文件 | 说明 |
|---|---|
| `GroupShuffle-Setup.exe` | 安装程序，约 92 MB |
| `GroupShuffle-1.2.2-portable.exe` | 免安装版，单文件双击直接跑 |

安装流程就是普通 Windows 软件那一套：双击 → 安装向导 → 可以改安装目录（默认 `C:\Program Files\GroupShuffle`）→ 自动创建桌面和开始菜单快捷方式 → 装完可勾选立即运行。**目标机器不需要 Node.js 或任何开发环境**，Electron 运行时已经打包在内。

装到 `Program Files` 是全机器安装，会弹一次 UAC 提权。想改成免提权的当前用户安装（装到 `%LOCALAPPDATA%\Programs`），把 `package.json` 里 `nsis.perMachine` 改成 `false` 即可。

安装程序、卸载程序、桌面快捷方式、开始菜单用的都是 `assets/icon.ico`。改了 `assets/icon.png` 之后重新生成一次：

```bash
npm run icon
```

> `LICENSE` 必须保留 UTF-8 BOM。NSIS 读没有 BOM 的文本会按系统 ANSI 代码页解析，安装向导的许可协议页就会显示成乱码。

首次打包需要下载 Electron 二进制和 NSIS 资源，耗时较长；之后走缓存，一分钟内。

> 没有做代码签名，所以 Windows SmartScreen 首次运行会拦一下（「更多信息 → 仍要运行」）。要去掉这个提示需要买代码签名证书，把 `CSC_LINK` / `CSC_KEY_PASSWORD` 交给 electron-builder 即可。

## 功能

- 每行一条内容，纯空白行自动忽略，其余内容原样保留（不去空格、不去重）
- 分组数量：2 / 3 / 4 / 5 快捷按钮，或自定义 1~1000
- 组间人数差 **≤ 1**，且「多 1 人」的组是随机的，不会永远落在前几组
- 每组独立的「复制本组」「导出 TXT」，另有「全部导出到文件夹」一次性写出 `group-1.txt … group-N.txt`
- 「复制 / 导出时包含序号」开关（默认关闭，粘到微信/Teams 更干净）
- 「长内容自动换行」开关；关闭后长行单行截断，滚动最省资源
- 导入 TXT：点按钮选文件，或直接把 `.txt` 拖到输入区
- `Ctrl + Enter` 快速分组
- **多语言切换**：右上角 🌐 图标点开菜单，语言一律用母语名列出（中文 / English）。选择记在 localStorage，首次按系统语言判断；原生对话框和托盘菜单跟着一起切
- **最小化收进系统托盘**（右下角通知区域），不占任务栏；点托盘图标恢复，右键可「显示主窗口 / 退出」
- **关闭窗口有二次确认**，误触不会丢掉分组结果；托盘「退出」和系统关机是明确意图，不重复问
- 滚动条跟随深浅色主题，不再是默认那条扎眼的亮白条

导出文件为 **UTF-8 + BOM、CRLF 行尾**，记事本 / Excel 打开不乱码、不粘成一行。

### 只渲染看得见的那二十行

不管输入是 10 行还是 10 万行，界面上**永远只挂载可见的约 20 行**，其余靠滚动条按需渲染 —— 输入预览和每个分组卡片都是如此。10 万行分 5 组时，整个窗口的行节点数只有 100 个上下。列表内容不足 20 行时会自动收缩，不留空白。

### 大内容永远不进文本框

超过 5000 行时，输入内容不进 `<textarea>`，而是收进一块**可滚动的只读预览**（顶部显示「已载入 N 行」，正文存在内存里，分组照常）。折叠状态下**可以继续粘贴，内容会追加**，不必先展开。5 万行以内可以点「编辑内容」放回文本框改。

这是这个应用最大的性能坑：原生文本控件的排版是同步的，没法分片让出，而且排完之后那个几千万像素高的布局会一直拖累窗口拖动和滚动。

判断标准是「粘完之后有多大」而不是「怎么粘的」。早期版本只拦整体替换，在末尾追加的粘贴会溜过去 —— 于是每次粘 10 万行、一次一次往上加的用法就会踩雷。实测每次粘贴的界面冻结时间：

| 累计行数 | 修复前 | 修复后 |
|---:|---:|---:|
| 10 万 | 961 ms | **29 ms** |
| 50 万 | 5620 ms | **69 ms** |
| 100 万 | 10152 ms | **141 ms** |
| **10 轮累计** | **约 53 秒** | **0.8 秒** |

顺带的收益：滚动 P95 从 22.8 ms 降到 8.2 ms（稳定在一帧预算内），内存从 415 MB 降到 273 MB，点「编辑内容」从冻结 15.7 秒变成 155 ms 的提示。

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
| 输入行的存储 | 只记每行在原文里的起始下标（`Uint32Array`），取行时按需 slice。100 万行索引占 4MB，切成字符串要 120MB |
| 追加内容 | 只扫新粘进来的那一块，不重扫全量（100 万行时全量重扫一次要 2.1 秒） |
| 追加后的行高估算 | 只算新增那一段，已有行的高度原样保留。300 万行时全量重估要 355ms，占单次粘贴耗时的八成 |
| 分组时的字符串切分 | 不切。`selectNonBlank` 只扫字符码挑出非空白行的行号，要文本时才回原文 slice。300 万行分组 519ms → 217ms |
| 启动可感速度 | 窗口不等渲染进程画完第一帧就显示（带主题底色）。Electron 的运行时启动开销压不下去，但窗口出现能从 710ms 提前到 496ms |
| 浏览器的高度上限 | Chromium 把元素高度钳在 33,554,428px，超过就静默截断、尾部滚不到。总高超限时改走等比坐标映射，牺牲滚动精度换取能滚到底 |

实测（10 万行、分 5 组）：解析 26 ms、洗牌 9 ms、分组 <1 ms，端到端 46 ms。

## 造测试数据

在 PowerShell 里生成 10 万行长文本，然后用「导入 TXT」载入：

```bash
node -e "const a=[];for(let i=0;i<100000;i++)a.push('proxy-pool.example.com:3128:user'+i+':password-placeholder-'+Math.random().toString(16).slice(2)+'-region-US');require('fs').writeFileSync('sample-100k.txt',a.join('\r\n'),'utf8')"
```

## 结构

```
main.js                主进程：窗口、原生对话框、fs 读写
preload.js             contextBridge 白名单（setLang / openTxt / saveTxt / saveAll / reveal）
renderer/index.html    界面结构（文案挂 data-i18n，不写死）
renderer/styles.css    样式（自动跟随系统深浅色）
renderer/core.js       与 DOM 无关的核心算法（随机数 / 选行 / 洗牌 / 分组 / Fenwick）
renderer/i18n.js       语言注册表 + 全部文案，主进程和渲染进程共用同一份
renderer/app.js        界面交互与虚拟滚动
scripts/make-icon.ps1  由 icon.png 生成多尺寸 icon.ico
scripts/check-i18n.js  校验各语言的键与占位符是否对齐
```

## 添加一门语言

改动集中在 `renderer/i18n.js` 的 `LANGS` 数组，追加一条就够：

```js
{ code: 'ja', name: '日本語', locale: 'ja-JP', strings: { /* 照抄 zh 的键逐条翻译 */ } }
```

语言菜单、系统语言检测、数字千分位都会自动带上它，**其他文件一行都不用改**。几个设计上的取舍：

- 菜单里一律用**母语名**（日本語 而不是「日语」），这样用户在任何界面语言下都能找到自己那门
- 系统语言只比 BCP-47 的主子标签，`ja-JP` 命中 `ja`，`zh-TW` / `zh-Hans-CN` 都命中 `zh`
- `strings` 缺的键回落到中文而不是露出裸 key，所以新语言可以先翻一半就合入
- `main.*` 前缀的键归主进程（原生对话框、托盘菜单），主进程 `require` 的是同一份表，不存在两份字典对不上的问题

翻完跑一下完整性校验 —— 缺键只会让界面上某一行悄悄变回中文，肉眼很难发现：

```bash
npm run check-i18n
```

它会报出缺键、多余键，以及占位符对不上的条目（比如翻译里漏掉 `{n}`，数字就永远显示不出来）。

`core.js` 不依赖任何 DOM，可以直接在 Node 里 `require` 出来测：

```bash
node -e "require('./renderer/core.js').parseItems('a\nb\n\nc').then(r=>console.log(r))"
```

排查渲染进程报错时，用 `RG_DEBUG=1` 启动，控制台输出会转发到终端。

渲染进程 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，不直接接触文件系统；所有读写都经由 preload 暴露的五个方法走主进程。

## 许可

**专有软件，保留所有权利。** 未经著作权人事先书面许可，不得使用、复制、修改或分发。

源代码在这里可以浏览，但可浏览不等于获得授权。需要使用请先联系取得许可，完整条款见 [LICENSE](LICENSE)。
