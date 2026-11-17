import { useCallback, useState } from '@lynx-js/react';

import { maskPhone } from '../../App/useAuth.js';
import styles from './index.module.scss';

/**
 * 登录页（F06）。
 *
 * 两步一页：先填手机号发码，再填验证码。不做「验证码页另开一屏」，因为两步之间
 * 用户唯一要做的事就是等短信，翻页只会让他找不到返回改号的地方。
 *
 * 匿名优先：页面上始终有「先不登录」出口，且不显示任何「必须登录」的措辞。
 * 登录只挡云同步与跨设备找回，不挡浏览与规划。
 */
export type LoginPageProps = {
  /** 已登录时展示当前账号（脱敏）而不是表单 */
  phone: string | null;
  cooldown: number;
  sending: boolean;
  verifying: boolean;
  error: string;
  onSend: (phone: string) => void;
  onVerify: (phone: string, code: string) => void;
  onBack: () => void;
  onLogout: () => void;
  /** 非生产环境提示固定验证码用；生产环境传空串 */
  devHint: string;
};

export function LoginPage(props: LoginPageProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const loggedIn = !!props.phone;
  const canSend = !props.sending && props.cooldown <= 0 && phone.replace(/\D/g, '').length >= 11;
  const canSubmit = !props.verifying && code.replace(/\D/g, '').length >= 4 && phone.length >= 11;

  const onPhone = useCallback((e: { detail: { value: string } }) => {
    setPhone(e.detail.value);
  }, []);
  const onCode = useCallback((e: { detail: { value: string } }) => {
    setCode(e.detail.value);
  }, []);

  const send = useCallback(() => {
    if (!canSend) return;
    props.onSend(phone);
  }, [canSend, phone, props]);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    props.onVerify(phone, code);
  }, [canSubmit, phone, code, props]);

  if (loggedIn) {
    return (
      <view className={styles['lg-page']}>
        <text className={styles['lg-title']}>已登录</text>
        <text className={styles['lg-sub']}>旅行、回忆与攻略草稿会跟着这个账号，换设备也能找回。</text>
        <view className={styles['lg-field']}>
          <text className={styles['lg-label']}>当前账号</text>
          <text className={styles['lg-input']}>{maskPhone(props.phone)}</text>
        </view>
        <view className={styles['lg-submit-off']} bindtap={props.onLogout}>
          <text className={styles['lg-submit-text']}>退出登录</text>
        </view>
        <view className={styles['lg-skip']} bindtap={props.onBack}>
          <text className={styles['lg-skip-text']}>返回</text>
        </view>
      </view>
    );
  }

  return (
    <view className={styles['lg-page']}>
      <text className={styles['lg-title']}>登录</text>
      <text className={styles['lg-sub']}>登录后旅行、回忆与攻略草稿会存到账号里，换设备也能找回。</text>

      <view className={styles['lg-field']}>
        <text className={styles['lg-label']}>手机号</text>
        <input
          className={styles['lg-input']}
          type="number"
          placeholder="请输入手机号"
          maxlength={11}
          bindinput={onPhone}
        />
      </view>

      <view className={styles['lg-field']}>
        <text className={styles['lg-label']}>验证码</text>
        <view className={styles['lg-code-row']}>
          <input
            className={styles['lg-code-input']}
            type="number"
            placeholder="6 位验证码"
            maxlength={6}
            bindinput={onCode}
          />
          <view className={styles['lg-send']} bindtap={send}>
            <text className={props.cooldown > 0 ? styles['lg-send-text-off'] : styles['lg-send-text']}>
              {props.cooldown > 0 ? `${props.cooldown}s` : props.sending ? '发送中' : '获取验证码'}
            </text>
          </view>
        </view>
      </view>

      {props.error ? <text className={styles['lg-error']}>{props.error}</text> : null}

      <view className={canSubmit ? styles['lg-submit'] : styles['lg-submit-off']} bindtap={submit}>
        <text className={styles['lg-submit-text']}>{props.verifying ? '登录中' : '登录'}</text>
      </view>

      {props.devHint ? <text className={styles['lg-hint']}>{props.devHint}</text> : null}
      <text className={styles['lg-hint']}>首期只支持手机号登录。微信与 Apple 登录后续开放。</text>

      <view className={styles['lg-skip']} bindtap={props.onBack}>
        <text className={styles['lg-skip-text']}>先不登录，继续本机使用</text>
      </view>
    </view>
  );
}
