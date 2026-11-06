/**
 * SVG 解码器，补 Lynx 原生端的空缺。
 *
 * Lynx 4.2.0 的 `LynxService/Image` 没有实现 `LynxServiceImageProtocol` 里的
 * `loadSVGImageWithURL:size:contextInfo:completed:`（协议上标的是 @optional），
 * 于是 LynxUIImage 走到 `[self isSVGSource:]` 分支后 `respondsToSelector` 为 NO，
 * 直接上报 `LynxSVGImageErrorDomain Code=30199 "SVG image loader is unavailable."`，
 * 图片位置留白。这个文件就是那个缺失的实现。
 *
 * 覆盖本项目实际用到的 SVG 子集（icons.ts / icons-filled.ts / MapPage 路线图）：
 *   元素  svg / path / circle
 *   属性  viewBox fill stroke stroke-width stroke-dasharray cx cy r opacity
 *   指令  M L H V C S Q T A Z（及对应小写相对形式）
 * 没有 <defs> / <use> / 渐变 / 滤镜 / transform。不写通用实现：
 * 多写的每个分支都是没有数据验证的猜测。
 *
 * 为什么用 runtime 挂而不是 category 头文件：LynxImageService.h 是
 * private_header_files，import 路径依赖 Pods 内部布局；用 class_addMethod
 * 只需要类名和 selector，Pod 升级不会因为头文件搬家而编不过。
 */
#import <UIKit/UIKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <objc/runtime.h>

#pragma mark - 图元模型

@interface FPSVGShape : NSObject
@property(nonatomic, copy) NSString *pathData;
@property(nonatomic) BOOL isCircle;
@property(nonatomic) CGFloat cx, cy, r;
@property(nonatomic, strong) UIColor *fillColor;    // nil = fill:none
@property(nonatomic, strong) UIColor *strokeColor;  // nil = stroke:none
@property(nonatomic) CGFloat strokeWidth;
@property(nonatomic) CGFloat opacity;
/** stroke-dasharray，空数组 = 实线。地图路线用虚线区分「近似路径」 */
@property(nonatomic, strong) NSArray<NSNumber *> *dashArray;
@end

@implementation FPSVGShape
@end

@interface FPSVGDocument : NSObject
@property(nonatomic) CGRect viewBox;
@property(nonatomic, strong) NSArray<FPSVGShape *> *shapes;
@end

@implementation FPSVGDocument
@end

#pragma mark - 颜色与属性解析

static UIColor *FPParseColor(NSString *raw, UIColor *fallback) {
  if (!raw.length) return fallback;
  NSString *v = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (v.length == 0) return fallback;
  if ([v isEqualToString:@"none"]) return nil;
  if ([v caseInsensitiveCompare:@"transparent"] == NSOrderedSame) return nil;
  // currentColor 已在 icon-svg.ts 里替换成具体色值，走到这里说明是漏网的，按继承处理
  if ([v caseInsensitiveCompare:@"currentColor"] == NSOrderedSame) return fallback;

  if ([v hasPrefix:@"#"]) {
    NSString *hex = [v substringFromIndex:1];
    unsigned long long n = 0;
    if (![[NSScanner scannerWithString:hex] scanHexLongLong:&n]) return fallback;
    CGFloat r = 0, g = 0, b = 0, a = 1;
    if (hex.length == 3) {  // #rgb
      r = ((n >> 8) & 0xF) / 15.0;
      g = ((n >> 4) & 0xF) / 15.0;
      b = (n & 0xF) / 15.0;
    } else if (hex.length == 6) {
      r = ((n >> 16) & 0xFF) / 255.0;
      g = ((n >> 8) & 0xFF) / 255.0;
      b = (n & 0xFF) / 255.0;
    } else if (hex.length == 8) {
      r = ((n >> 24) & 0xFF) / 255.0;
      g = ((n >> 16) & 0xFF) / 255.0;
      b = ((n >> 8) & 0xFF) / 255.0;
      a = (n & 0xFF) / 255.0;
    } else {
      return fallback;
    }
    return [UIColor colorWithRed:r green:g blue:b alpha:a];
  }
  if ([v hasPrefix:@"rgb"]) {  // 兜底，目前图标里没有
    NSArray<NSString *> *nums = [[v componentsSeparatedByCharactersInSet:
                                      [NSCharacterSet characterSetWithCharactersInString:@"(), "]]
        filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *s, id _) {
          return s.length > 0;
        }]];
    if (nums.count >= 3) {
      CGFloat r = nums[0].doubleValue / 255.0, g = nums[1].doubleValue / 255.0,
              b = nums[2].doubleValue / 255.0;
      CGFloat a = nums.count >= 4 ? nums[3].doubleValue : 1.0;
      return [UIColor colorWithRed:r green:g blue:b alpha:a];
    }
  }
  return fallback;
}

