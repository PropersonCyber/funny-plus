//
//  FPDataUriImageLoader.m
//  FunnyPlus
//
//  SDWebImage 5.15.5 不认 `data:` URI，而 rspeedy 会把小于 400KB 的图片
//  （lynx.config.ts 的 output.dataUriLimit）全部内联成 data URI 打进 bundle，
//  结果原生端每个 <image> 都静默空白，日志里连报错都没有。
//
//  这里补一个 loader：只接管 data: 前缀的 URL，其余一律放行给后面的 loader。
//  优先级最高（后添加的优先），所以不会挡住真正的网络图。
//

#import <SDWebImage/SDWebImage.h>

@interface FPDataUriImageLoader : NSObject <SDImageLoader>
@end

@implementation FPDataUriImageLoader

- (BOOL)canRequestImageForURL:(nullable NSURL *)url
                      options:(SDWebImageOptions)options
                      context:(nullable SDWebImageContext *)context {
  return [self isDataUri:url];
}

- (BOOL)canRequestImageForURL:(nullable NSURL *)url {
  return [self isDataUri:url];
}

- (nullable id<SDWebImageOperation>)requestImageWithURL:(nullable NSURL *)url
                                                options:(SDWebImageOptions)options
                                                context:(nullable SDWebImageContext *)context
                                               progress:(nullable SDImageLoaderProgressBlock)progressBlock
                                              completed:(nullable SDImageLoaderCompletedBlock)completedBlock {
  if (!completedBlock) return nil;

  NSData *data = [self decodeDataUri:url];
  if (!data.length) {
    completedBlock(nil, nil, [NSError errorWithDomain:@"FPDataUriImageLoader"
                                                 code:-1
                                             userInfo:@{NSLocalizedDescriptionKey: @"无法解析 data URI"}],
                   YES);
    return nil;
  }

  // 交给 SDWebImage 自己的解码栈，后面还要过 processors（圆角、缩略图等）
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    Class<SDImageCoder> coder = [SDImageCodersManager sharedManager];
    UIImage *image = [coder decodedImageWithData:data options:0];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (progressBlock) progressBlock(1, 1, url);
      if (image) {
        completedBlock(image, data, nil, YES);
      } else {
        completedBlock(nil, data,
                       [NSError errorWithDomain:@"FPDataUriImageLoader"
                                           code:-2
                                       userInfo:@{NSLocalizedDescriptionKey: @"data URI 解码失败"}],
                       YES);
      }
    });
  });
  return nil;
}

- (BOOL)shouldBlockFailedURLWithURL:(nonnull NSURL *)url error:(nonnull NSError *)error {
  // data URI 是包内常量，失败就是失败，重试没意义
  return YES;
}

- (BOOL)shouldBlockFailedURLWithURL:(nonnull NSURL *)url
                              error:(nonnull NSError *)error
                            options:(SDWebImageOptions)options
                            context:(nullable SDWebImageContext *)context {
  return YES;
}

#pragma mark - private

- (BOOL)isDataUri:(nullable NSURL *)url {
  return [[url absoluteString] hasPrefix:@"data:"];
}

/** data:[<mediatype>][;base64],<data> —— 目前只需要 base64 这一种 */
- (nullable NSData *)decodeDataUri:(nullable NSURL *)url {
  NSString *s = [url absoluteString];
  NSRange comma = [s rangeOfString:@","];
  if (comma.location == NSNotFound) return nil;

  NSString *meta = [s substringToIndex:comma.location];
  NSString *body = [s substringFromIndex:comma.location + 1];
  if (![meta containsString:@";base64"]) return nil;

  return [[NSData alloc] initWithBase64EncodedString:body
                                             options:NSDataBase64DecodingIgnoreUnknownCharacters];
}

@end

/** 注册入口：App 启动时调一次 */
void FPInstallDataUriImageLoader(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [[SDImageLoadersManager sharedManager] addLoader:[FPDataUriImageLoader new]];
  });
}
