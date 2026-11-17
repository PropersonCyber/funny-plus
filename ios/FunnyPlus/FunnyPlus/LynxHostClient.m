#import "LynxHostClient.h"

// 故意不实现 LynxResourceFetcher 的 required 方法，见头文件。-Wprotocol 只压这一处警告。
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wprotocol"
@implementation LynxHostClient

- (void)lynxView:(LynxView *)view didRecieveError:(NSError *)error {
  if (error && self.onError) self.onError(error);
}

@end
#pragma clang diagnostic pop