#pragma mark - path 指令解析

// 一条指令要吃掉的参数个数；0 表示该字母不受支持
static int FPSVGParamCount(char c) {
  switch (c) {
    case 'M':
    case 'm':
    case 'L':
    case 'l':
    case 'T':
    case 't':
      return 2;
    case 'H':
    case 'h':
    case 'V':
    case 'v':
      return 1;
    case 'C':
    case 'c':
      return 6;
    case 'S':
    case 's':
    case 'Q':
    case 'q':
      return 4;
    case 'A':
    case 'a':
      return 7;
    case 'Z':
    case 'z':
      return 0;
    default:
      return -1;
  }
}

typedef struct {
  const char *s;
  size_t len;
  size_t i;
} FPSVGScanner;

static void FPSVGSkipSeparators(FPSVGScanner *sc) {
  while (sc->i < sc->len) {
    char c = sc->s[sc->i];
    if (c == ',' || c == ' ' || c == '\t' || c == '\n' || c == '\r') {
      sc->i++;
    } else {
      break;
    }
  }
}

static BOOL FPSVGScanNumber(FPSVGScanner *sc, double *out) {
  FPSVGSkipSeparators(sc);
  if (sc->i >= sc->len) return NO;
  char *end = NULL;
  double v = strtod(sc->s + sc->i, &end);
  if (end == sc->s + sc->i) return NO;
  sc->i = (size_t)(end - sc->s);
  *out = v;
  return YES;
}

static BOOL FPSVGPeekCommand(FPSVGScanner *sc, char *out) {
  FPSVGSkipSeparators(sc);
  if (sc->i >= sc->len) return NO;
  char c = sc->s[sc->i];
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
    *out = c;
    sc->i++;
    return YES;
  }
  return NO;
}

/**
 * 椭圆弧转三次贝塞尔，按 SVG 规范附录 F.6.5 的端点参数化公式。
 *
 * 图标里的弧大多是圆角（rx == ry），但仍然按通用椭圆处理：只要 large-arc
 * 或 sweep 取反，圆的特例实现就会画成反方向，这种错误在 24px 下很难肉眼发现。
 */
