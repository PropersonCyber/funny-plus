import { useState } from '@lynx-js/react';

import { IconSvg } from '../../IconSvg.js';
import { svgIcon } from '../../icons.js';
import { photoSrc } from '../../photo.js';
import { makeCls } from '../../styles/cls.js';
import type { Demand, GuideDraft, PhotoRef, Plan, TripMemory } from '../../data.js';
import styles from './index.module.scss';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  planIndex: number;
  draft: GuideDraft;
  /** 这趟旅行的回忆；封面照片只能从这里挑，不接受任意图 */
  memory: TripMemory;
  /** 整趟行程的人均费用；只在用户打开「公开费用」时才出现在预览里 */
  perPerson: number;
  onBack: () => void;
  onPatch: (next: Partial<GuideDraft>) => void;
  /** 翻转某个地点是否写进攻略 */
  onToggle: (planRef: string) => void;
  onRegenerate: () => void;
  /** 是否已登录；发布需要账号 */
  loggedIn: boolean;
  /** 当前有效的分享；null 表示还没发布或已撤回 */
  published: { token: string; url: string } | null;
  /** 还在发布中，用来禁用重复点击 */
  publishing: boolean;
  /** 草稿里还留在本机、发不出去的照片数 */
  dirtyPhotos: number;
  onPublish: () => void;
  onUnpublish: () => void;
  onCopyLink: () => void;
  onLogin: () => void;
};
/**
 * 攻略草稿：编辑 / 预览两态。
 *
 * 发布状态由外层 useGuides 管：这一页只负责展示与把点击转上去，不在这里发请求 ——
 * 页面卸载时请求还在飞，回来 setState 就落到已卸载的组件上。
 *
 * 勾选状态读 `draft.picked` 而不是「sections 里有没有」：
 * sections 是内容清单（含全部候选），picked 才是用户的取舍。
 * 早先把两者合一，结果没记过的地点也被当成已选中。
 */
