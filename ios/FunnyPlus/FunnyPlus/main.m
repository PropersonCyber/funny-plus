#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <CoreLocation/CoreLocation.h>

#define kScheme @"app"

// WKWebView 在 file:// 下 fetch 不到 wasm，用自定义 scheme 当静态文件服务器
@interface LocalSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, copy) NSString *root;
/** 真后端地址：/api/* 由这里转出去，避开 app:// 页面直接 fetch http 被 WebKit 拦掉 */
@property(nonatomic, copy) NSString *apiBase;
@end

@implementation LocalSchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSString *path = task.request.URL.path;
  // 业务 JS 跑在 app://local 页面里，直接 fetch http:// 会被当成跨 scheme 请求拒掉（Load failed），
  // 所以把 /api/* 交给原生 NSURLSession 转发，前端只认同源的 app://local/api/*
  if ([path hasPrefix:@"/api/"]) {
    [self proxyTask:task path:path];
    return;
  }
  if ([path hasPrefix:@"/"]) path = [path substringFromIndex:1];
  if (path.length == 0) path = @"index.html";
  NSString *file = [_root stringByAppendingPathComponent:path];
  NSData *data = [NSData dataWithContentsOfFile:file];

  if (!data) {
    [task didFailWithError:[NSError errorWithDomain:@"local" code:404
                                           userInfo:@{NSLocalizedDescriptionKey: @"not found"}]];
    return;
  }

  NSString *ext = file.pathExtension.lowercaseString;
  NSDictionary *types = @{@"html": @"text/html; charset=utf-8",
                          @"js": @"text/javascript; charset=utf-8",
                          @"css": @"text/css; charset=utf-8",
                          @"wasm": @"application/wasm",
                          @"json": @"application/json"};
  NSString *mime = types[ext] ?: @"application/octet-stream";

  NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL
                                                        statusCode:200
                                                       HTTPVersion:@"HTTP/1.1"
                                                      headerFields:@{
                                                        @"Content-Type": mime,
                                                        @"Content-Length": @(data.length).stringValue,
                                                        @"Access-Control-Allow-Origin": @"*"
                                                      }];
  [task didReceiveResponse:resp];
  [task didReceiveData:data];
  [task didFinish];
}

- (void)proxyTask:(id<WKURLSchemeTask>)task path:(NSString *)path {
  NSString *url = [self.apiBase stringByAppendingString:path];
  NSString *query = task.request.URL.query;
  if (query.length) url = [url stringByAppendingFormat:@"?%@", query];

  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
  req.HTTPMethod = task.request.HTTPMethod ?: @"GET";
  NSString *ct = [task.request valueForHTTPHeaderField:@"content-type"];
  if (ct) [req setValue:ct forHTTPHeaderField:@"content-type"];

  NSData *body = task.request.HTTPBody;
  if (!body && task.request.HTTPBodyStream) {
    NSInputStream *stream = task.request.HTTPBodyStream;
    [stream open];
    NSMutableData *buf = [NSMutableData data];
    uint8_t chunk[1024];
    while ([stream hasBytesAvailable]) {
      NSInteger n = [stream read:chunk maxLength:sizeof(chunk)];
      if (n <= 0) break;
      [buf appendBytes:chunk length:(NSUInteger)n];
    }
    [stream close];
    body = buf;
  }
  if (body.length) req.HTTPBody = body;

  [[NSURLSession sharedSession] dataTaskWithRequest:req
      completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (err) {
        [task didFailWithError:err];
        return;
      }
      NSInteger code = [(NSHTTPURLResponse *)resp statusCode];
      NSString *type = [(NSHTTPURLResponse *)resp valueForHTTPHeaderField:@"content-type"] ?: @"application/json";
      NSHTTPURLResponse *out = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL
                                                          statusCode:code
                                                         HTTPVersion:@"HTTP/1.1"
                                                        headerFields:@{@"Content-Type": type,
                                                                       @"Access-Control-Allow-Origin": @"*"}];
      [task didReceiveResponse:out];
      if (data.length) [task didReceiveData:data];
      [task didFinish];
    });
  }].resume;
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

/**
 * 前端 ↔ 原生的注入点集中在这里：定位结果、登录回调。
 *
/**
 * 前端 ↔ 原生的注入点集中在这里：定位结果、登录回调。
 *
 * **必须走 `lynx-view.globalProps`，不能挂 window**：web-core 把业务 JS 放进
 * `new Worker(...)` 跑，Worker 的 globalThis 是 WorkerGlobalScope，看不到主线程的
 * window。之前往 window 挂 __fpLocation 的做法在 Worker 里永远读不到，
 * 前端只能一路降级成「没有定位能力」—— 这就是定位一直没生效的原因。
 *
 * globalProps 的 setter 会走 updateGlobalProps → backgroundThread，
 * 是官方支持的跨线程通道。
 */
