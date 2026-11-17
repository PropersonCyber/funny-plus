import { useState } from '@lynx-js/react';

import { IconSvg } from '../../IconSvg.js';
import { svgIcon } from '../../icons.js';
import { photoSrc } from '../../photo.js';
import { makeCls } from '../../styles/cls.js';
import type { Demand, GuideDraft, Plan } from '../../data.js';
import styles from './index.module.scss';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  plans: Plan[];
  planIndex: number;
  draft: GuideDraft;
  /** 整趟行程的人均费用；只在用户打开「公开费用」时才出现在预览里 */
  perPerson: number;
  onBack: () => void;
  onPatch: (next: Partial<GuideDraft>) => void;
  /** 翻转某个地点是否写进攻略 */
  onToggle: (planRef: string) => void;
  onRegenerate: () => void;
};

/**
 * 攻略草稿：编辑 / 预览两态。
 *
 * 这一期只做本机草稿。「发布成链接」需要账号与服务端，界面上如实说明，
 * 不做成一个点了没反应的按钮。
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
  perPerson,
  onBack,
  onPatch,
  onToggle,
  onRegenerate,
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
                  发布成可分享的链接还需要账号与云端存储，这一期先只存本机。
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