static void FPAppendArc(CGMutablePathRef path, CGPoint from, CGFloat rx, CGFloat ry,
                        CGFloat xAxisRotationDeg, BOOL largeArc, BOOL sweep, CGPoint to) {
  if (rx == 0 || ry == 0) {
    CGPathAddLineToPoint(path, NULL, to.x, to.y);
    return;
  }
  rx = fabs(rx);
  ry = fabs(ry);

  CGFloat phi = xAxisRotationDeg * M_PI / 180.0;
  CGFloat cosPhi = cos(phi), sinPhi = sin(phi);

  // 步骤 1：把端点变换到椭圆坐标系
  CGFloat dx2 = (from.x - to.x) / 2.0;
  CGFloat dy2 = (from.y - to.y) / 2.0;
  CGFloat x1p = cosPhi * dx2 + sinPhi * dy2;
  CGFloat y1p = -sinPhi * dx2 + cosPhi * dy2;

  // 步骤 2：放大半径，保证至少有一组解
  CGFloat lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    CGFloat k = sqrt(lambda);
    rx *= k;
    ry *= k;
  }

  // 步骤 3：求圆心
  CGFloat rx2 = rx * rx, ry2 = ry * ry;
  CGFloat x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  CGFloat denom = rx2 * y1p2 + ry2 * x1p2;
  CGFloat numer = rx2 * ry2 - denom;
  CGFloat coef = (numer <= 0 || denom <= 0) ? 0 : sqrt(numer / denom);
  if (largeArc == sweep) coef = -coef;
  CGFloat cxp = coef * (rx * y1p / ry);
  CGFloat cyp = coef * (-ry * x1p / rx);
  CGFloat cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2.0;
  CGFloat cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2.0;

  // 步骤 4：起止角
  CGFloat ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  CGFloat vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  CGFloat theta1 = atan2(uy, ux);
  CGFloat dTheta = atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * M_PI;
  if (sweep && dTheta < 0) dTheta += 2 * M_PI;

  // 步骤 5：每段最多 90°，拆成贝塞尔
  int segments = (int)ceil(fabs(dTheta) / (M_PI / 2.0));
  if (segments < 1) segments = 1;
  CGFloat delta = dTheta / segments;
  CGFloat t = 4.0 / 3.0 * tan(delta / 4.0);

  CGFloat ang = theta1;
  for (int i = 0; i < segments; i++) {
    CGFloat cosA = cos(ang), sinA = sin(ang);
    CGFloat cosB = cos(ang + delta), sinB = sin(ang + delta);

    CGPoint p1 = CGPointMake(cosA - t * sinA, sinA + t * cosA);
    CGPoint p2 = CGPointMake(cosB + t * sinB, sinB - t * cosB);
    CGPoint p3 = CGPointMake(cosB, sinB);

    // 椭圆坐标系 → 用户坐标系
    CGPoint c1 = CGPointMake(cx + rx * (cosPhi * p1.x) - ry * (sinPhi * p1.y),
                             cy + rx * (sinPhi * p1.x) + ry * (cosPhi * p1.y));
    CGPoint c2 = CGPointMake(cx + rx * (cosPhi * p2.x) - ry * (sinPhi * p2.y),
                             cy + rx * (sinPhi * p2.x) + ry * (cosPhi * p2.y));
    CGPoint e = CGPointMake(cx + rx * (cosPhi * p3.x) - ry * (sinPhi * p3.y),
                            cy + rx * (sinPhi * p3.x) + ry * (cosPhi * p3.y));

    CGPathAddCurveToPoint(path, NULL, c1.x, c1.y, c2.x, c2.y, e.x, e.y);
    ang += delta;
  }
}

