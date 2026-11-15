#import <UIKit/UIKit.h>

#import <Lynx/LynxConfig.h>
#import <Lynx/LynxEnv.h>
#import <Lynx/LynxEvent.h>
#import <Lynx/LynxEventEmitter.h>
#import <Lynx/LynxPropsProcessor.h>
#import <Lynx/LynxUI.h>

/**
 * 原生 Lynx 4.2.0 的 iOS 包里**没有 input 组件**。
 *
 * 证据：`LynxUIOwner.m` 只在 `x-input-ng` 这个类存在时，才把它注册成 `input`；
 * 而 vendor/Lynx 的 ui/ 目录只有 text / image / scroll_view / list / frame，
 * 编译产物里也查不到任何 Input 相关的 ObjC 类（对照 LynxUIText 有符号）。
 * 官方 4.2.0 release 资产同样没有 LynxInput 包。
 *
 * 后果不是「输入框不显示」这么轻：JS 侧写 <input> 时，
 * TemplateAssembler 会抛 `LynxCreateUIException: input ui not found when create UI`（code 9901），
 * 该节点无法创建，页面上的输入交互整体失效。
 *
 * 这里自己补一个最小实现：UITextField 包一层，只做前端真正用到的那部分
 * —— placeholder、value、以及 bindinput 需要的 detail.value。
 * 不做这些（也没做）：多行、光标位置上报、selection、键盘类型、composition。
 * 需要更多能力时按需往 LYNX_PROP_SETTER / 事件里加，别一次抄全。
 */
@interface FPInputUI : LynxUI<UITextField*>
@end

@implementation FPInputUI

- (UITextField*)createView {
  UITextField* field = [[UITextField alloc] init];
  field.borderStyle = UITextBorderStyleNone;
  field.backgroundColor = [UIColor clearColor];
  field.font = [UIFont systemFontOfSize:13];
  field.textColor = [UIColor colorWithRed:0.09 green:0.17 blue:0.30 alpha:1.0];
  // 单行输入：回车就是收起键盘，不做 onSubmit 往返
  field.returnKeyType = UIReturnKeyDone;
  [field addTarget:self action:@selector(fpEditingChanged:) forControlEvents:UIControlEventEditingChanged];
  return field;
}

/**
 * 文本变化要回传成 `input` 自定义事件，形状对齐 Web 端的 event.detail.value：
 * 前端写的是 bindinput={(e) => setText(e.detail.value)}，detail 少一层它就取到 undefined。
 */
- (void)fpEditingChanged:(UITextField*)sender {
  LynxCustomEvent* event = [[LynxDetailEvent alloc] initWithName:@"input"
                                                      targetSign:[self sign]
                                                          detail:@{@"value" : sender.text ?: @""}];
  [self.context.eventEmitter sendCustomEvent:event];
}

LYNX_PROP_SETTER("placeholder", placeholder, NSString*) {
  self.view.placeholder = value;
}

LYNX_PROP_SETTER("value", value, NSString*) {
  // 只在真的不同的时候写，否则每帧回填会把光标顶到末尾
  if (![self.view.text isEqualToString:value]) self.view.text = value;
}

@end

/**
 * 造一份带 input 注册的 LynxConfig，交给 LynxViewBuilder.config。
 *
 * 不走 `[LynxEnv sharedInstance].config`：那个属性是懒初始化的，在 viewDidLoad 阶段
 * 实测读到 nil（打日志确认过），registerUI 会被静默跳过，页面照样报 9901。
 * builder.config 是官方支持的另一条入口（LynxTemplateRender.mm:296 在空时回落），
 * 显式给一份最可控。
 */
LynxConfig* FPMakeLynxConfig(void) {
  LynxConfig* config = [[LynxConfig alloc] initWithProvider:nil];
  [config registerUI:[FPInputUI class] withName:@"input"];
  return config;
}