@interface FPBridge : NSObject
@property(nonatomic, weak) WKWebView *web;
+ (instancetype)shared;
/** provider 回跳：funnyplus://auth?provider=wechat&code=xxx */
+ (BOOL)handleURL:(NSURL *)url;
- (void)pushLocation:(CLLocation *)loc error:(NSString *)error;
/** 页面加载完把最近一次结果重放一遍：定位回调常常比页面先到 */
- (void)flush;
@end

@implementation FPBridge {
  CLLocation *_lastLoc;
  NSString *_lastErr;
  BOOL _hasResult;
}

+ (instancetype)shared {
  static FPBridge *inst;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ inst = [FPBridge new]; });
  return inst;
}

- (void)eval:(NSString *)js {
  WKWebView *w = self.web;
  if (!w || !js.length) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [w evaluateJavaScript:js completionHandler:nil]; });
}

- (void)pushLocation:(CLLocation *)loc error:(NSString *)error {
  _lastLoc = loc;
  _lastErr = [error copy];
  _hasResult = YES;
  [self replay];
}

- (void)flush { [self replay]; }

/**
 * 把定位结果合并进 globalProps。
 *
 * 合并而不是整体替换：globalProps 里可能还有别的键（将来放 token、主题），
 * 每次只覆盖 __fpLocation 一项，其余原样带回去。
 *
 * 用 Object.assign 合并且对 __fpLocation 用「深合并」，
 * 是因为壳里可能带过来一个 __fpOpenSettings 之类的固定项，不能被这次覆盖冲掉。
 */
- (void)replay {
  if (!_hasResult) return;

  NSString *payload;
  if (!_lastLoc) {
    // 拒绝和失败分开：前端据此决定是提示去设置里开权限，还是只当没定位
    NSString *msg = _lastErr.length ? _lastErr : @"failed";
    payload = [NSString stringWithFormat:@"{error:'%@'}", [self jsonEscape:msg]];
  } else {
    // at 用毫秒时间戳交给前端判过期（5 分钟）：壳里存的是「上次定位」，
    // 人在路上移动时旧坐标会把城市定位错，由前端统一口径丢掉更可靠
    double at = [[NSDate date] timeIntervalSince1970] * 1000.0;
    payload = [NSString stringWithFormat:@"{lng:%.6f,lat:%.6f,accuracy:%.1f,at:%.0f}",
               _lastLoc.coordinate.longitude, _lastLoc.coordinate.latitude,
               _lastLoc.horizontalAccuracy, at];
  }

  // 主通道：sendGlobalEvent → Worker 的 GlobalEventEmitter。
  // 为什么不用 globalProps 当主通道：web-core 在 Worker 侧的 updateGlobalProps 是
  // 空函数（lynx-core-chunk 里 `updateGlobalProps(e){}`），而 __globalProps 只在 init
  // 时从 nativeApp 读一次 —— 运行期改 globalProps 进不了 Worker。
  // globalProps 那段保留成 init 期快照：元素早于定位建好时它还能生效，成本为零。
  NSString *js = [NSString stringWithFormat:
      @"(function(){var v=document.querySelector('lynx-view');if(!v)return;"
       "var g=v.globalProps||{};g.__fpLocation=%@;"
       "v.globalProps=g;"
       "try{v.sendGlobalEvent('__fpLocation',[%@]);}catch(e){}"
       "window.__fpLocation=%@;"
       "})()", payload, payload, payload];

  // 为什么要重试而不是注一次就算：lynx-view 的 globalProps setter 内部是
  // `this.#_ = t; this.#e?.updateGlobalProps(t)`，而 #e（LynxViewInstance）在
  // bundle 解码完之前是 undefined —— 那几次写入会被静默丢掉，不报错。
  // 页面刚加载完时实例多半还没好，所以隔一段时间补几次，把这个窗口盖住。
  for (NSNumber *delay in @[@0.0, @0.6, @1.4, @2.6, @4.0, @6.0]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay.doubleValue * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{ [self eval:js]; });
  }
}

/** 单引号包裹的 JS 字面量里，反斜杠和引号要转义，否则一个错误串就能破坏整段脚本 */
- (NSString *)jsonEscape:(NSString *)s {
  NSMutableString *out = [NSMutableString stringWithString:s];
  [out replaceOccurrencesOfString:@"\\" withString:@"\\\\" options:0 range:NSMakeRange(0, out.length)];
  [out replaceOccurrencesOfString:@"'" withString:@"\\'" options:0 range:NSMakeRange(0, out.length)];
  [out replaceOccurrencesOfString:@"\n" withString:@" " options:0 range:NSMakeRange(0, out.length)];
  return out;
}

/**
 * 三方登录回跳。和定位同一个通道问题：业务代码在 Worker 里，
 * window.__fpAuthCallback 读不到，所以回调也走 globalProps。
 */
