import { svgIcon } from '../../icons.js';
import { toast } from '../../toast.js';
import type { SavedTrip } from '../../storage.js';
import type { Collection, Footprint } from '../../../../shared/types/index.js';
import avatarImg from '../../assets/ip/avatar.jpg';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  trips: readonly SavedTrip[];
  activeId: string;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  /** 收藏 / 足迹来自 GET /api/me，不是示例数据 */
  collections: Collection[];
  footprints: Footprint[];
  /** 目标 id → 展示名；解析不到的（被下架的地点）直接跳过不占位 */
  nameOf: (c: Collection | Footprint) => string;
  onOpenTrip: () => void;
};

export function ProfilePage({ trips, activeId, onSwitch, onDelete, collections, footprints, nameOf, onOpenTrip }: Props) {
  const trip = trips.find((t) => t.id === activeId) ?? trips[0];
  // 等级按打卡数推：没有账号体系，用真实行为数当等级比写死 Lv1 可信
  const level = footprints.length >= 10 ? 'Lv3 旅行老手' : footprints.length >= 3 ? 'Lv2 旅行熟手' : 'Lv1 旅行新手';
  const cities = new Set(footprints.map((f) => f.city));
  const activePlan = trip?.plans[trip.planIndex] ?? trip?.plans[0];

  return (
    <scroll-view className={cls('scroll')} scroll-y bounces={false}>
      <view className={cls('me')}>
        <view className={cls('me-sky')} />

        <view className={cls('me-in')}>
          <view className={cls('me-head')}>
            <image
              src={avatarImg}
              mode="aspectFill"
              style={{ width: '64px', height: '64px', borderRadius: '32px' }}
            />
            <view className={cls('me-info')}>
              <text className={cls('me-name')}>旅行小达人</text>
              <view className={cls('level-pill')}>
                <text className={cls('level-text')}>{level}</text>
              </view>
            </view>
          </view>

          <view className={cls('stat-row')}>
            <view className={cls('stat')}>
              <text className={cls('stat-num')}>{trips.length}</text>
              <text className={cls('stat-label')}>旅行计划</text>
            </view>
            <view className={cls('stat')}>
              <text className={cls('stat-num')}>{collections.length}</text>
              <text className={cls('stat-label')}>收藏</text>
            </view>
            <view className={cls('stat')}>
              <text className={cls('stat-num')}>{footprints.length}</text>
              <text className={cls('stat-label')}>足迹</text>
            </view>
            <view className={cls('stat')}>
              <text className={cls('stat-num')}>{cities.size}</text>
              <text className={cls('stat-label')}>城市</text>
            </view>
          </view>

          <view className={cls('member')}>
            <view className={cls('member-main')}>
              <text className={cls('member-title')}>开通会员</text>
              <text className={cls('member-sub')}>解锁无限行程、离线地图与专属攻略</text>
            </view>
            <view className={cls('member-btn')} bindtap={() => toast('会员本期未开放')}>
              <text className={cls('member-btn-text')}>立即开通</text>
            </view>
          </view>

          <view className={cls('card card-tight')}>
            <view className={cls('menu-row menu-row-last')} bindtap={onOpenTrip}>
              <image
                src={svgIcon('itinerary', '#2478F2')}
                style={{ width: '19px', height: '19px', marginRight: '11px' }}
              />
              <view className={cls('save-main')}>
                <text className={cls('menu-title')}>
                  {trip ? `${trip.demand.destination} · ${trip.demand.dayCount} 天行程` : '我的行程'}
                </text>
              </view>
              <image src={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
            </view>
          </view>

          {trips.length > 1 ? (
            <view className={cls('card card-tight')}>
              <text className={cls('sect-title')}>我的行程</text>
              {trips
                .slice()
                .reverse()
                .map((t) => (
                  <view key={t.id} className={cls('menu-row')}>
                    <view
                      className={cls('save-main')}
                      bindtap={() => {
                        if (t.id !== activeId) onSwitch(t.id);
                        onOpenTrip();
                      }}
                    >
                      <text className={cls('menu-title')}>
                        {t.demand.destination} · {t.demand.dayCount} 天 · 人均 ¥
                        {t.plans[t.planIndex]?.budget.perPerson ?? t.plans[0]?.budget.perPerson ?? '—'}
                      </text>
                    </view>
                    <text
                      className={t.id === activeId ? cls('mine-city') : cls('mine-tag')}
                      catchtap={() => onDelete(t.id)}
                    >
                      {t.id === activeId ? '删除' : '切换'}
                    </text>
                  </view>
                ))}
            </view>
          ) : null}

          <view className={cls('card card-tight')}>
            <text className={cls('sect-title')}>我的收藏</text>
            {collections.length === 0 ? (
              <text className={cls('mine-empty')}>还没有收藏：在攻略详情或玩法页点「收藏」</text>
            ) : (
              collections.slice(0, 5).map((c) => (
                <view key={c.id} className={cls('menu-row')}>
                  <text className={cls('mine-tag')}>{TARGET_LABEL[c.targetType]}</text>
                  <text className={cls('mine-name')}>{nameOf(c)}</text>
                </view>
              ))
            )}
          </view>

          <view className={cls('card card-tight')}>
            <text className={cls('sect-title')}>旅行足迹</text>
            {footprints.length === 0 ? (
              <text className={cls('mine-empty')}>还没有打卡：在玩法详情页对景点点「打卡」</text>
            ) : (
              footprints
                .slice()
                .reverse()
                .slice(0, 5)
                .map((f) => (
                  <view key={f.id} className={cls('menu-row')}>
                    <text className={cls('mine-tag')}>{f.visitedOn.slice(5)}</text>
                    <text className={cls('mine-name')}>{nameOf(f)}</text>
                    <text className={cls('mine-city')}>{f.city}</text>
                  </view>
                ))
            )}
          </view>

          <text className={cls('mock-note')}>
            {activePlan ? '行程与预算按真实方案计算' : '收藏、足迹来自你的真实操作'}
          </text>
        </view>
      </view>
    </scroll-view>
  );
}

const TARGET_LABEL: Record<Collection['targetType'], string> = {
  place: '景点',
  fact: '避坑',
  guide: '攻略',
  play: '玩法',
};
