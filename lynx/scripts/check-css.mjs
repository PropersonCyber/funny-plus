// Lyx 端 CSS 只做一件事：把 TSX 里用到的 class 和 App.css 里定义的 class 对一遍。
// 起因：批量替换 CSS 时按下标切片切反了方向，静默删掉 20 个类，页面全崩但构建 0 error。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const styleFiles = [];
const collectStyles = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectStyles(p);
    else if (p.endsWith('.css') || p.endsWith('.scss')) styleFiles.push(p);
  }
};
collectStyles(join(root, 'src'));

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
};

const css = styleFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const defined = new Set([...css.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]));

const used = new Set();
// 比较运算里的字符串（kind === 'meal'）不是 class，先收集起来排除，否则会误报
const NOT_CLASS = new Set();
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/[!=]==?\s*'([A-Za-z0-9_-]+)'/g)) NOT_CLASS.add(m[1]);
  for (const m of src.matchAll(/className="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  // 三目/map 里拼出来的 class 也扫一遍字符串字面量
  for (const m of src.matchAll(/className=\{([^}]+)\}/g)) {
    for (const q of m[1].matchAll(/'([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*)'/g)) {
      q[1].split(/\s+/).forEach((c) => c && used.add(c));
    }
  }
}

const missing = [...used].filter((c) => !defined.has(c) && !NOT_CLASS.has(c)).sort();
if (missing.length) {
  console.error(`✖ 样式文件里缺少 ${missing.length} 个被引用的 class：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
// 模块隔离检查：页面用到的类必须在自己的 module 或 base 里，不能落在别人的模块（那样会被哈希成别的名字，样式静默丢失）
const moduleOf = new Map(); // class -> Set(module)
for (const f of styleFiles) {
  const rel = f.slice(join(root, 'src').length + 1);
  const mod = rel.startsWith('pages/') ? rel.split('/')[1] : rel.startsWith('styles/') ? 'base' : 'app';
  for (const m of readFileSync(f, 'utf8').matchAll(/^\.([A-Za-z0-9_-]+)\s*[,{]/gm)) {
    if (!moduleOf.has(m[1])) moduleOf.set(m[1], new Set());
    moduleOf.get(m[1]).add(mod);
  }
}

const leaks = [];
for (const file of walk(join(root, 'src'))) {
  const rel = file.slice(join(root, 'src').length + 1);
  const mod = rel.startsWith('pages/') ? rel.split('/')[1] : rel.startsWith('App/') ? 'app' : null;
  if (!mod) continue;
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/cls\(\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => c && names.add(c));
  for (const n of names) {
    const owners = moduleOf.get(n);
    if (!owners) continue;
    if (!owners.has(mod) && !owners.has('base')) leaks.push(`${mod}: ${n} 只定义在 ${[...owners].join('/')}`);
  }
}

if (leaks.length) {
  console.error(`✖ ${leaks.length} 个 class 跨模块定义，页面会丢样式：\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}

// 组合选择器检查：base.scss 里的 `.a.on` 依赖两个都是全局类名。
// 一旦 a 在某个页面模块里也定义了一次，它会被哈希成 xxx__a，这条组合规则就再也匹配不上
// （表现：选中态文字颜色丢失，但构建、类型检查全绿）。
const pageOwned = new Map();
for (const [name, owners] of moduleOf) {
  for (const o of owners) if (o !== 'base' && o !== 'app') pageOwned.set(name, o);
}
const shadowed = [];
for (const f of styleFiles) {
  if (!f.endsWith(join('styles', 'base.scss'))) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(/^(\.[A-Za-z0-9_.-]+)\s*(?:,|\{)/gm)) {
    const parts = m[1].split('.').filter(Boolean);
    if (parts.length < 2) continue;
    for (const part of parts) {
      if (pageOwned.has(part)) shadowed.push(`.${parts.join('.')} 里的 ${part} 在 ${pageOwned.get(part)} 模块里重复定义`);
    }
  }
}
if (shadowed.length) {
  console.error(`✖ ${shadowed.length} 处组合选择器被模块类名遮蔽，选中态会失效：\n  ${shadowed.join('\n  ')}`);
  process.exit(1);
}

// 类名映射只能有一份：之前 11 个页面各写了一遍 cls，改规则要改 11 处
const inlined = [];
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  if (/const cls = \(names/.test(src)) inlined.push(file.slice(root.length + 1));
}
if (inlined.length) {
  console.error(`✖ 又有人把 cls 抄回页面里了，改用 makeCls：\n  ${inlined.join('\n  ')}`);
  process.exit(1);
}

// 图标名没有类型约束：写错一个名字，`icon()` 会返回空串，界面上只剩一个空白圆点，
// 构建和类型检查都不报错（行程详情右上角就踩过这个）。
const svgKeys = new Set([...readFileSync(join(root, 'src/icon-svg.ts'), 'utf8').matchAll(/^  ([A-Za-z]+): `</gm)].map((m) => m[1]));
const fillKeys = new Set([...readFileSync(join(root, 'src/icons-filled.ts'), 'utf8').matchAll(/^  ([A-Za-z]+):/gm)].map((m) => m[1]));
const unknownIcons = [];
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);
  for (const m of src.matchAll(/svgIcon\(\s*'([A-Za-z]+)'/g)) {
    if (!svgKeys.has(m[1])) unknownIcons.push(`${rel}: svgIcon('${m[1]}') 在 icon-svg.ts 里没有`);
  }
  for (const m of src.matchAll(/filledIcon\(\s*'([A-Za-z]+)'/g)) {
    if (!fillKeys.has(m[1])) unknownIcons.push(`${rel}: filledIcon('${m[1]}') 在 icons-filled.ts 里没有`);
  }
}
if (unknownIcons.length) {
  console.error(`✖ ${unknownIcons.length} 处图标名不存在，渲染出来是空白：\n  ${unknownIcons.join('\n  ')}`);
  process.exit(1);
}

console.log(`✔ CSS 与 TSX 对得上（${used.size} 个 class），模块无越界引用，cls 只有一份`);