+ (BOOL)handleURL:(NSURL *)url {
  if (![url.scheme isEqualToString:@"funnyplus"]) return NO;
  // 只认 /auth 这一个入口：分享回跳、深链以后各自加分支，别让任意 scheme 都当登录
  if (![url.host isEqualToString:@"auth"]) return NO;
  NSString *provider = @"wechat";
  NSString *code = @"";
  for (NSURLQueryItem *q in [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO].queryItems) {
    if ([q.name isEqualToString:@"provider"] && q.value.length) provider = q.value;
    else if ([q.name isEqualToString:@"code"] && q.value.length) code = q.value;
  }
  if (!code.length) return NO;
  NSString *js = [NSString stringWithFormat:
      @"(function(){var v=document.querySelector('lynx-view');if(!v)return;"
       "var g=v.globalProps||{};g.__fpAuth={provider:'%@',code:'%@',at:Date.now()};"
       "v.globalProps=g;})()", provider, code];
  [[FPBridge shared] eval:js];
  return YES;
}
@end


/** 系统定位：只要城市级精度，拿一次就停，不做持续定位（持续定位要额外权限说明，且没有场景需要） */
@interface LocationHub : NSObject <CLLocationManagerDelegate>
+ (instancetype)shared;
- (void)start;
@end

@implementation LocationHub {
  CLLocationManager *_mgr;
}

+ (instancetype)shared {
  static LocationHub *inst;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ inst = [LocationHub new]; });
  return inst;
}

- (void)start {
  if (!_mgr) {
    _mgr = [CLLocationManager new];
    _mgr.delegate = self;
    // 公里级足够判城市，精度越高越慢也越费电
    _mgr.desiredAccuracy = kCLLocationAccuracyKilometer;
  }
  CLAuthorizationStatus st = _mgr.authorizationStatus;
  if (st == kCLAuthorizationStatusNotDetermined) {
    // 授权弹窗要等页面出来再要，否则可能挂到没有窗口的时机被丢掉
    [_mgr requestWhenInUseAuthorization];
  } else if (st == kCLAuthorizationStatusDenied || st == kCLAuthorizationStatusRestricted) {
    [[FPBridge shared] pushLocation:nil error:@"denied"];
  } else {
    [_mgr requestLocation];
  }
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  CLAuthorizationStatus st = manager.authorizationStatus;
  if (st == kCLAuthorizationStatusDenied || st == kCLAuthorizationStatusRestricted) {
    [[FPBridge shared] pushLocation:nil error:@"denied"];
  } else if (st == kCLAuthorizationStatusAuthorizedWhenInUse || st == kCLAuthorizationStatusAuthorizedAlways) {
    [manager requestLocation];
  }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  [[FPBridge shared] pushLocation:locations.lastObject error:nil];
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  [[FPBridge shared] pushLocation:nil error:@"failed"];
}
@end

@interface WebHostController : UIViewController <WKNavigationDelegate>
@end

@implementation WebHostController
- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = [UIColor colorWithRed:0.96 green:0.97 blue:1.0 alpha:1.0];

  WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
  NSString *root = [[NSBundle mainBundle] pathForResource:@"web" ofType:nil];
  LocalSchemeHandler *handler = [[LocalSchemeHandler alloc] init];
  handler.root = root;
  // 后端地址可在 Info.plist 里改（真机换成 Mac 的局域网 IP），不用重新打 JS 包
  NSString *apiBase = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"APIBase"];
  handler.apiBase = apiBase.length ? apiBase : @"http://127.0.0.1:8787";
  [cfg setURLSchemeHandler:handler forURLScheme:kScheme];

  WKWebView *web = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:cfg];
  web.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  web.scrollView.scrollEnabled = NO;
  web.scrollView.bounces = NO;
  web.opaque = NO;
  web.backgroundColor = [UIColor clearColor];
  web.navigationDelegate = self;
  if (@available(iOS 16.4, *)) { web.inspectable = YES; }
  [self.view addSubview:web];
  // 注入要等页面有 JS 上下文，先把引用交出去，加载完成后由 didFinish 补一次重放
  [FPBridge shared].web = web;

  [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"app://local/index.html"]]];

  // 定位只要一次性的城市级结果：延后一点，别让授权弹窗压在首屏加载上
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [[LocationHub shared] start];
  });
}

- (void)webViewDidFinishLoad:(WKWebView *)webView { [[FPBridge shared] flush]; }
@end

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation SceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
  if (![scene isKindOfClass:[UIWindowScene class]]) return;
  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  self.window.rootViewController = [[WebHostController alloc] init];
  [self.window makeKeyAndVisible];
}

/** 三方登录回跳入口。SDK 装上后由它的 handleOpenURL 转调这里，现在只认 funnyplus://auth?code= */
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts {
  for (UIOpenURLContext *ctx in URLContexts) {
    [FPBridge handleURL:ctx.URL];
  }
}
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation AppDelegate
@end

int main(int argc, char *argv[]) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class]));
  }
}