export function GuideDraftPage({
  demand,
  plans,
  planIndex,
  draft,
  memory,
  perPerson,
  onBack,
  onPatch,
  onToggle,
  onRegenerate,
  loggedIn,
  published,
  publishing,
  dirtyPhotos,
  onPublish,
  onUnpublish,
  onCopyLink,
  onLogin,
}: Props) {
  const [preview, setPreview] = useState(false);
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];

  /** 全部候选地点（按天分组），来自方案本身 */
  const days = (plan?.days ?? [])
    .map((d) => ({
      dayIndex: d.index,
      items: d.items
        .filter((it) => it.kind !== 'meal' && !!it.placeId)
        .map((it) => ({ planRef: it.id, title: it.title })),
    }))
    .filter((d) => d.items.length > 0);

  const isPicked = (planRef: string) => draft.picked[planRef] === true;
  const pickedCount = Object.values(draft.picked).filter(Boolean).length;
  /** 回忆里能挑的封面照片（整趟 + 各地点），按出现顺序去重 */
  const memoryPhotos = (() => {
    const seen = new Set<string>();
    const all = [...memory.photos, ...Object.values(memory.places).flatMap((n) => n.photos)];
    return all.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  })();
  const inGuide = (photoId: string) => draft.photos.some((p) => p.id === photoId);
  /** 加/移一张封面照片；移出就是真的不进 photos，而不是渲染时藏起来 */
  const onTogglePhoto = (photo: PhotoRef) =>
    onPatch({ photos: inGuide(photo.id) ? draft.photos.filter((p) => p.id !== photo.id) : [...draft.photos, photo] });

  /** 预览用：只取勾上的条目，并保留回忆里的文字与照片 */
  const previewSections = draft.sections
    .map((s) => ({ dayIndex: s.dayIndex, items: s.items.filter((it) => isPicked(it.planRef)) }))
    .filter((s) => s.items.length > 0);

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('gp-page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <IconSvg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>{preview ? '攻略预览' : '整理攻略'}</text>
            <view className={cls('icon-btn')} bindtap={() => setPreview(!preview)}>
              <text className={cls('gp-toggle')}>{preview ? '编辑' : '预览'}</text>
            </view>
          </view>

          {!preview ? (
            <>
              <view className={cls('card')}>
                <text className={cls('card-title')}>标题</text>
                <input
                  className={cls('gp-input')}
                  default-value={draft.title}
                  placeholder="给这份攻略起个名字"
                  bindblur={(e: { detail?: { value?: string } }) => {
                    const v = e?.detail?.value;
                    if (typeof v === 'string' && v !== draft.title) onPatch({ title: v });
                  }}
                />
              </view>

              <view className={cls('card')}>
                <text className={cls('card-title')}>开头说两句</text>
                <text className={cls('card-note')}>默认取你写的旅行回顾，可以改；留空就不显示。</text>
                <textarea
                  className={cls('gp-textarea')}
                  default-value={draft.summary}
                  placeholder="这趟适合谁、什么节奏、有什么要提醒的。"
                  maxlength={600}
                  bindblur={(e: { detail?: { value?: string } }) => {
                    const v = e?.detail?.value;
                    if (typeof v === 'string' && v !== draft.summary) onPatch({ summary: v });
                  }}
                />
              </view>

              <view className={cls('card')}>
                <text className={cls('card-title')}>写进攻略的地点（{pickedCount}）</text>
                <text className={cls('card-note')}>
                  只有勾上的会出现在攻略里。默认勾上了你标记「去过」的。
                </text>
                {days.map((d) => (
                  <view key={d.dayIndex}>
                    {d.items.map((it) => {
                      const on = isPicked(it.planRef);
                      return (
                        <view key={it.planRef} className={cls('gp-row')} bindtap={() => onToggle(it.planRef)}>
                          <view className={cls(on ? 'gp-check gp-check-on' : 'gp-check')}>
                            {on ? <text className={cls('gp-check-text')}>✓</text> : null}
                          </view>
                          <text className={cls('gp-row-title')}>{it.title}</text>
                          <text className={cls('gp-row-day')}>Day {d.dayIndex}</text>
                        </view>
                      );
                    })}
                  </view>
                ))}
                {days.length === 0 ? (
                  <text className={cls('card-note')}>这套方案还没有地点，先去行程页加。</text>
                ) : null}
              </view>

              <view className={cls('card')}>
                <text className={cls('card-title')}>封面照片（{draft.photos.length}）</text>
                <text className={cls('card-note')}>
                  默认一张都不带。点一下加入或移出，发布前想清楚哪些愿意公开。
                </text>
                {memoryPhotos.length === 0 ? (
                  <text className={cls('card-note')}>这次旅行的回忆里还没有照片。</text>
                ) : (
                  <view className={cls('gp-photo-row')}>
                    {memoryPhotos.map((p) => {
                      const on = inGuide(p.id);
                      return (
                        <view key={p.id} className={cls('gp-check-wrap')} bindtap={() => onTogglePhoto(p)}>
                          <image className={cls('gp-photo')} src={photoSrc(p)} mode="aspectFill" />
                          <view className={cls(on ? 'gp-check gp-check-on' : 'gp-check')}>
                            {on ? <text className={cls('gp-check-text')}>✓</text> : null}
                          </view>
                        </view>
                      );
                    })}
                  </view>
                )}
              </view>

              <view className={cls('card')}>
                <view className={cls('gp-row')} bindtap={() => onPatch({ showCost: !draft.showCost })}>
                  <view className={cls(draft.showCost ? 'gp-check gp-check-on' : 'gp-check')}>
                    {draft.showCost ? <text className={cls('gp-check-text')}>✓</text> : null}
                  </view>
                  <text className={cls('gp-row-title')}>公开人均费用</text>
                  <text className={cls('gp-row-day')}>默认不公开</text>
                </view>
                <text className={cls('card-note')}>
                  同行人数、精确位置、私人备注不会出现在攻略里。
                </text>
              </view>

              <view className={cls('gp-ghost')} bindtap={onRegenerate}>
                <text className={cls('gp-ghost-text')}>按当前回忆重新生成</text>
              </view>
              <view className={cls('gp-hint')}>
                <text className={cls('gp-hint-text')}>
                  发布后会生成一个公开链接，撤回即刻失效。草稿本身只存在本机。
                </text>
              </view>
            </>
          ) : (
            <>
              {/* 预览：只读，模拟读者看到的样子 */}
              <view className={cls('gp-hero')}>
                <text className={cls('gp-hero-title')}>{draft.title || `${demand.destination} 行程`}</text>
                <text className={cls('gp-hero-sub')}>
                  {demand.destination} · {demand.dayCount} 天
                  {draft.showCost ? ` · 人均 ¥${perPerson}` : ''}
                </text>
              </view>

              {draft.photos.length ? (
                <view className={cls('gp-photo-row')}>
                  {draft.photos.map((p) => (
                    <image key={p.id} className={cls('gp-photo')} src={photoSrc(p)} mode="aspectFill" />
                  ))}
                </view>
              ) : null}

              {draft.summary ? (
                <view className={cls('card')}>
                  <text className={cls('gp-summary')}>{draft.summary}</text>
                </view>
              ) : null}

              {previewSections.map((s) => (
                <view key={s.dayIndex} className={cls('card')}>
                  <text className={cls('card-title')}>Day {s.dayIndex}</text>
                  {s.items.map((it) => (
                    <view key={it.planRef} className={cls('gp-item')}>
                      <view className={cls('gp-item-head')}>
                        <text className={cls('gp-item-title')}>{it.placeTitle}</text>
                        {/* 亲历与计划过的必须分开标注，否则读者会以为作者全都去过 */}
                        <text className={cls(it.visited === 'yes' ? 'gp-badge' : 'gp-badge gp-badge-ghost')}>
                          {it.visited === 'yes' ? '亲历' : '计划过'}
                        </text>
                      </view>
                      {it.text ? <text className={cls('gp-item-text')}>{it.text}</text> : null}
                      {it.photos.length ? (
                        <view className={cls('gp-photo-row')}>
                          {it.photos.map((p) => (
                            <image key={p.id} className={cls('gp-photo')} src={photoSrc(p)} mode="aspectFill" />
                          ))}
                        </view>
                      ) : null}
                    </view>
                  ))}
                </view>
              ))}

              {previewSections.length === 0 ? (
                <view className={cls('card')}>
                  <text className={cls('card-note')}>还没勾任何地点，回到编辑状态选几个。</text>
                </view>
              ) : null}

              {/* 发布区：登录后才出现真正的发布按钮，未登录如实说明并给登录入口 */}
              <view className={cls('card')}>
                {!loggedIn ? (
                  <>
                    <text className={cls('card-title')}>发布成链接</text>
                    <text className={cls('card-note')}>发布需要登录，这样别人打开链接时才知道是谁分享的。</text>
                    <view className={cls('gp-primary')} bindtap={onLogin}>
                      <text className={cls('gp-primary-text')}>去登录</text>
                    </view>
                  </>
                ) : published ? (
                  <>
                    <text className={cls('card-title')}>已发布</text>
                    {/* 链接要能被选中抄下来：壳层没有剪贴板能力时这是唯一的兜底 */}
                    <text className={cls('gp-link')}>{published.url}</text>
                    <view className={cls('gp-btn-row')}>
                      <view className={cls('gp-ghost')} bindtap={onCopyLink}>
                        <text className={cls('gp-ghost-text')}>复制链接</text>
                      </view>
                      <view className={cls('gp-ghost')} bindtap={onUnpublish}>
                        <text className={cls('gp-ghost-text')}>撤回</text>
                      </view>
                    </view>
                    {/* 改了草稿要能把改动推到同一条链接上；没有这个入口，用户只能撤回重发，
                        而撤回会让已经发出去的链接作废 */}
                    <view className={cls('gp-primary')} bindtap={onPublish}>
                      <text className={cls('gp-primary-text')}>
                        {publishing ? '正在更新…' : '更新已发布内容'}
                      </text>
                    </view>
                  </>
                ) : (
                  <>
                    <text className={cls('card-title')}>发布成链接</text>
                    {dirtyPhotos ? (
                      <text className={cls('card-note')}>
                        有 {dirtyPhotos} 张照片还只存在本机，发布后会看不到。想带上就先去回忆页重新添加。
                      </text>
                    ) : null}
                    <view className={cls('gp-primary')} bindtap={onPublish}>
                      <text className={cls('gp-primary-text')}>{publishing ? '正在发布…' : '发布'}</text>
                    </view>
                  </>
                )}
                <text className={cls('card-note')}>发出去的是一份快照；改完草稿点「更新已发布内容」，同一个链接就会换成新内容。</text>
              </view>
              <view className={cls('gp-hint')}>
                <text className={cls('gp-hint-text')}>以上是读者会看到的内容。</text>
              </view>
            </>
          )}
        </view>
      </scroll-view>
    </view>
  );
}
