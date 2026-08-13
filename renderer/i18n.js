'use strict';

/**
 * 界面文案。浏览器里挂到 window.RGI18n，Node 里可 require 出来做完整性检查。
 * 取值缺失时回退到中文，不会露出裸 key。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const dict = {
    zh: {
      'app.subtitle': '把名单随机、平均分成若干组 · 支持 10 万+ 行',
      'lang.toggle': 'English',
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
    },
    en: {
      'app.subtitle': 'Split a list into random, evenly sized groups · handles 100k+ lines',
      'lang.toggle': '中文',
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
    },
  };

  const LOCALES = { zh: 'zh-CN', en: 'en-US' };
  let lang = 'zh';

  function setLang(next) {
    lang = dict[next] ? next : 'zh';
    return lang;
  }

  function t(key, vars) {
    let s = dict[lang][key];
    if (s === undefined) s = dict.zh[key];
    if (s === undefined) return key;
    if (vars) {
      for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    }
    return s;
  }

  /** 数字千分位跟着语言走 */
  const fmt = (n) => n.toLocaleString(LOCALES[lang]);

  return { t, fmt, setLang, getLang: () => lang, locale: () => LOCALES[lang], dict };
});
