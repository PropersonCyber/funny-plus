import UIKit

/// Info.plist 的 UISceneDelegateClassName 按这个名字查找，不能带模块前缀。
@objc(SceneDelegate)
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        // 旧的 WKWebView 运行时还在 WebHostController。对照时把这一行换成 WebHostController()。
        window.rootViewController = LynxHostController()
        window.makeKeyAndVisible()
        self.window = window
    }

    /// 三方登录回跳。现在只认 funnyplus://auth?code=
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts {
            FPBridge.handle(ctx.url)
        }
    }
}
