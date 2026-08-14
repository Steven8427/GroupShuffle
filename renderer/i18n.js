'use strict';

/**
 * 全应用唯一的文案表：渲染进程用 <script> 加载，主进程直接 require。
 *
 * 加一门语言只要在 LANGS 里追加一条：
 *
 *   { code: 'ja', name: '日本語', locale: 'ja-JP', strings: { ... } }
 *
 * 语言菜单、系统语言检测、数字千分位都会自动带上它，其他文件一行都不用改。
 * strings 里缺的键回落到 FALLBACK 语言，界面不会露出裸 key —— 也就是说
 * 新语言可以先翻一半就合入，没翻的部分显示中文而不是崩掉。
 *
 * 命名约定：`main.*` 归主进程（原生对话框、托盘菜单），其余归界面。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 缺翻译时回落到哪门语言 */
  const FALLBACK = 'zh';

  const LANGS = [
    {
      code: 'zh',
      name: '中文', // 菜单里一律用母语名，不随界面语言变
      locale: 'zh-CN',
      strings: {
        'lang.label': '切换语言',

        'section.input': '输入内容',
        'section.groups': '分组数量',
        'section.results': '分组结果',

        'stat.lines': '{n} 行',
        'btn.import': '导入 TXT',
        'input.placeholder': '每行一个内容，例如：\nJason\nSteven\nMike\n\n也可以直接把 .txt 文件拖到这里',
        'drop.hint': '松开即可导入',
        'collapsed.loaded': '已载入 {n} 行',
        'collapsed.hint': '只渲染可见的十几行，下面可以直接滚动查看',
        'btn.expand': '编辑内容',

        'seg.groups': '{n} 组',
        'custom.label': '自定义',
        'custom.unit': '组',
        'btn.run': '开始随机分组',
        'btn.running': '分组中…',
        'btn.clear': '清空',
        'opt.index': '复制 / 导出时包含序号',
        'opt.wrap': '长内容自动换行',
        'hint.shortcut': 'Ctrl + Enter 快速分组',

        'btn.exportAll': '全部导出到文件夹',
        'stat.result': '共 {n} 项 · {k} 组 · 每组 {size} 项 · 用时 {ms} ms',
        'card.title': '第 {n} 组',
        'card.count': '{n} 项',
        'card.empty': '（空组，项目数少于分组数）',
        'btn.copy': '复制本组',
        'btn.export': '导出 TXT',

        'toast.noContent': '没有可分组的内容',
        'toast.copied': '已复制 ✓',
        'toast.copyFail': '复制失败，请重试',
        'toast.exported': '已导出 ✓',
        'toast.saved': '已保存 {path}',
        'toast.openLocation': '打开位置',
        'toast.openFolder': '打开文件夹',
        'toast.exportFail': '导出失败：{err}',
        'toast.exportedAll': '已导出 {n} 个文件到 {dir}',
        'toast.imported': '已导入 {n} 行',
        'toast.emptyGroups': '只有 {n} 项，有 {k} 个组为空',
        'toast.expanding': '正在展开 {n} 行，可能需要几秒…',

        'main.openTitle': '选择要分组的文本文件',
        'main.filterText': '文本文件',
        'main.filterAll': '所有文件',
        'main.tooLarge': '文件过大（{mb} MB），请拆分后再导入',
        'main.saveTitle': '导出为 TXT',
        'main.dirTitle': '选择导出目录',
        'main.dirButton': '导出到此文件夹',
        'main.overwrite': '覆盖',
        'main.cancel': '取消',
        'main.overwriteMsg': '该文件夹已有 {n} 个 group-*.txt 文件',
        'main.overwriteDetail': '继续将覆盖同名文件。',
        'main.trayShow': '显示主窗口',
        'main.trayQuit': '退出',
        'main.closeTitle': '退出 GroupShuffle',
        'main.closeMsg': '确定要退出吗？',
        'main.closeDetail': '当前的分组结果不会被保存。想留在后台可以点最小化。',
        'main.closeConfirm': '退出',
      },
    },
    {
      code: 'en',
      name: 'English',
      locale: 'en-US',
      strings: {
        'lang.label': 'Change language',

        'section.input': 'Input',
        'section.groups': 'Number of groups',
        'section.results': 'Results',

        'stat.lines': '{n} lines',
        'btn.import': 'Import TXT',
        'input.placeholder': 'One item per line, e.g.\nJason\nSteven\nMike\n\nYou can also drop a .txt file here',
        'drop.hint': 'Drop to import',
        'collapsed.loaded': '{n} lines loaded',
        'collapsed.hint': 'Only the visible rows are rendered — scroll below to browse',
        'btn.expand': 'Edit',

        'seg.groups': '{n} groups',
        'custom.label': 'Custom',
        'custom.unit': 'groups',
        'btn.run': 'Shuffle & split',
        'btn.running': 'Working…',
        'btn.clear': 'Clear',
        'opt.index': 'Include numbering when copying / exporting',
        'opt.wrap': 'Wrap long lines',
        'hint.shortcut': 'Ctrl + Enter to shuffle',

        'btn.exportAll': 'Export all to folder',
        'stat.result': '{n} items · {k} groups · {size} per group · {ms} ms',
        'card.title': 'Group {n}',
        'card.count': '{n} items',
        'card.empty': '(empty — fewer items than groups)',
        'btn.copy': 'Copy group',
        'btn.export': 'Export TXT',

        'toast.noContent': 'Nothing to group',
        'toast.copied': 'Copied ✓',
        'toast.copyFail': 'Copy failed, please try again',
        'toast.exported': 'Exported ✓',
        'toast.saved': 'Saved to {path}',
        'toast.openLocation': 'Open location',
        'toast.openFolder': 'Open folder',
        'toast.exportFail': 'Export failed: {err}',
        'toast.exportedAll': 'Exported {n} files to {dir}',
        'toast.imported': 'Imported {n} lines',
        'toast.emptyGroups': 'Only {n} items — {k} groups are empty',
        'toast.expanding': 'Expanding {n} lines, this may take a few seconds…',

        'main.openTitle': 'Choose a text file to split',
        'main.filterText': 'Text files',
        'main.filterAll': 'All files',
        'main.tooLarge': 'File is too large ({mb} MB) — please split it first',
        'main.saveTitle': 'Export as TXT',
        'main.dirTitle': 'Choose export folder',
        'main.dirButton': 'Export to this folder',
        'main.overwrite': 'Overwrite',
        'main.cancel': 'Cancel',
        'main.overwriteMsg': 'This folder already contains {n} group-*.txt files',
        'main.overwriteDetail': 'Continuing will overwrite files with the same name.',
        'main.trayShow': 'Show window',
        'main.trayQuit': 'Quit',
        'main.closeTitle': 'Quit GroupShuffle',
        'main.closeMsg': 'Quit GroupShuffle?',
        'main.closeDetail': 'The current grouping will not be saved. Minimize instead to keep it running.',
        'main.closeConfirm': 'Quit',
      },
    },
  ];

  const byCode = new Map(LANGS.map((l) => [l.code, l]));
  const fallback = byCode.get(FALLBACK);
  let current = fallback;

  function setLang(code) {
    current = byCode.get(code) || fallback;
    return current.code;
  }

  function t(key, vars) {
    let s = current.strings[key];
    if (s === undefined) s = fallback.strings[key];
    if (s === undefined) return key;
    if (vars) {
      for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    }
    return s;
  }

  /** 数字千分位跟着当前语言走 */
  const fmt = (n) => n.toLocaleString(current.locale);

  /**
   * 从系统语言里挑一门支持的（navigator.languages 或单个 BCP-47 标签）。
   * 只比主子标签，zh-CN / zh-TW / zh-Hans-CN 都算 zh。
   */
  function detect(preferred) {
    const tags = Array.isArray(preferred) ? preferred : [preferred];
    for (const tag of tags) {
      if (!tag) continue;
      const primary = String(tag).toLowerCase().split('-')[0];
      if (byCode.has(primary)) return primary;
    }
    return FALLBACK;
  }

  /** 给语言菜单用的清单，顺序即 LANGS 的书写顺序 */
  const languages = () => LANGS.map((l) => ({ code: l.code, name: l.name }));

  return {
    t,
    fmt,
    setLang,
    detect,
    languages,
    getLang: () => current.code,
    getName: () => current.name,
    locale: () => current.locale,
    has: (code) => byCode.has(code),
    // 下面两个只给 scripts/check-i18n.js 用
    fallbackCode: FALLBACK,
    stringsOf: (code) => Object.assign({}, (byCode.get(code) || fallback).strings),
  };
});
