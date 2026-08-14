'use strict';

/**
 * 校验 renderer/i18n.js 里各门语言的完整性：
 *
 *   1. 缺键 —— 会静默回落到中文。界面上只是某一行突然变中文，肉眼极难发现。
 *   2. 多余键 —— 通常是改名后忘了同步，或者拼错。
 *   3. 占位符不匹配 —— 翻译里漏掉 {n} 之类，数字就永远显示不出来。
 *
 * 加完一门语言跑一下：
 *
 *   npm run check-i18n
 */

const i18n = require('../renderer/i18n.js');

const base = i18n.fallbackCode;
const baseStrings = i18n.stringsOf(base);
const baseKeys = Object.keys(baseStrings);

/** 取出 "{n}" 这类占位符，排序后便于比较 */
const placeholders = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');

let problems = 0;

console.log(`基准语言：${base}（${baseKeys.length} 个键）\n`);

for (const { code, name } of i18n.languages()) {
  if (code === base) continue;

  const strings = i18n.stringsOf(code);
  const keys = Object.keys(strings);
  const missing = baseKeys.filter((k) => !(k in strings));
  const extra = keys.filter((k) => !(k in baseStrings));
  const mismatched = baseKeys
    .filter((k) => k in strings && placeholders(baseStrings[k]) !== placeholders(strings[k]))
    .map((k) => `${k}：${base} 有 [${placeholders(baseStrings[k]) || '无'}]，${code} 有 [${placeholders(strings[k]) || '无'}]`);

  const bad = missing.length + extra.length + mismatched.length;
  problems += bad;

  if (bad === 0) {
    console.log(`✓ ${code}（${name}）${keys.length} 个键，与基准一致`);
    continue;
  }

  console.log(`✗ ${code}（${name}）${keys.length} 个键`);
  if (missing.length) console.log(`   缺 ${missing.length} 个键：${missing.join(', ')}`);
  if (extra.length) console.log(`   多 ${extra.length} 个键：${extra.join(', ')}`);
  if (mismatched.length) {
    console.log(`   占位符不匹配 ${mismatched.length} 处：`);
    for (const line of mismatched) console.log(`     ${line}`);
  }
}

console.log(problems === 0 ? '\n全部通过。' : `\n共 ${problems} 处问题。`);
process.exit(problems === 0 ? 0 : 1);
