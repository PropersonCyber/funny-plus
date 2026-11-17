#import <Foundation/Foundation.h>
#import <Lynx/LynxViewClient.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * LynxView 的错误回调。
 *
 * 不能写成 Swift 类直接遵循 LynxViewClient：这个协议继承了 LynxResourceFetcher，
 * 其中 loadResourceWithURL:type:completion: 是 required。Swift 不实现就编不过；
 * 实现了 respondsToSelector 就是 YES。setClient: 会把 client 同时塞给 resourceFetcher，
 * 于是资源请求进空实现，不再走 SDK 默认加载。
 * ObjC 可以只实现 didRecieveError:，required 方法保持「未实现」，和原来的宿主一致。
 */
@interface LynxHostClient : NSObject <LynxViewClient>
@property(nonatomic, copy, nullable) void (^onError)(NSError *error);
@end

NS_ASSUME_NONNULL_END