static CGPathRef FPCreatePathFromSVGData(NSString *d) {
  if (!d.length) return NULL;
  CGMutablePathRef path = CGPathCreateMutable();

  FPSVGScanner sc = {(const char *)d.UTF8String, strlen(d.UTF8String), 0};
  char cmd = 0;
  double prev[7] = {0};
  CGPoint cur = CGPointZero;
  CGPoint start = CGPointZero;
  // 平滑曲线的控制点镜像：记录上一条 C/S/Q/T 的第二个控制点
  CGPoint lastCubicCtrl = CGPointZero;
  char prevKind = 0;  // 'C' 或 'S' 表示上一条是三次曲线

  while (YES) {
    char next = 0;
    if (FPSVGPeekCommand(&sc, &next)) {
      cmd = next;
    } else if (cmd == 0) {
      break;  // path 必须以指令开头
    } else if (cmd == 'M') {
      cmd = 'L';  // M 后的隐式重复是 L
    } else if (cmd == 'm') {
      cmd = 'l';
    } else if (cmd == 'Z' || cmd == 'z') {
      break;  // Z 之后没有隐式重复
    }

    int need = FPSVGParamCount(cmd);
    if (need <= 0) break;

    int got = 0;
    BOOL truncated = NO;
    while (got < need) {
      if (!FPSVGScanNumber(&sc, &prev[got])) {
        truncated = YES;
        break;
      }
      got++;
    }
    if (truncated) break;

    BOOL rel = (cmd >= 'a' && cmd <= 'z');
    CGFloat ox = rel ? cur.x : 0;
    CGFloat oy = rel ? cur.y : 0;
    char upper = (char)toupper(cmd);

    switch (upper) {
      case 'M': {
        CGPoint p = CGPointMake(ox + prev[0], oy + prev[1]);
        CGPathMoveToPoint(path, NULL, p.x, p.y);
        cur = p;
        start = p;
        prevKind = 0;
        break;
      }
      case 'L': {
        CGPoint p = CGPointMake(ox + prev[0], oy + prev[1]);
        CGPathAddLineToPoint(path, NULL, p.x, p.y);
        cur = p;
        prevKind = 0;
        break;
      }
      case 'H': {
        CGFloat x = ox + prev[0];
        CGPathAddLineToPoint(path, NULL, x, cur.y);
        cur.x = x;
        prevKind = 0;
        break;
      }
      case 'V': {
        CGFloat y = oy + prev[0];
        CGPathAddLineToPoint(path, NULL, cur.x, y);
        cur.y = y;
        prevKind = 0;
        break;
      }
      case 'C':
      case 'S': {
        CGPoint c1, c2, end;
        if (upper == 'C') {
          c1 = CGPointMake(ox + prev[0], oy + prev[1]);
          c2 = CGPointMake(ox + prev[2], oy + prev[3]);
          end = CGPointMake(ox + prev[4], oy + prev[5]);
        } else {
          // S 的第一个控制点是上一条三次曲线控制点关于当前点的镜像
          c1 = (prevKind == 'C' || prevKind == 'S')
                   ? CGPointMake(2 * cur.x - lastCubicCtrl.x, 2 * cur.y - lastCubicCtrl.y)
                   : cur;
          c2 = CGPointMake(ox + prev[0], oy + prev[1]);
          end = CGPointMake(ox + prev[2], oy + prev[3]);
        }
        CGPathAddCurveToPoint(path, NULL, c1.x, c1.y, c2.x, c2.y, end.x, end.y);
        lastCubicCtrl = c2;
        cur = end;
        prevKind = 'C';
        break;
      }
      case 'Q':
      case 'T': {
        CGPoint c, end;
        if (upper == 'Q') {
          c = CGPointMake(ox + prev[0], oy + prev[1]);
          end = CGPointMake(ox + prev[2], oy + prev[3]);
        } else {
          c = (prevKind == 'Q' || prevKind == 'T')
                  ? CGPointMake(2 * cur.x - lastCubicCtrl.x, 2 * cur.y - lastCubicCtrl.y)
                  : cur;
          end = CGPointMake(ox + prev[0], oy + prev[1]);
        }
        CGPathAddQuadCurveToPoint(path, NULL, c.x, c.y, end.x, end.y);
        lastCubicCtrl = c;
        cur = end;
        prevKind = 'Q';
        break;
      }
      case 'A': {
        CGPoint end = CGPointMake(ox + prev[5], oy + prev[6]);
        FPAppendArc(path, cur, prev[0], prev[1], prev[2], prev[3] != 0, prev[4] != 0, end);
        cur = end;
        prevKind = 0;
        break;
      }
      case 'Z': {
        CGPathCloseSubpath(path);
        cur = start;
        prevKind = 0;
        break;
      }
    }
  }

  return path;
}

#pragma mark - SVG 文档解析

@interface FPSVGXMLElement : NSObject
@property(nonatomic, copy) NSString *name;
@property(nonatomic, strong) NSDictionary<NSString *, NSString *> *attrs;
@end
@implementation FPSVGXMLElement
@end

@interface FPSVGXMLParser : NSObject <NSXMLParserDelegate>
@property(nonatomic, strong) NSMutableArray<FPSVGXMLElement *> *elements;
@end

@implementation FPSVGXMLParser
- (instancetype)init {
  if ((self = [super init])) _elements = [NSMutableArray array];
  return self;
}
- (void)parser:(NSXMLParser *)parser
    didStartElement:(NSString *)elementName
       namespaceURI:(NSString *)namespaceURI
      qualifiedName:(NSString *)qName
         attributes:(NSDictionary<NSString *, NSString *> *)attributeDict {
  FPSVGXMLElement *el = [FPSVGXMLElement new];
  el.name = elementName;
  el.attrs = attributeDict ?: @{};
  [self.elements addObject:el];
}
@end

