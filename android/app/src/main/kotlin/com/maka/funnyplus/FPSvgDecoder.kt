package com.maka.funnyplus

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.util.Base64
import android.util.Log
import com.facebook.common.references.ResourceReleaser
import com.facebook.imageformat.ImageFormat
import com.facebook.imagepipeline.common.ImageDecodeOptions
import com.facebook.imagepipeline.decoder.ImageDecoder
import com.facebook.imagepipeline.image.CloseableImage
import com.facebook.imagepipeline.image.CloseableStaticBitmap
import com.facebook.imagepipeline.image.EncodedImage
import com.facebook.imagepipeline.image.QualityInfo
import com.lynx.serval.svg.SVGRender
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * 教 Fresco 认识 SVG，补 Lynx 原生端缺的那块，对应 iOS 的 SVG 解码。
 *
 * 为什么挂在 Fresco 解码层而不是 ImageInterceptor / LynxImageFetcher：
 *   那两条都要等 LynxView 建好 TemplateRender 和 LynxContext 才能挂上，而
 *   setImageInterceptor 内部字段为 null 时直接 return、不报错 —— 实测
 *   builder.build() 后立刻调用会被静默丢弃，renderTemplate 后再挂已经来不及。
 *   Fresco 这条在 Application.onCreate 就注册好，没有先后竞争。
 *
 * 业务侧形状：icon-svg.ts 把手写 SVG 编成 `data:image/svg+xml;base64,...` 交给 <image>。
 * Fresco 默认只认 PNG/JPG/WebP，遇到 SVG 报 `ProgressiveDecoder: unknown image format`，
 * Lynx 侧表现为 code=301 loading image failed —— 界面不报错，但图标位置是空的。
 */
class FPSvgDecoder : ImageDecoder {
    override fun decode(
        encodedImage: EncodedImage,
        length: Int,
        qualityInfo: QualityInfo,
        options: ImageDecodeOptions,
    ): CloseableImage? {
        return try {
            val svg = extractSvgText(readAll(encodedImage))
            if (svg.isNullOrEmpty()) return null

            val w = if (encodedImage.width > 0) encodedImage.width else 24
            val h = if (encodedImage.height > 0) encodedImage.height else 24

            val picture = SVGRender().renderPicture(svg, Rect(0, 0, w, h))
            if (picture == null) {
                Log.e(TAG, "SVG 光栅化返回空")
                return null
            }

            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            Canvas(bitmap).drawPicture(picture)
            // bitmap 一旦交给 Fresco 就由它的内存池回收，这里不需要额外释放动作；
            // 最后一个参数是旋转角度，图标不需要
            CloseableStaticBitmap(bitmap, ResourceReleaser<Bitmap> { }, qualityInfo, 0)
        } catch (t: Throwable) {
            Log.e(TAG, "SVG 解码失败", t)
            null
        }
    }

    companion object {
        private const val TAG = "FunnyPlus"

        /** 专属 format：不要复用 UNKNOWN，Fresco 靠 format 区分解码能力 */
        @JvmField
        val SVG_FORMAT: ImageFormat = ImageFormat("SVG", "svg")

        /** data URI 头部前缀；FormatChecker 只读这么多字节用于判定 */
        private const val DATA_PREFIX = "data:image/svg+xml"

        /**
         * Fresco 解码前用它判断「这段字节是不是我的格式」。
         * determineFormat 返回本 format 即认领，返回 null 表示不管。
         */
        @JvmStatic
        fun checker(): ImageFormat.FormatChecker = object : ImageFormat.FormatChecker {
            override fun getHeaderSize(): Int = DATA_PREFIX.length

            override fun determineFormat(headerBytes: ByteArray, headerSize: Int): ImageFormat? {
                if (headerSize <= 0) return null
                val n = minOf(headerSize, headerBytes.size)
                val head = String(headerBytes, 0, n, StandardCharsets.UTF_8).lowercase()
                return if (head.contains("svg")) SVG_FORMAT else null
            }
        }
    }
}

/** EncodedImage 可能只带 InputStream，也可能只带 ByteBuffer，两条都支持 */
private fun readAll(encoded: EncodedImage): String? {
    val input = encoded.inputStream ?: return null
    val out = ByteArrayOutputStream()
    val buf = ByteArray(4096)
    while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        out.write(buf, 0, n)
    }
    return String(out.toByteArray(), StandardCharsets.UTF_8)
}

/** data URI 正文按 base64 / 百分号编码分别解；裸 <svg 直接返回 */
private fun extractSvgText(text: String?): String? {
    if (text == null) return null
    val comma = text.indexOf(',')
    if (comma < 0) {
        return if (text.trim().lowercase().startsWith("<svg")) text else null
    }
    val head = text.substring(0, comma).lowercase()
    if (!head.contains("svg")) return null
    val body = text.substring(comma + 1)
    if (head.contains(";base64")) {
        val raw = Base64.decode(body, Base64.DEFAULT)
        return String(raw, StandardCharsets.UTF_8)
    }
    // 字符串重载从 API 1 就有。Charset 重载要 API 33，minSdk 是 24
    return URLDecoder.decode(body, "UTF-8")
}
