package com.maka.funnyplus

import android.app.Application
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.decoder.ImageDecoderConfig
import com.lynx.service.image.LynxImageService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter

/**
 * Lynx 运行时必须在任何 LynxView 创建之前完成初始化。
 *
 * 放在 Application 而不是 Activity：LynxView 构造时会去查 LynxEnv 的 so 加载状态，
 * 在 Activity 里 init 的话，同一进程内第二次进页面就可能拿到半初始化的 env。
 *
 * 顺序不能反：先把 Fresco（含 SVG 解码）配好、注册 LynxImageService，再 init LynxEnv。
 * LynxImageService 内部用的就是 Fresco 的管线，晚配就拿到旧的那份。
 *
 * LynxEnv.init 的 loader / provider / behaviorBundle 传 null = 用 SDK 默认实现。
 * UI 元素集合不在这里给：这份只管 native 侧，元素要在 LynxViewBuilder 上挂。
 */
class FPApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initLynxService()
        LynxEnv.inst().init(this, null, null, null)
    }

    /** 图片服务：Lynx 自己不做 http 解码，缺了它 <image src="https://..."> 全是空白 */
    private fun initLynxService() {
        // 在解码能力里加一条 SVG：业务图标都是 data:image/svg+xml，
        // Fresco 默认只认 PNG/JPG/WebP，不补这里图标位就是空的（见 FPSvgDecoder）
        val decoderConfig = ImageDecoderConfig.Builder()
            .addDecodingCapability(FPSvgDecoder.SVG_FORMAT, FPSvgDecoder.checker(), FPSvgDecoder())
            .build()

        Fresco.initialize(
            this,
            ImagePipelineConfig.newBuilder(this)
                .setImageDecoderConfig(decoderConfig)
                .build(),
        )
        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
    }
}
