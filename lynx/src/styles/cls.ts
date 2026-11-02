/**
 * CSS Modules 的类名映射。
 *
 * Lynx 的 className 只认字符串，而 CSS Modules 会把本模块的类哈希成 `xxx__yyy`，
 * 所以每次写 class 都要过一层查表；base.scss 里的共享原子类不在表里，原样透出。
 *
 * 用工厂而不是普通函数：`styles` 是每个文件各自 import 的模块对象，
 * 全局函数拿不到它，只能按文件绑定一次。
 */
export type ClassMap = Record<string, string>

export const makeCls =
  (map: ClassMap) =>
  (names: string): string =>
    names
      .split(' ')
      .filter(Boolean)
      .map((n) => map[n] ?? n)
      .join(' ')
