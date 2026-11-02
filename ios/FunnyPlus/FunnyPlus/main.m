#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#define kScheme @"app"

// WKWebView 在 file:// 下 fetch 不到 wasm，用自定义 scheme 当静态文件服务器
@interface LocalSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, copy) NSString *root;
@end

@implementation LocalSchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSString *path = task.request.URL.path;
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

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

@interface WebHostController : UIViewController
@end

@implementation WebHostController
- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = [UIColor colorWithRed:0.96 green:0.97 blue:1.0 alpha:1.0];

  WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
  NSString *root = [[NSBundle mainBundle] pathForResource:@"web" ofType:nil];
  LocalSchemeHandler *handler = [[LocalSchemeHandler alloc] init];
  handler.root = root;
  [cfg setURLSchemeHandler:handler forURLScheme:kScheme];

  WKWebView *web = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:cfg];
  web.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  web.scrollView.scrollEnabled = NO;
  web.scrollView.bounces = NO;
  web.opaque = NO;
  web.backgroundColor = [UIColor clearColor];
  if (@available(iOS 16.4, *)) { web.inspectable = YES; }
  [self.view addSubview:web];

  [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"app://local/index.html"]]];
}
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