static FPSVGDocument *FPParseSVGDocument(NSString *svg) {
  NSData *data = [svg dataUsingEncoding:NSUTF8StringEncoding];
  if (!data.length) return nil;

  FPSVGXMLParser *delegate = [FPSVGXMLParser new];
  NSXMLParser *parser = [[NSXMLParser alloc] initWithData:data];
  parser.delegate = delegate;
  if (![parser parse] && delegate.elements.count == 0) return nil;

  FPSVGDocument *doc = [FPSVGDocument new];
  doc.viewBox = CGRectMake(0, 0, 24, 24);  // 本项目图标固定 24×24，解析不到再用它兜底

  UIColor *inheritFill = nil;
  UIColor *inheritStroke = nil;
  CGFloat inheritStrokeWidth = 1.0;
  CGFloat docW = 0, docH = 0;
  NSMutableArray<FPSVGShape *> *shapes = [NSMutableArray array];

  for (FPSVGXMLElement *el in delegate.elements) {
    NSDictionary<NSString *, NSString *> *a = el.attrs;

    if ([el.name isEqualToString:@"svg"]) {
      NSString *vb = a[@"viewBox"];
      if (vb.length) {
        NSArray<NSString *> *parts = [[vb componentsSeparatedByCharactersInSet:
                                          [NSCharacterSet characterSetWithCharactersInString:@", "]]
            filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *s, id _) {
              return s.length > 0;
            }]];
        if (parts.count == 4) {
          doc.viewBox = CGRectMake(parts[0].doubleValue, parts[1].doubleValue,
                                   parts[2].doubleValue, parts[3].doubleValue);
        }
      }
      docW = a[@"width"].doubleValue;
      docH = a[@"height"].doubleValue;
      inheritFill = FPParseColor(a[@"fill"], nil);
      inheritStroke = FPParseColor(a[@"stroke"], nil);
      if (a[@"stroke-width"].length) inheritStrokeWidth = a[@"stroke-width"].doubleValue;
      continue;
    }

    if (![el.name isEqualToString:@"path"] && ![el.name isEqualToString:@"circle"]) continue;

    FPSVGShape *shape = [FPSVGShape new];
    // 没写的属性继承 <svg> 上的值，写了才覆盖
    shape.fillColor = [a objectForKey:@"fill"] ? FPParseColor(a[@"fill"], inheritFill) : inheritFill;
    shape.strokeColor =
        [a objectForKey:@"stroke"] ? FPParseColor(a[@"stroke"], inheritStroke) : inheritStroke;
    shape.strokeWidth =
        a[@"stroke-width"].length ? a[@"stroke-width"].doubleValue : inheritStrokeWidth;
    shape.opacity = a[@"opacity"].length ? a[@"opacity"].doubleValue : 1.0;

    if ([el.name isEqualToString:@"circle"]) {
      shape.isCircle = YES;
      shape.cx = a[@"cx"].doubleValue;
      shape.cy = a[@"cy"].doubleValue;
      shape.r = a[@"r"].doubleValue;
    } else {
      shape.pathData = a[@"d"];
    }

    // stroke-dasharray="1.6 1.6" —— 虚线；空格/逗号分隔，奇数个要复制一遍成偶数（SVG 规范）
    NSString *dashRaw = a[@"stroke-dasharray"];
    if (dashRaw.length) {
      NSMutableArray<NSNumber *> *dashes = [NSMutableArray array];
      for (NSString *tok in
           [dashRaw componentsSeparatedByCharactersInSet:
                        [NSCharacterSet characterSetWithCharactersInString:@", "]]) {
        if (tok.length) [dashes addObject:@(tok.doubleValue)];
      }
      if (dashes.count % 2 == 1) [dashes addObjectsFromArray:dashes.copy];
      if (dashes.count) shape.dashArray = dashes;
    }
    [shapes addObject:shape];
  }

  doc.shapes = shapes;
  // width/height 只用来在 targetSize 缺失时兜底，存进 viewBox 之外没有别的用途
  if (docW > 0 && docH > 0 && CGRectEqualToRect(doc.viewBox, CGRectMake(0, 0, 24, 24))) {
    doc.viewBox = CGRectMake(0, 0, docW, docH);
  }
  return doc;
}

#pragma mark - 渲染

