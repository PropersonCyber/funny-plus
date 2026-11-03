import { useCallback, useState } from '@lynx-js/react';

import mascotAi from '../../assets/ip/mascot-ai.png';
import { MOCK } from '../../mock.js';
import { toast } from '../../toast.js';
import { svgIcon } from '../../icons.js';
import styles from './index.module.scss';
import { makeCls } from '../../styles/cls.js';

const cls = makeCls(styles);

type Props = {
  onBack: () => void;
  onApply: () => void;
};

/** 麦克风图表不在 docs/materials/icons 里，只有这一个页面用，就地内联 */
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.2 11a6.8 6.8 0 0 0 13.6 0M12 17.8V21"/></svg>`;

const micSvg = (color: string) => MIC_SVG.split('currentColor').join(color);

/** AI 助手：设计稿第 7 屏。当前是静态对话演示，没有接模型。 */
export function AssistantPage({ onBack, onApply }: Props) {
  // 只切视觉态：录音没有接，别让按钮看起来像真的在收音
  const [listening, setListening] = useState(false);
  const toggleListening = useCallback(() => setListening((v) => !v), []);

  return (
    <view className={cls('screen-inner')}>
      <scroll-view className={cls('scroll')} scroll-y>
        <view className={cls('page')}>
          <view className={cls('page-head')}>
            <view className={cls('icon-btn')} bindtap={onBack}>
              <svg content={svgIcon('chevronLeft', '#2A3A57')} style={{ width: '18px', height: '18px' }} />
            </view>
            <text className={cls('page-sub-head')}>咕噜</text>
            <view className={cls('head-link')} bindtap={onBack}>
              <text className={cls('head-link-text')}>收起</text>
              <svg content={svgIcon('chevronRight', '#2478F2')} style={{ width: '13px', height: '13px', marginLeft: '2px' }} />
            </view>
          </view>

          <view className={cls('card')}>
            <text className={cls('card-note')}>{MOCK.assistant.greeting}</text>
            {MOCK.assistant.abilities.map((a) => (
              <view key={a} className={cls('ability-row')}>
                <view className={cls('ability-dot')} />
                <text className={cls('ability-text')}>{a}</text>
              </view>
            ))}
          </view>

          <view className={cls('chat-row chat-right')}>
            <view className={cls('bubble bubble-user')}>
              <text className={cls('bubble-text bubble-text-user')}>{MOCK.assistant.userMessage}</text>
            </view>
          </view>

          <view className={cls('chat-row')}>
            <image
              src={mascotAi}
              mode="aspectFit"
              style={{ width: '32px', height: '38px', marginRight: '8px' }}
            />
            <view className={cls('bubble bubble-ai')}>
              <text className={cls('bubble-title')}>{MOCK.assistant.reply}</text>
              <text className={cls('bubble-text')}>{MOCK.assistant.replyNote}</text>
              <view className={cls('bubble-action')} bindtap={onApply}>
                <text className={cls('bubble-action-text')}>{MOCK.assistant.suggestion}</text>
              </view>
            </view>
          </view>

          <text className={cls('mock-note')}>对话是设计稿示例（mock），模型接口未接入</text>
        </view>
      </scroll-view>

      <view className={cls('chat-input')}>
        {/* 输入区是真的占位：点了给一句实话，别让它看着能打字却什么都不发生 */}
        <view className={cls('chat-input-box')} bindtap={() => toast('咕噜还没接入模型，点上面的建议可以直接落到行程')}>
          <text className={cls('chat-placeholder')}>
            {listening ? '聆听中… 说完再点一下麦克风' : MOCK.assistant.placeholder}
          </text>
        </view>
        <view
          className={listening ? cls('chat-mic chat-mic-on') : cls('chat-mic')}
          bindtap={toggleListening}
        >
          <svg content={micSvg(listening ? '#FFFFFF' : '#2478F2')} style={{ width: '17px', height: '17px' }} />
        </view>
        <view className={cls('chat-send')} bindtap={() => toast('咕噜还没接入模型，点上面的建议可以直接落到行程')}>
          <svg content={svgIcon('route', '#FFFFFF')} style={{ width: '16px', height: '16px' }} />
        </view>
      </view>
    </view>
  );
}
