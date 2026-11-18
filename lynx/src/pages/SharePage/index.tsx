import { useEffect, useState } from '@lynx-js/react';

import { photoSrc } from '../../photo.js';
import { makeCls } from '../../styles/cls.js';
import { fetchShare } from '../../sync.js';
import type { GuideShareSnapshot } from '../../data.js';
import styles from './index.module.scss';

const cls = makeCls(styles);

type Props = {
  /** 服务端外壳注入的分享 token；空串表示不是从分享链接进来的 */
  token: string;
  /** 底部「去看看这个 App」 */
  onOpenApp: () => void;
};

/**
 * 公开分享页（F08 后半）。
 *
 * 访客没有账号，所以这一页**不做任何登录判断**：拿 token 直接拉内容，拉不到就显示引导。
 *
 * 为什么正文在客户端拉而不在服务端渲染：Lynx 官方没有 SSR（用 IFR + initData 替代），
 * 服务端只负责在 HTML 外壳里拼 og 标签给抓取器看；正文一律由 web bundle 渲染。
 * 代价是首屏多一次往返，换来的是 App 内页面与分享页共用同一套组件与样式。
 *
 * 到访状态如实呈现：`unknown` 显示为「计划过」，不能因为读者看不出差别就当成去过。
 */
export function SharePage({ token, onOpenApp }: Props) {
  const [snapshot, setSnapshot] = useState<GuideShareSnapshot | null>(null);
  const [authorLabel, setAuthorLabel] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetchShare(token);
      if (!alive) return;
      if (!res?.snapshot) {
        setState('gone');
        return;
      }
      setSnapshot(res.snapshot);
      setAuthorLabel(res.authorLabel);
      setState('ready');
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <view className={cls('sp-page')}>
        <view className={cls('sp-state')}>
          <text className={cls('sp-state-text')}>正在打开这份攻略…</text>
        </view>
      </view>
    );
  }

  // 撤回 / 不存在走同一个界面：两者对读者是同一件事，区分开反而泄露「这份曾经存在」
  if (state === 'gone' || !snapshot) {
    return (
      <view className={cls('sp-page')}>
        <view className={cls('sp-gone')}>
          <text className={cls('sp-gone-title')}>这份攻略已不再公开</text>
          <text className={cls('sp-gone-text')}>作者可能已经把它撤回了，或者链接抄漏了几个字符。</text>
          <view className={cls('sp-gone-btn')} bindtap={onOpenApp}>
            <text className={cls('sp-gone-btn-text')}>去看看趣哪玩儿</text>
          </view>
        </view>
      </view>
    );
  }

  const photos = snapshot.photos.filter((p) => p.kind === 'remote');

  return (
    <view className={cls('sp-page')}>
      <text className={cls('sp-title')}>{snapshot.title}</text>
      {snapshot.summary ? <text className={cls('sp-summary')}>{snapshot.summary}</text> : null}

      <view className={cls('sp-meta')}>
        {authorLabel ? <text className={cls('sp-meta-text')}>来自 {authorLabel} 的分享</text> : null}
        {snapshot.showCost && typeof snapshot.perPerson === 'number' ? (
          <text className={cls('sp-meta-text')}>人均 ¥{snapshot.perPerson}</text>
        ) : null}
      </view>

      {photos.length > 0 ? (
        <view className={cls('sp-photos')}>
          {photos.map((p) => (
            <image key={p.id} className={cls('sp-photo')} src={photoSrc(p)} mode="aspectFill" />
          ))}
        </view>
      ) : null}

      {snapshot.sections.map((section) => (
        <view key={`d-${section.dayIndex}`} className={cls('sp-day')}>
          <text className={cls('sp-day-title')}>第 {section.dayIndex} 天</text>
          {section.items.map((item) => (
            <view key={item.planRef} className={cls('sp-item')}>
              <view className={cls('sp-item-head')}>
                <text className={cls('sp-item-title')}>{item.placeTitle}</text>
                {item.visited === 'yes' ? (
                  <text className={cls('sp-tag sp-tag-yes')}>去过</text>
                ) : item.visited === 'no' ? (
                  <text className={cls('sp-tag sp-tag-no')}>没去成</text>
                ) : (
                  <text className={cls('sp-tag sp-tag-plan')}>计划过</text>
                )}
              </view>
              {item.text ? <text className={cls('sp-item-text')}>{item.text}</text> : null}
            </view>
          ))}
        </view>
      ))}

      {snapshot.sections.length === 0 ? (
        <view className={cls('sp-empty')}>
          <text className={cls('sp-empty-text')}>作者这次没有公开具体的地点。</text>
        </view>
      ) : null}

      <view className={cls('sp-foot')}>
        <view className={cls('sp-foot-btn')} bindtap={onOpenApp}>
          <text className={cls('sp-foot-btn-text')}>我也去写一份</text>
        </view>
      </view>
    </view>
  );
}
