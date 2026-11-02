import { useCallback, useMemo, useState } from '@lynx-js/react';

import spotKuanzhai from '../../assets/gen/spot-kuanzhai.jpg';
import spotWuhou from '../../assets/gen/spot-wuhou.jpg';
import spotJinli from '../../assets/gen/jinli.jpg';
import spotChunxi from '../../assets/gen/chunxi.jpg';
import spotPanda from '../../assets/gen/panda.jpg';
import spotDufu from '../../assets/gen/dufu.jpg';
import cityChengdu from '../../assets/gen/chengdu.jpg';
import cityChongqing from '../../assets/gen/chongqing.jpg';
import { svgIcon, QICON } from '../../icons.js';
import { myVerdict, saveVerdict, VERDICT_LABEL } from '../../feedback.js';
import type { Verdict } from '../../feedback.js';
import { track } from '../../track.js';
import { factsOf, placeById } from '../../data.js';
import type { Plan } from '../../data.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  city: string;
  plans: Plan[];
};

// 每个景点一张实拍感插画，没有的就退到城市封面
const SPOT_IMG: Record<string, string> = {
  'cd-kuanzhai': spotKuanzhai,
  'cd-wuhou': spotWuhou,
  'cd-jinli': spotJinli,
  'cd-chunxi': spotChunxi,
  'cd-panda': spotPanda,
  'cd-dufu': spotDufu,
  'cq-hongyadong': cityChongqing,
  'cq-ciqikou': cityChongqing,
};

const CITY_IMG: Record<string, string> = { 成都: cityChengdu, 重庆: cityChongqing };

// 参考图里三行「出发前避坑」的固定分栏，正文来自 facts
const SECTIONS: { key: string; title: string; icon: keyof typeof QICON; tint: string }[] = [
  { key: '天气与人流', title: '人流提醒', icon: 'weather', tint: 'rgba(245,160,60,0.16)' },
  { key: '交通与路线', title: '交通建议', icon: 'pin', tint: 'rgba(139,124,255,0.16)' },
  { key: '额外消费', title: '周边消费', icon: 'star', tint: 'rgba(36,120,242,0.14)' },
  { key: '预约与门票', title: '门票预约', icon: 'ticket', tint: 'rgba(53,192,138,0.16)' },
];

// 设计稿的分类名 → facts 里的原始分类，跟「完整避坑指南」的筛选条一一对应
const CATEGORIES: { label: string; value: string }[] = [
  { label: '全部', value: '全部' },
  { label: '门票预约', value: '预约与门票' },
  { label: '交通与路线', value: '交通与路线' },
  { label: '天气与人流', value: '天气与人流' },
  { label: '价格与消费', value: '额外消费' },
];

const TRUST_LABEL: Record<string, string> = {
  official: '官方信息',
  credible: '权威可核',
  experience: '用户经验',
  pending: '待核实',
};

const LEVEL: Record<string, { text: string; cls: string }> = {
  official: { text: '重要', cls: 'lv-important' },
  credible: { text: '正常', cls: 'lv-normal' },
  experience: { text: '提醒', cls: 'lv-warn' },
  pending: { text: '待核实', cls: 'lv-pending' },
};

/**
 * facts 的 scope 是「城市 · 景点/片区」的自由文本，跟 places.json 的景点名对不上，
 * 例如「熊猫基地」对「成都大熊猫繁育研究基地」。
 * 所以按前两个字也认一次，够用且不会把「市中心博物馆」误认成「杜甫草堂」。
 */
function relatesToSpot(scope: string, name: string): boolean {
  const spots = (scope.split('·')[1] ?? '').split('/').map((x) => x.trim()).filter(Boolean);
  return spots.some((p) => p.includes(name) || name.includes(p) || (p.length >= 2 && name.includes(p.slice(0, 2))));
}

