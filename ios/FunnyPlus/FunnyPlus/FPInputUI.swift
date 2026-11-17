import ObjectiveC
import UIKit

/**
 * 原生 Lynx 4.2.0 的 iOS 包里没有 input 组件。
 *
 * JS 侧写 <input> 时会抛 LynxCreateUIException（code 9901），整页输入失效。
 * 这里只补前端真正用到的部分：placeholder、value，以及 bindinput 的 detail.value。
 *
 * 属性名要让 LynxPropsProcessor 扫到。它用 class_copyMethodList 找前缀
 * `__lynx_prop_config__` 的类方法，返回值是 [属性名, setter 名, 类型]。
 * setter 的 selector 是 `名字:requestReset:`。这是 LYNX_PROP_SETTER 宏展开后的形状，
 * 方法必须写在类本体上（写在 extension 里会进 category，扫描看不到）。
 */
@objc(FPInputUI)
final class FPInputUI: LynxUI<UITextField> {
    @objc(__lynx_prop_config__placeholder)
    class func lynxPropConfigPlaceholder() -> NSArray {
        ["placeholder", "placeholder", "NSString*"]
    }

    @objc(__lynx_prop_config__value)
    class func lynxPropConfigValue() -> NSArray {
        ["value", "value", "NSString*"]
    }

    override func createView() -> UITextField? {
        let field = UITextField()
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.font = .systemFont(ofSize: 13)
        field.textColor = UIColor(red: 0.09, green: 0.17, blue: 0.30, alpha: 1)
        field.returnKeyType = .done
        field.addTarget(self, action: #selector(fpEditingChanged(_:)), for: .editingChanged)
        return field
    }

    /// 形状对齐 Web 的 event.detail.value。detail 少一层，前端拿到的是 undefined。
    @objc private func fpEditingChanged(_ sender: UITextField) {
        let event = LynxDetailEvent(
            name: "input",
            targetSign: sign,
            detail: ["value": sender.text ?? ""]
        )
        context?.eventEmitter?.send(event)
    }

    @objc(placeholder:requestReset:)
    func placeholder(_ value: String?, requestReset _: Bool) {
        self.view().placeholder = value
    }

    @objc(value:requestReset:)
    func setValue(_ value: String?, requestReset _: Bool) {
        let field = self.view()
        let next = value ?? ""
        // 内容没变就别写，否则每帧回填会把光标顶到末尾
        if field.text != next { field.text = next }
    }

    /// 启动时打一行，确认属性注册方法真的在类的 method list 里，而不是 category。
    static func notePropConfigs() {
        var count: UInt32 = 0
        guard let methods = class_copyMethodList(object_getClass(FPInputUI.self), &count) else {
            NSLog("[FunnyPlus] input prop config methods=0")
            return
        }
        defer { free(methods) }
        var found = 0
        for i in 0..<Int(count) {
            let name = NSStringFromSelector(method_getName(methods[i]))
            if name.hasPrefix("__lynx_prop_config__") { found += 1 }
        }
        NSLog("[FunnyPlus] input prop config methods=%d", found)
    }
}

func fpMakeLynxConfig() -> LynxConfig {
    let config = LynxConfig(provider: nil)
    config.registerUI(FPInputUI.self, withName: "input")
    config.registerUI(LynxUISVG.self, withName: "svg")
    return config
}
