/**
 * 三方登录通道的展示规则（F06 客户端）。
 *
 * 与 useAuth 分开是因为这里全是纯函数：判断「显示哪些按钮」不依赖 React、
 * 也不依赖网络，单独成文件才能直接测 —— 而这条判断错一次就会骗用户：
 * 凭证明明没配却显示按钮，点下去才收到 501；配置了却因为过滤写错永远不显示，
 * 让人以为「产品不支持微信登录」。两种情况都不会报错。
 */

/** 服务端 /api/auth/status 下发的通道就绪状态 */
export type AuthProvider = {
  id: 'wechat' | 'onetap' | 'apple';
  label: string;
  /** false = 服务端没配凭证，界面不该显示这个按钮 */
  configured: boolean;
};

/**
 * 客户端认识的通道。
 *
 * 白名单而不是「来什么显示什么」：服务端将来加了新通道，客户端不认识它的
 * 兑换方式与回跳参数，渲染出来只会是一个点不出效果的按钮。
 */
const KNOWN_PROVIDERS = new Set(['wechat', 'onetap', 'apple']);

/** 该在登录页显示哪些三方按钮；顺序按服务端下发的顺序 */
export function visibleProviders(list: readonly AuthProvider[] | undefined): AuthProvider[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.filter((p) => {
    if (!p || typeof p.id !== 'string' || !KNOWN_PROVIDERS.has(p.id)) return false;
    // 服务端说没配就不显示：那是唯一权威来源
    if (p.configured !== true) return false;
    // 同一通道重复下发（服务端拼错时会出现）只显示一次
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}
