/**
 * 出发日期的候选列表（平面表单用）。
 *
 * Lynx 没有原生日期控件（见 PickerSheet 的注释），滚轮要自己算吸附，原生端表现未验证。
 * 旅行出发日只关心「最近的某一天」，列出一段日历点选比手敲日期可靠得多 ——
 * 用户也不用关心 `2026-12-05` 这种格式。
 *
 * 为什么从明天开始、而不是今天：今天已经过掉一部分，按今天排的行程经常从上午九点
 * 开始，用户下午打开时那半天已经没了，等于给了他一份排不出来的计划。
 */
import { weekdayOf } from '../../../../shared/engine/dayDate.js';

/** 可选天数：一个半月足够覆盖「下个假期 / 下个月再说」这类实际需求，又不至于把列表撑爆 */
export const DATE_WINDOW_DAYS = 45;

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** `YYYY-MM-DD` 加减天；全程按 UTC 算，跨时区不串日 */
export function addDays(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(base)) return iso;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 生成候选。[0] 是「还不确定」，值是空串 —— 允许未知是产品口径，
 * 不给这一项等于逼用户编一个日期出来。
 */
export function dateOptions(today: string, days = DATE_WINDOW_DAYS): { value: string; label: string; note?: string }[] {
  const out: { value: string; label: string; note?: string }[] = [
    { value: '', label: '还不确定', note: '先按天数排，日期之后再定' },
  ];
  for (let i = 1; i <= days; i += 1) {
    const value = addDays(today, i);
    const wd = weekdayOf(value);
    const [, mm, dd] = value.split('-');
    const label = `${Number(mm)}月${Number(dd)}日`;
    out.push({ value, label, ...(wd === null ? {} : { note: WEEKDAY_CN[wd] }) });
  }
  return out;
}
