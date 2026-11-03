import { svgIcon } from '../../icons.js';
import { MOCK } from '../../mock.js';
import { toast } from '../../toast.js';
import type { Plan } from '../../data.js';
import avatarImg from '../../assets/ip/avatar.jpg';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  trip: Plan | undefined;
  onOpenTrip: () => void;
};

export function ProfilePage({ trip, onOpenTrip }: Props) {
  // 「我的行程」上面那行已经能点了，菜单里那条是重复项
  const menu = MOCK.profile.menu.filter((m) => m.title !== '我的行程');
  return (
    <scroll-view className={cls('scroll')} scroll-y>
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
              <text className={cls('me-name')}>{MOCK.profile.name}</text>
              <view className={cls('level-pill')}>
                <text className={cls('level-text')}>{MOCK.profile.level}</text>
              </view>
            </view>
          </view>

          <view className={cls('stat-row')}>
            {MOCK.profile.stats.map((s) => (
              <view key={s.label} className={cls('stat')}>
                <text className={cls('stat-num')}>{s.num}</text>
                <text className={cls('stat-label')}>{s.label}</text>
              </view>
            ))}
          </view>

          <view className={cls('member')}>
            <view className={cls('member-main')}>
              <text className={cls('member-title')}>开通会员</text>
              <text className={cls('member-sub')}>{MOCK.profile.member}</text>
            </view>
            <view className={cls('member-btn')} bindtap={() => toast('会员本期未开放')}>
              <text className={cls('member-btn-text')}>立即开通</text>
            </view>
          </view>

          <view className={cls('card card-tight')}>
            <view className={cls('menu-row')} bindtap={onOpenTrip}>
              <svg
                content={svgIcon('itinerary', '#2478F2')}
                style={{ width: '19px', height: '19px', marginRight: '11px' }}
              />
              <view className={cls('save-main')}>
                <text className={cls('menu-title')}>
                  {trip ? `${trip.destination} · ${trip.days.length} 天行程` : '我的行程'}
                </text>
              </view>
              <svg content={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
            </view>
            {menu.map((m, i) => (
              <view
                key={m.title}
                className={cls(i === menu.length - 1 ? 'menu-row menu-row-last' : 'menu-row')}
                bindtap={() => toast(`${m.title}本期未开放`)}
              >
                <svg
                  content={svgIcon(m.icon, '#3F5980')}
                  style={{ width: '19px', height: '19px', marginRight: '11px' }}
                />
                <text className={cls('menu-title')}>{m.title}</text>
                <svg content={svgIcon('chevronRight', '#C7D2E3')} style={{ width: '13px', height: '13px' }} />
              </view>
            ))}
          </view>

          <text className={cls('mock-note')}>会员、收藏、足迹为示例数据（mock），对应页面本期未实现</text>
        </view>
      </view>
    </scroll-view>
  );
}