static UIImage *FPRenderSVG(NSString *svgText, CGSize targetSize, CGFloat scale) {
  FPSVGDocument *doc = FPParseSVGDocument(svgText);
  if (!doc.shapes.count) return nil;

  CGRect vb = doc.viewBox;
  if (vb.size.width <= 0 || vb.size.height <= 0) return nil;

  CGSize pt = targetSize;
  if (pt.width <= 0 || pt.height <= 0) {
    pt = CGSizeMake(vb.size.width, vb.size.height);  // 布局还没算出尺寸时按 viewBox 出图
  }
  if (scale <= 0) scale = [UIScreen mainScreen].scale;

  CGSize px = CGSizeMake(MAX(1.0, round(pt.width * scale)), MAX(1.0, round(pt.height * scale)));
  UIGraphicsBeginImageContextWithOptions(px, NO, 1.0);  // 尺寸已乘过 scale，这里固定 1.0
  CGContextRef ctx = UIGraphicsGetCurrentContext();
  if (!ctx) {
    UIGraphicsEndImageContext();
    return nil;
  }

  CGContextScaleCTM(ctx, px.width / vb.size.width, px.height / vb.size.height);
  CGContextTranslateCTM(ctx, -vb.origin.x, -vb.origin.y);
  CGContextSetLineCap(ctx, kCGLineCapRound);
  CGContextSetLineJoin(ctx, kCGLineJoinRound);

  for (FPSVGShape *shape in doc.shapes) {
    CGPathRef path = NULL;
    if (shape.isCircle) {
      CGMutablePathRef p = CGPathCreateMutable();
      if (shape.r > 0) {
        CGPathAddEllipseInRect(p, NULL, CGRectMake(shape.cx - shape.r, shape.cy - shape.r,
                                                   shape.r * 2, shape.r * 2));
      }
      path = p;
    } else {
      path = FPCreatePathFromSVGData(shape.pathData);
    }
    if (!path) continue;

    BOOL hasFill = shape.fillColor != nil;
    BOOL hasStroke = shape.strokeColor != nil && shape.strokeWidth > 0;

    CGContextSetAlpha(ctx, MAX(0.0, MIN(1.0, shape.opacity)));

    if (hasFill) {
      CGContextAddPath(ctx, path);
      CGContextSetFillColorWithColor(ctx, shape.fillColor.CGColor);
      CGContextFillPath(ctx);  // 同时清空当前路径
    }
    if (hasStroke) {
      // 描边要在填色之后重新加入路径：FillPath 已经把路径消费掉了
      CGContextAddPath(ctx, path);
      CGContextSetStrokeColorWithColor(ctx, shape.strokeColor.CGColor);
      CGContextSetLineWidth(ctx, shape.strokeWidth);
      if (shape.dashArray.count) {
        CGFloat dashes[shape.dashArray.count];
        for (NSUInteger i = 0; i < shape.dashArray.count; i++) {
          dashes[i] = shape.dashArray[i].doubleValue;
        }
        CGContextSetLineDash(ctx, 0, dashes, shape.dashArray.count);
      }
      CGContextStrokePath(ctx);
    }

    CGPathRelease(path);
  }

  UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();
  return image;
}

#pragma mark - 取 SVG 文本

/** data:image/svg+xml;base64,... 与 data:image/svg+xml;utf8,... 两种写法都要认 */
static NSString *FPSVGTextFromDataURI(NSURL *url) {
  NSString *s = url.absoluteString;
  NSRange comma = [s rangeOfString:@","];
  if (comma.location == NSNotFound) return nil;

  NSString *head = [s substringToIndex:comma.location];
  NSString *body = [s substringFromIndex:comma.location + 1];

  if ([head.lowercaseString containsString:@";base64"]) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:body
                                                       options:NSDataBase64DecodingIgnoreUnknownCharacters];
    return data.length ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  }

  NSString *decoded = [body stringByRemovingPercentEncoding] ?: body;
  return decoded.length ? decoded : nil;
}

