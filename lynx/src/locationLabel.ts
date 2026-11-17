/**
 * 高德有时回「成都」，有时回「成都市」。
 * 展示一律收成带「市」的那一版，香港、澳门和已经带行政区后缀的名字不再加。
 * 单独放在这里，是为了单测不必把定位请求链一起拉进来。
 */
export function locationLabel(raw: string): string {
  const name = raw.trim();
  if (!name) return '';
  if (/(市|州|盟|县|区|旗)$/.test(name) || name === '香港' || name === '澳门') return name;
  return `${name}市`;
}

/** 点选时对城市索引：只去掉末尾的「市」，「成都市」才能点中「成都」 */
export function cityKey(raw: string): string {
  return raw.trim().replace(/市$/, '');
}
