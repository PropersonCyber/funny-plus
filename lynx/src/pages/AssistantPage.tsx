import btnBack from '../assets/ui/btn-back.png';
import mascotExplore from '../assets/ip/mascot-explore.png';
import { MOCK } from '../mock.js';
import { svgIcon } from '../icons.js';

type Props = {
  onBack: () => void;
};

/** AI 助手：设计稿第 7 屏。当前是静态对话演示，没有接模型。 */
export function AssistantPage({ onBack }: Props) {
  return (
    <view className="screen-inner">
      <scroll-view className="scroll" scroll-y>
        <view className="page">
          <view className="page-head">
            <image src={btnBack} mode="aspectFit" style={{ width: '28px', height: '28px' }} bindtap={onBack} />
            <text className="page-sub-head">AI 旅行助手</text>
            <text className="section-more">收起 ›</text>
          </view>

          <view className="card">
            <text className="card-note">{MOCK.assistant.greeting}</text>
            {MOCK.assistant.abilities.map((a) => (
              <view key={a} className="ability-row">
                <view className="ability-dot" />
                <text className="ability-text">{a}</text>
              </view>
            ))}
          </view>

          <view className="chat-row chat-right">
            <view className="bubble bubble-user">
              <text className="bubble-text bubble-text-user">{MOCK.assistant.userMessage}</text>
            </view>
          </view>

          <view className="chat-row">
            <image
              src={mascotExplore}
              mode="aspectFit"
              style={{ width: '32px', height: '38px', marginRight: '8px' }}
            />
            <view className="bubble bubble-ai">
              <text className="bubble-title">{MOCK.assistant.reply}</text>
              <text className="bubble-text">{MOCK.assistant.replyNote}</text>
              <view className="bubble-action">
                <text className="bubble-action-text">{MOCK.assistant.suggestion}</text>
              </view>
            </view>
          </view>

          <text className="mock-note">对话是设计稿示例（mock），模型接口未接入</text>
        </view>
      </scroll-view>

      <view className="chat-input">
        <view className="chat-input-box">
          <text className="chat-placeholder">{MOCK.assistant.placeholder}</text>
        </view>
        <view className="chat-send">
          <svg content={svgIcon('route', '#FFFFFF')} style={{ width: '16px', height: '16px' }} />
        </view>
      </view>
    </view>
  );
}
