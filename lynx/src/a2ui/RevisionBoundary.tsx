import { Component } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';

/**
 * 渲染抛错的兜底壳。
 *
 * 为什么需要它：A2UI 的 renderError / renderUnsupported 只接管「协议不认识、
 * 组件没注册」这类它自己判定得了的情况；如果渲染子树里真的抛出异常，
 * Lynx 会一路往上抛，整页白掉。这个壳把它拦住，换成调用方给的降级视图。
 *
 * 为什么用类组件而不是 useErrorBoundary：后者只在「调用它的那个组件」的父级
 * 生效，而这里需要在 A2UI 外面加一层捕获边界；类组件的 componentDidCatch
 * 是 ReactLynx 支持得最直白的写法。
 */

type Props = {
  /** 正常渲染的内容 */
  children: ReactNode;
  /** 抛错时替换成什么；应当就是旧卡片 */
  fallback: () => ReactNode;
};

type State = { failed: boolean };

export class RevisionBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  /** 只记一次：这里没有上报通道，留着方便本地排查 */
  componentDidCatch(error: unknown) {
    console.error('[a2ui] 预览卡片渲染失败，已回落旧卡片：', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback();
    return this.props.children;
  }
}