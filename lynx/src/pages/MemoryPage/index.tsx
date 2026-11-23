import { useState } from '@lynx-js/react';

import { IconSvg } from '../../IconSvg.js';
import { svgIcon } from '../../icons.js';
import { canPickPhoto, photoSrc, pickPhoto, uploadPhoto } from '../../photo.js';
import { track } from '../../track.js';
import { toast } from '../../toast.js';
import { makeCls } from '../../styles/cls.js';
import type { Demand, PhotoRef, PlaceNote, Plan, TripMemory } from '../../data.js';
import styles from './index.module.scss';

const cls = makeCls(styles);

type Props = {
  demand: Demand;
  /** 用户选中的那套方案；回忆按它的安排逐条记录 */
  plans: Plan[];
  planIndex: number;
  /** 行程已结束的时刻；为空表示还在进行中 */
  endedAt?: string;
  memory: TripMemory;
  onBack: () => void;
  onSaveOverview: (text: string) => void;
  onPhotos: (photos: PhotoRef[]) => void;
  /** 把结束旅行时整理的草稿采纳为整趟回顾 */
  onAdoptDraft: () => void;
  /** 丢掉草稿，回顾不动 */
  onDiscardDraft: () => void;
  onSavePlace: (
    patch: { planRef: string; dayIndex: number; placeId: string; placeTitle: string } & Partial<PlaceNote>
  ) => void;
  onEnd: () => void;
  /** 进攻略草稿：把回忆整理成能给人看的版本 */
  onGuide: () => void;
};

/**
 * 旅行回忆：整趟回顾 + 按天按地点的图文。
 *
 * 一条铁律：**不能把计划写成实际经历**。每条安排默认 `visited = 'unknown'`，
 * 用户明确点了「去了 / 没去」才算数。分享页要区分亲历与非亲历，全靠这里的三态，
 * 一旦这里默认成「去了」，后面就再也分不出来。
 */
