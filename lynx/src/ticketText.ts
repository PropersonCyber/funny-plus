/**
 * 票价展示的唯一口径。
 *
 * null 是「未核实」，不是免费 —— 把未知渲染成「免费」或「¥0」等于对用户撒谎，
 * 而这个产品的差异化就是「不冒充已核验」。所以只留这一个出口，别在各页面各写一套三元表达式。
 */
export function ticketText(ticket: number | null | undefined): string {
  if (ticket === null || ticket === undefined) return '暂无票价';
  return ticket > 0 ? `¥${ticket}` : '免费';
}

/** 预算/汇总里求和用：未核实的票价按 0 计入，由调用方另行提示「N 个景点未核实」 */
export const ticketAmount = (ticket: number | null | undefined): number => ticket ?? 0;