static NSString *FPSVGTextForSource(NSURL *url) {
  if (!url) return nil;
  if ([url.scheme isEqualToString:@"data"]) return FPSVGTextFromDataURI(url);
  if (url.isFileURL) return [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:NULL];

  // 打包进 app 的静态资源：Lynx 的约定是 Resource/<name>，落在 bundle 根目录
  NSString *rel = url.absoluteString;
  if ([rel hasPrefix:@"Resource/"]) {
    NSString *name = [rel stringByDeletingPathExtension];
    NSString *ext = [rel pathExtension];
    NSString *path = [[NSBundle mainBundle] pathForResource:name ofType:ext];
    if (path.length) {
      return [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:NULL];
    }
  }
  return nil;
}

#pragma mark - 安装

static NSError *FPSVGError(NSString *message) {
  return [NSError errorWithDomain:@"LynxSVGImageErrorDomain"
                             code:30199
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

/**
 * 承载方法用的小宿主类。
 *
 * 不能用 imp_implementationWithBlock：它要在运行时把 block 拼成 trampoline，
 * 而 `CGSize` 是按值传的结构体参数，手写 type encoding 一旦和实际 ABI 对不上，
 * 调用时寄存器/栈的解读就错位 —— 实测表现是注入后 App 启动即被系统杀掉，
 * 且没有崩溃报告，非常难查。改由编译器为真实方法生成 encoding，再搬到
 * LynxImageService 上，encoding 就一定准确。
 */
@interface FPSVGMethodHost : NSObject
- (void)loadSVGImageWithURL:(id)requestUrl
                       size:(CGSize)size
                contextInfo:(NSDictionary *)contextInfo
                  completed:(void (^)(UIImage *, NSError *, NSURL *))completed;
@end

@implementation FPSVGMethodHost
- (void)loadSVGImageWithURL:(id)requestUrl
                       size:(CGSize)size
                contextInfo:(NSDictionary *)contextInfo
                  completed:(void (^)(UIImage *, NSError *, NSURL *))completed {
  // 同一张图标在不同尺寸下会重复渲染，缓存一下避免反复解析和光栅化
  static NSCache<NSString *, UIImage *> *cache;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cache = [NSCache new];
    cache.countLimit = 128;
  });

  // 收发整体异步：解析 + 光栅化在主线程同步做会卡住首帧
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSURL *url = [requestUrl valueForKey:@"url"];
    NSString *src = url.absoluteString ?: @"";
    UIImage *image = nil;
    NSError *error = nil;

    NSString *cacheKey =
        [NSString stringWithFormat:@"%@|%.0fx%.0f", src, size.width, size.height];
    image = [cache objectForKey:cacheKey];

    if (!image) {
      NSString *svg = FPSVGTextForSource(url);
      if (!svg.length) {
        error = FPSVGError(@"SVG 源无法读取（既不是 data URI，也不在 mainBundle 下）");
      } else {
        image = FPRenderSVG(svg, size, [UIScreen mainScreen].scale);
        if (!image) {
          error = FPSVGError(@"SVG 解析或光栅化失败");
        } else {
          [cache setObject:image forKey:cacheKey];
        }
      }
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      if (completed) completed(image, error, url);
    });
  });
}
@end

void FPInstallSVGImageService(void);

void FPInstallSVGImageService(void) {
  static BOOL installed = NO;
  if (installed) return;
  installed = YES;

  Class cls = NSClassFromString(@"LynxImageService");
  if (!cls) {
    // 没有这个类说明 Podfile 漏了 LynxService/Image，报出来比默默留白强
    NSLog(@"[FunnyPlus] LynxImageService 不存在，SVG 无法渲染");
    return;
  }

  SEL sel = NSSelectorFromString(@"loadSVGImageWithURL:size:contextInfo:completed:");
  if ([cls instancesRespondToSelector:sel]) {
    NSLog(@"[FunnyPlus] SVG loader 已由 SDK 提供，跳过注入");
    return;
  }

  Method donor = class_getInstanceMethod([FPSVGMethodHost class], sel);
  if (!donor) {
    NSLog(@"[FunnyPlus] 找不到可复用的方法签名，SVG 注入失败");
    return;
  }

  BOOL added = class_addMethod(cls, sel, method_getImplementation(donor),
                              method_getTypeEncoding(donor));
  NSLog(@"[FunnyPlus] SVG 解码器注入%@", added ? @"成功" : @"失败（方法已存在）");
}