export function MemoryPage({
  demand,
  plans,
  planIndex,
  endedAt,
  memory,
  onBack,
  onSaveOverview,
  onPhotos,
  onAdoptDraft,
  onDiscardDraft,
  onSavePlace,
  onEnd,
  onGuide,
}: Props) {
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? plans[0];
  const days = plan?.days ?? [];
  const [draft, setDraft] = useState<string | null>(null);
  const overview = draft ?? memory.overview;
  /**
   * 回顾文本框是受控于 default-value 的（不用 value：中文输入法下 bindinput 不一定逐字来）。
   * 代价是采纳草稿后改 memory.overview 不会反映到框里，只能靠换 key 强制重挂一次。
   */
  const [overviewKey, setOverviewKey] = useState(0);
  const photoOk = canPickPhoto();

  /**
   * 逐条安排，只保留地点类。
   *
   * 餐食条目（kind === 'meal'）没有 placeId，问用户「午餐去没去」是废话，
   * 印象应该写进它的上一站。所以这里直接过滤掉，不留一条只为了凑数的行。
   */
  const rows = days.flatMap((d) =>
    d.items
      .filter((it) => it.kind !== 'meal' && !!it.placeId)
      .map((it) => ({
        dayIndex: d.index,
        planRef: it.id,
        placeId: it.placeId ?? '',
        title: it.title,
        kind: it.kind,
      }))
  );

  /**
   * 选图后先尝试换成云端地址，换成了再存。
   *
   * 为什么先上传再存：存下 `dataUri` 再异步替换，中间那段时间里「已存的照片」和
   * 「上传结果」是两个来源，用户删掉照片后上传回来又把引用写回本地，会出现
   * 删不掉的幽灵照片。先换后存没有这个窗口。
   *
   * 上传失败不阻断：照片留在本机照样能看，只是不能跟着攻略分享 —— 这比「选完图
   * 什么都没发生」好得多，所以保留原引用并提示一次。
   */
  const pickAndUpload = async (): Promise<PhotoRef | null> => {
    const picked = await pickPhoto();
    if (!picked) return null;
    const uploaded = await uploadPhoto(picked);
    if (uploaded) return uploaded;
    toast('照片先存在本机，分享攻略时不会带上它');
    return picked;
  };

  const addPhotos = async () => {
    const picked = await pickAndUpload();
    if (!picked) return;
    onPhotos([...memory.photos, picked]);
    track('photo_add', { scope: 'overview', count: memory.photos.length + 1 });
  };

  const addPlacePhotos = async (row: { planRef: string; dayIndex: number; placeId: string; title: string }) => {
    const picked = await pickAndUpload();
    if (!picked) return;
    const existing = memory.places[row.planRef]?.photos ?? [];
    onSavePlace({
      planRef: row.planRef,
      dayIndex: row.dayIndex,
      placeId: row.placeId,
      placeTitle: row.title,
      photos: [...existing, picked],
    });
    track('photo_add', { scope: 'place', count: existing.length + 1 });
  };

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y bounces={false}>
        <view className={cls('mem-page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <IconSvg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>旅行回忆</text>
            <view className={cls('icon-btn')} />
          </view>

          <view className={cls('mem-banner')}>
            <text className={cls('mem-banner-title')}>{demand.destination}</text>
            <text className={cls('mem-banner-sub')}>
              {demand.dayCount} 天 · {demand.party} 人
              {endedAt ? ` · 已于 ${endedAt.slice(0, 10)} 结束` : ' · 还在进行中'}
            </text>
          </view>

          {/* 结束旅行时整理的草稿：先看再用，不直接盖掉下面那张「这趟旅行」 */}
          {memory.draft ? (
            <view className={cls('card')}>
              <text className={cls('card-title')}>按你记下的内容整理了一版</text>
              <text className={cls('card-note')}>
                只重排了你写过的东西，没替你编任何感受。要用就点「用作回顾」，之后照常改。
              </text>
              <view className={cls('mem-draft')}>
                {memory.draft.split('\n').map((line, idx) =>
                  line.startsWith('Day ') || line.startsWith('还没记：') ? (
                    <text key={idx} className={cls('mem-draft-head')}>
                      {line}
                    </text>
                  ) : (
                    <text key={idx} className={cls('mem-draft-line')}>
                      {line}
                    </text>
                  )
                )}
              </view>
              <view className={cls('mem-draft-actions')}>
                <view className={cls('mem-draft-btn on')} bindtap={() => {
                  onAdoptDraft();
                  setOverviewKey((n) => n + 1);
                }}>
                  <text className={cls('mem-draft-btn-text on')}>用作回顾</text>
                </view>
                <view className={cls('mem-draft-btn')} bindtap={onDiscardDraft}>
                  <text className={cls('mem-draft-btn-text')}>删掉</text>
                </view>
              </view>
            </view>
          ) : null}

          {/* 整趟回顾 */}
          <view className={cls('card')}>
            <text className={cls('card-title')}>这趟旅行</text>
            <text className={cls('card-note')}>
              写下整体感受。没写就是没写，不会替你编。
            </text>
            <textarea
              key={`overview-${overviewKey}`}
              className={cls('mem-input')}
              default-value={memory.overview}
              placeholder="比如：带爸妈走的，节奏偏慢，第二天下午最舒服。"
              maxlength={2000}
              bindinput={(e: { detail: { value: string } }) => setDraft(e.detail.value)}
              bindblur={(e: { detail?: { value?: string } }) => {
                // blur 事件自带当次全文：不依赖 bindinput 有没有触发，中文输入法下 bindinput 不一定逐字来
                const text = e?.detail?.value ?? draft;
                if (text === null || text === undefined) return;
                if (text === memory.overview) return;
                onSaveOverview(text);
                track('note_save', { scope: 'overview', chars: text.length });
                setDraft(null);
              }}
            />
            <text className={cls('mem-count')}>{overview.length} / 2000</text>

            <view className={cls('mem-photo-row')}>
              {memory.photos.map((p) => (
                <view key={p.id} className={cls('mem-photo-wrap')}>
                  <image className={cls('mem-photo')} src={photoSrc(p)} mode="aspectFill" />
                  <view
                    className={cls('mem-photo-del')}
                    bindtap={() => {
                      onPhotos(memory.photos.filter((x) => x.id !== p.id));
                      track('photo_remove', { scope: 'overview' });
                    }}
                  >
                    <text className={cls('mem-photo-del-text')}>×</text>
                  </view>
                </view>
              ))}
              {photoOk ? (
                <view className={cls('mem-photo-add')} bindtap={addPhotos}>
                  <text className={cls('mem-photo-add-text')}>+ 照片</text>
                </view>
              ) : null}
            </view>
            {!photoOk ? (
              <text className={cls('mem-note')}>
                照片要等相册与云端存储接好才能用，文字和「去没去」现在就能记。
              </text>
            ) : null}
          </view>

          {/* 按天按地点 */}
          {rows.map((row) => {
            const note = memory.places[row.planRef];
            const visited = note?.visited ?? 'unknown';
            return (
              <view key={row.planRef} className={cls('card')}>
                <view className={cls('mem-row-head')}>
                  <text className={cls('mem-row-title')}>{row.title}</text>
                  <text className={cls('mem-row-day')}>Day {row.dayIndex}</text>
                </view>

                <view className={cls('mem-visited')}>
                  <view
                    className={cls(visited === 'yes' ? 'mem-chip mem-chip-on' : 'mem-chip')}
                    bindtap={() => {
                      onSavePlace({ ...row, placeTitle: row.title, visited: visited === 'yes' ? 'unknown' : 'yes' });
                      track('place_visited', { visited: visited === 'yes' ? 'unknown' : 'yes' });
                    }}
                  >
                    <text className={cls(visited === 'yes' ? 'mem-chip-text on' : 'mem-chip-text')}>去了</text>
                  </view>
                  <view
                    className={cls(visited === 'no' ? 'mem-chip mem-chip-no' : 'mem-chip')}
                    bindtap={() => {
                      onSavePlace({ ...row, placeTitle: row.title, visited: visited === 'no' ? 'unknown' : 'no' });
                      track('place_visited', { visited: visited === 'no' ? 'unknown' : 'no' });
                    }}
                  >
                    <text className={cls(visited === 'no' ? 'mem-chip-text on' : 'mem-chip-text')}>没去</text>
                  </view>
                  {visited === 'unknown' ? <text className={cls('mem-row-hint')}>还没记</text> : null}
                </view>

                <textarea
                  className={cls('mem-input')}
                  default-value={note?.text ?? ''}
                  placeholder={`在${row.title}的感受…`}
                  maxlength={1000}
                  bindblur={(e: { detail: { value: string } }) => {
                    const text = e.detail.value;
                    if (text === (note?.text ?? '')) return;
                    onSavePlace({ ...row, placeTitle: row.title, text });
                    track('note_save', { scope: 'place', chars: text.length });
                  }}
                />

                <view className={cls('mem-photo-row')}>
                  {(note?.photos ?? []).map((p) => (
                    <view key={p.id} className={cls('mem-photo-wrap')}>
                      <image className={cls('mem-photo')} src={photoSrc(p)} mode="aspectFill" />
                      <view
                        className={cls('mem-photo-del')}
                        bindtap={() => {
                          const left = (note?.photos ?? []).filter((x) => x.id !== p.id);
                          onSavePlace({ ...row, placeTitle: row.title, photos: left });
                        }}
                      >
                        <text className={cls('mem-photo-del-text')}>×</text>
                      </view>
                    </view>
                  ))}
                  {photoOk ? (
                    <view className={cls('mem-photo-add')} bindtap={() => addPlacePhotos(row)}>
                      <text className={cls('mem-photo-add-text')}>+ 照片</text>
                    </view>
                  ) : null}
                </view>
              </view>
            );
          })}

          {rows.length === 0 ? (
            <view className={cls('card')}>
              <text className={cls('card-note')}>这套方案还没有安排，先在行程页加地点再来记。</text>
            </view>
          ) : null}
          <view className={cls('mem-guide')} bindtap={onGuide}>
            <text className={cls('mem-guide-text')}>整理成攻略</text>
          </view>
          <view className={cls('mem-guide-hint')}>
            <text className={cls('mem-guide-hint-text')}>
              只挑你想公开的地点与感受。同行人数、费用、私人备注默认都不带过去。
            </text>
          </view>

          <view
            className={cls(endedAt ? 'mem-end mem-end-ghost' : 'mem-end')}
            bindtap={() => {
              onEnd();
              toast(endedAt ? '已重新标记为进行中' : '已结束这次旅行，可以开始补充记录了');
            }}
          >
            <text className={cls(endedAt ? 'mem-end-text ghost' : 'mem-end-text')}>
              {endedAt ? '重新标记为进行中' : '结束这次旅行'}
            </text>
          </view>
        </view>
      </scroll-view>
    </view>
  );
}
