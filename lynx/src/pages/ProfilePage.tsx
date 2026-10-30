import { svgIcon } from '../icons.js';
import { MOCK } from '../mock.js';
import avatarImg from '../assets/ip/avatar.jpg';

export function ProfilePage() {
  return (
    <scroll-view className="scroll" scroll-y>
      <view className="me">
        <view className="me-sky" />

        <view className="me-in">
          <view className="me-head">
            <image
              src={avatarImg}
              mode="aspectFill"
              style={{ width: '64px', height: '64px', borderRadius: '32px' }}
            />
            <view className="me-info">
              <text className="me-name">{MOCK.profile.name}</text>
              <view className="level-pill">
                <text className="level-text">{MOCK.profile.level}</text>
              </view>
            </view>
            <view className="me-set">
              <svg content={svgIcon('settings', '#5A6E8C')} style={{ width: '21px', height: '21px' }} />
            </view>
          </view>

          <view className="stat-row">
            {MOCK.profile.stats.map((s) => (
              <view key={s.label} className="stat">
                <text className="stat-num">{s.num}</text>
                <text className="stat-label">{s.label}</text>
              </view>
            ))}
          </view>

          <view className="member">
            <view className="member-main">
              <text className="member-title">开通会员</text>
              <text className="member-sub">{MOCK.profile.member}</text>
            </view>
            <view className="member-btn">
              <text className="member-btn-text">立即开通</text>
            </view>
          </view>

          <view className="card card-tight">
            {MOCK.profile.menu.map((m, i) => (
              <view
                key={m.title}
                className={i === MOCK.profile.menu.length - 1 ? 'menu-row menu-row-last' : 'menu-row'}
              >
                <svg
                  content={svgIcon(m.icon, '#3F5980')}
                  style={{ width: '19px', height: '19px', marginRight: '11px' }}
                />
                <text className="menu-title">{m.title}</text>
                <text className="menu-arrow">›</text>
              </view>
            ))}
          </view>

          <text className="mock-note">会员、收藏、足迹为示例数据（mock），对应页面本期未实现</text>
        </view>
      </view>
    </scroll-view>
  );
}