export function GuidePage({ city, plans }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [category, setCategory] = useState('全部');
  const [spotId, setSpotId] = useState<string | null>(null);
  // 本机反馈：key 是 factId，提交后立刻回显「你反馈过」
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  const onVerdict = useCallback((factId: string, verdict: Verdict) => {
    const saved = saveVerdict(factId, verdict);
    setVerdicts((prev) => ({ ...prev, [factId]: saved ?? prev[factId] ?? verdict }));
    track('fact_feedback', { factId, verdict, saved: saved !== null });
  }, []);

  const facts = useMemo(() => factsOf(city), [city]);

  // 默认行程里排到的景点，按出现顺序去重；换天/换方案时会重算
  const spots = useMemo(() => {
    const seen = new Set<string>();
    const out: NonNullable<ReturnType<typeof placeById>>[] = [];
    for (const plan of plans) {
      for (const day of plan.days) {
        for (const item of day.items) {
          const place = item.placeId ? placeById(item.placeId) : undefined;
          if (!place || seen.has(place.id)) continue;
          seen.add(place.id);
          out.push(place);
        }
      }
    }
    return out;
  }, [plans]);

  // 默认第一个景点；行程里一个点都没有时退到城市本身
  const spot = (spotId ? spots.find((s) => s.id === spotId) : undefined) ?? spots[0];

  const hero = (spot && SPOT_IMG[spot.id]) || CITY_IMG[city] || cityChengdu;
  const spotName = spot?.name ?? city;
  const tags = spot?.tags ?? ['热门', '步行友好'];

  // 先放 scope 命中当前景点的条目，再放全城的：同名分类下景点条目优先
  const orderedFacts = useMemo(() => {
    if (!spot) return facts;
    const own = facts.filter((f) => relatesToSpot(f.scope, spot.name));
    const rest = facts.filter((f) => !relatesToSpot(f.scope, spot.name));
    return [...own, ...rest];
  }, [facts, spot]);

  const list = category === '全部' ? facts : facts.filter((f) => f.category === category);

  const rows = SECTIONS.map((s) => ({
    ...s,
    fact: orderedFacts.find((f) => f.category === s.key),
  })).filter((r) => r.fact);

  if (showAll) {
    return (
      <view className={cls('page page-shell')}>
        <view className={cls('gd-list-head')}>
          <view className={cls('gd-back')} bindtap={() => setShowAll(false)}>
            <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
          </view>
          <text className={cls('gd-list-title')}>完整避坑指南 · {city}</text>
        </view>

        <scroll-view className={cls('cat-scroll')} scroll-x>
          <view className={cls('cat-row')}>
            {CATEGORIES.map((c) => (
              <view
                key={c.value}
                className={cls(c.value === category ? 'chip chip-on' : 'chip')}
                bindtap={() => setCategory(c.value)}
              >
                <text className={cls(c.value === category ? 'chip-text chip-text-on' : 'chip-text')}>{c.label}</text>
              </view>
            ))}
          </view>
        </scroll-view>

        <scroll-view className={cls('scroll')} scroll-y>
          {list.length === 0 ? (
            <view className={cls('card gd-card')}>
              <text className={cls('card-title')}>这一类暂无未过期条目</text>
              <text className={cls('card-note')}>过期内容默认不展示；{city} 这个分类目前没有可展示的信息，不编造。</text>
            </view>
          ) : null}
          {list.map((f) => (
            <view key={f.id} className={cls('card gd-card')}>
              <view className={cls('gd-head')}>
                <view className={cls('gd-icon')}>
                  <image src={QICON.ticket} mode="aspectFit" style={{ width: '22px', height: '22px' }} />
                </view>
                <view className={cls('gd-main')}>
                  <view className={cls('gd-title-row')}>
                    <text className={cls('gd-title')}>{f.category}</text>
                    <view className={cls(['fact-cat-badge', LEVEL[f.trust]?.cls ?? ''].join(' '))}>
                      <text className={cls('fact-cat-text')}>{LEVEL[f.trust]?.text ?? '待核实'}</text>
                    </view>
                  </view>
                  <text className={cls('gd-content')}>{f.content}</text>
                </view>
              </view>
              <view className={cls('gd-foot')}>
                <text className={cls('fact-meta')}>
                  {f.scope} · {TRUST_LABEL[f.trust] ?? f.trust}
                </text>
                <text className={cls('fact-meta')}>
                  {f.validUntil ? `有效期至 ${f.validUntil}` : `核验 ${f.verifiedAt}`}
                </text>
              </view>
              <view className={cls('gd-feedback')}>
                {(['met', 'not-applicable'] as Verdict[]).map((v) => {
                  const mine = (verdicts[f.id] ?? myVerdict(f.id)) === v;
                  return (
                    <view
                      key={v}
                      className={cls(mine ? 'fb-chip fb-chip-on' : 'fb-chip')}
                      bindtap={() => (mine ? undefined : onVerdict(f.id, v))}
                    >
                      <text className={cls(mine ? 'fb-chip-text on' : 'fb-chip-text')}>
                        {mine ? `已记：${VERDICT_LABEL[v]}` : VERDICT_LABEL[v]}
                      </text>
                    </view>
                  );
                })}
              </view>
            </view>
          ))}
          <text className={cls('mock-note')}>评分、评价人数与介绍文案为设计稿示例（mock）</text>
        </scroll-view>
      </view>
    );
  }

  return (
    <scroll-view className={cls('scroll')} scroll-y>
      <view className={cls('gd-page')}>
        <view className={cls('gd-hero')}>
          <image src={hero} mode="aspectFill" style={{ width: '100%', height: '300px' }} />
        </view>

        <view className={cls('gd-sheet')}>
          <view className={cls('gd-title-row2')}>
            <text className={cls('gd-spot')}>{spotName}</text>
            <svg content={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '18px', height: '18px' }} />
          </view>
          <view className={cls('gd-rating')}>
            <text className={cls('gd-star')}>★</text>
            <text className={cls('gd-score')}>4.7</text>
            <text className={cls('gd-score-note')}>12.6 万人评价</text>
          </view>
          <view className={cls('gd-tags')}>
            {tags.slice(0, 3).map((t) => (
              <view key={t} className={cls('gd-tag')}>
                <text className={cls('gd-tag-text')}>{t}</text>
              </view>
            ))}
          </view>

          {spots.length > 0 ? (
            <scroll-view className={cls('gd-spots')} scroll-x>
              <view className={cls('gd-spot-row')}>
                {spots.map((sp) => {
                  const on = spot?.id === sp.id;
                  return (
                    <view key={sp.id} className={cls('gd-spot-item')} bindtap={() => setSpotId(sp.id)}>
                      <view className={on ? cls('gd-spot-ring gd-spot-ring-on') : cls('gd-spot-ring')}>
                        <image
                          className={cls('gd-spot-thumb')}
                          src={SPOT_IMG[sp.id] ?? CITY_IMG[city] ?? cityChengdu}
                          mode="aspectFill"
                        />
                      </view>
                      <text className={on ? cls('gd-spot-name gd-spot-name-on') : cls('gd-spot-name')}>
                        {sp.name}
                      </text>
                    </view>
                  );
                })}
              </view>
            </scroll-view>
          ) : null}

          <view className={cls('gd-avoid')}>
            <view className={cls('gd-avoid-head')}>
              <svg content={svgIcon('shield', '#1E9E6A')} style={{ width: '17px', height: '17px', marginRight: '6px' }} />
              <text className={cls('gd-avoid-title')}>出发前避坑</text>
              <svg content={svgIcon('chevronRight', '#A5B2C7')} style={{ width: '16px', height: '16px' }} />
            </view>
            {rows.map((r) => (
              <view key={r.key} className={cls('gd-row')}>
                <view className={cls('gd-row-icon')} style={{ backgroundColor: r.tint }}>
                  <image src={QICON[r.icon]} mode="aspectFit" style={{ width: '22px', height: '22px' }} />
                </view>
                <view className={cls('gd-row-main')}>
                  <text className={cls('gd-row-title')}>{r.title}</text>
                  <text className={cls('gd-row-desc')}>{(r.fact as any).content}</text>
                </view>
              </view>
            ))}
            <view
              className={cls('gd-cta')}
              bindtap={() => {
                setShowAll(true);
                track('fact_detail_open', { city, spot: spot?.id ?? '' });
              }}
            >
              <text className={cls('gd-cta-text')}>查看完整避坑指南</text>
              <svg content={svgIcon('arrowRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '4px' }} />
            </view>
          </view>

          <text className={cls('gd-about-title')}>景点介绍</text>
          <text className={cls('gd-about')}>
            {spotName}是{city}的热门目的地之一，{tags.join('、')}是这里的关键词。上面三条来自已核验的避坑信息，
            出发前建议先看人流与交通两条，能省掉现场排队和绕路的时间。
          </text>
          <text className={cls('mock-note')}>评分、评价人数与介绍文案为设计稿示例（mock）</text>
        </view>
      </view>
    </scroll-view>
  );
}
