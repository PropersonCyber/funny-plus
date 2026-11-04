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
 * 为什么只能往 window 挂全局：本壳没有 Lynx 原生引擎，业务 JS 由 web 渲染器跑在 Worker 里，
 * 壳层拿不到那个 worker。已知限制：window 上的值 Worker 未必读得到（web-core 只对
 * lynx-view 初始的 global-props 做了转发，没有对外开放的运行时更新入口）。
 * 所以前端 geo.ts 读不到就按「没有定位」降级，宁可不出城市，也不猜一个。
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

/**
 * at 用毫秒时间戳交给前端判过期（5 分钟）：壳里存的是「上次定位」，
 * 人在路上移动时旧坐标会把城市定位错，由前端统一口径丢掉更可靠。
 */
- (void)pushLocation:(CLLocation *)loc error:(NSString *)error {
  _lastLoc = loc;
  _lastErr = [error copy];
  _hasResult = YES;
  [self replay];
}

- (void)flush { [self replay]; }

- (void)replay {
  if (!_hasResult) return;
  if (!_lastLoc) {
    // 拒绝和失败分开：前端据此决定是提示去设置里开权限，还是只当没定位
    NSString *msg = _lastErr.length ? _lastErr : @"failed";
    [self eval:[NSString stringWithFormat:
        @"(function(){var l=window.__fpLocation||{};"
         "l.get=function(){return Promise.reject(new Error('%@'));};window.__fpLocation=l;})()", msg]];
    return;
  }
  double at = [[NSDate date] timeIntervalSince1970] * 1000.0;
  [self eval:[NSString stringWithFormat:
      @"(function(){var p={lng:%.6f,lat:%.6f,accuracy:%.1f,at:%.0f};"
       "window.__fpLocation={current:p,get:function(){return Promise.resolve(p);}};})()",
      _lastLoc.coordinate.longitude, _lastLoc.coordinate.latitude,
      _lastLoc.horizontalAccuracy, at]];
}

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
      @"(function(){var f=window.__fpAuthCallback;"
       "if(typeof f==='function')f('%@',{code:'%@'});})()", provider, code];
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
