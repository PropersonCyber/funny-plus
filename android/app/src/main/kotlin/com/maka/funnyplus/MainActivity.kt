package com.maka.funnyplus

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.view.Window
import android.widget.Toast
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
import com.lynx.tasm.TemplateData
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.BuiltInBehavior
import com.lynx.tasm.behavior.BuiltInUIRegistry
import com.lynx.xelement.XElementBehaviors
import java.io.ByteArrayOutputStream
import java.io.IOException

/**
 * 安卓壳：原生 LynxView 宿主，加载随包的 main.lynx.bundle。
 *
 * 为什么不再用 WebView + web-core（旧实现见 git 历史）：
 *   Web 渲染下 NativeModules / Custom Element 都不存在，定位只能靠注入字符串改
 *   globalProps，拿不到回调也没有错误码。改用原生 LynxView 之后两端跑同一个引擎
 *   （iOS 的 Podfile.lock 也是 4.2.0），后续接 Native Module 才有落点。
 */
class MainActivity : Activity() {
    private var lynxView: LynxView? = null
    private var lastBackAt = 0L
    private var locationAsked = false
    private val timeoutHandler = Handler(Looper.getMainLooper())
    private val timeoutTask = Runnable { pushLocationError("failed") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)

        val builder = LynxViewBuilder()
        // 三套行为都要挂，少任何一套都会掉元素（实测）：
        //   BuiltInBehavior    —— view / text / scroll-view / list 等 12 种基础 tag
        //   BuiltInUIRegistry  —— image / inline-image，**不在** BuiltInBehavior 里，
        //                         漏了就是 603 Can't find ui tag，最后 9902 崩在 image
        //   XElementBehaviors  —— svg / input / textarea / video 等扩展 tag
        val behaviors = ArrayList<Behavior>(BuiltInBehavior().create())
        behaviors.addAll(BuiltInUIRegistry.getInstance().builtInUIBehaviors.values)
        behaviors.addAll(XElementBehaviors().create())
        builder.setBehaviors(behaviors)

        val view = builder.build(this)
        view.addLynxViewClient(HostClient())
        view.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        view.setBackgroundColor(0xFFF5F8FF.toInt())
        lynxView = view
        setContentView(view)

        // 后端地址必须走 globalProps，不能塞进 TemplateData。
        // TemplateData 是 initData（对应 useInitData），而前端读的是 useGlobalProps ——
        // 放错袋子等于没给，fetch 会拿到空 base 变成相对路径，原生端没有 origin 直接失败
        // （实测：城市页逆地理一直是 status=offline）。
        val globalProps = HashMap<String, Any>()
        globalProps["__fpApiBase"] = BuildConfig.API_BASE

        val bytes = readAsset(BUNDLE_ASSET)
        if (bytes == null) {
            Toast.makeText(this, "缺少 $BUNDLE_ASSET", Toast.LENGTH_LONG).show()
            return
        }
        view.renderTemplate(bytes, TemplateData.fromMap(globalProps))
        // 渲染之后再写一次：renderTemplate 之前 updateGlobalProps 在部分时序下会被丢弃
        view.updateGlobalProps(globalProps)

        // 页面起来后再要定位：权限弹窗压在首屏上会让人以为卡住了
        Handler(Looper.getMainLooper()).postDelayed({ startLocation() }, 600)
    }

    /** 读 assets 里的 bundle；失败只留日志不抛 —— 界面已经在了，缺 bundle 属打包问题 */
    private fun readAsset(name: String): ByteArray? {
        return try {
            assets.open(name).use { input ->
                val out = ByteArrayOutputStream(input.available())
                val buf = ByteArray(8192)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
        } catch (e: IOException) {
            Log.e(TAG, "读不到 assets/$name", e)
            null
        }
    }

    /**
     * 定位注入走 updateGlobalProps，和 iOS 的 updateGlobalPropsWithDictionary 是同一条
     * 通道，前端 geo.ts / hostBridge.ts 不需要区分平台。
     *
     * 只取一次：城市级判断不需要持续定位，Android 上持续定位还要额外说明后台用途。
     */
    private fun startLocation() {
        trace("startLocation asked=$locationAsked")
        if (locationAsked) return
        locationAsked = true
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                arrayOf(
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                ),
                REQ_LOCATION,
            )
            return
        }
        requestOneShotLocation()
    }

    private fun requestOneShotLocation() {
        trace("requestOneShot")
        val lm = getSystemService(LOCATION_SERVICE) as? LocationManager
        if (lm == null) {
            pushLocationError("failed")
            return
        }

        // 有不算旧的缓存直接用：城市级判断不值得等 GPS 冷启动
        var best: Location? = null
        try {
            for (provider in lm.getProviders(true)) {
                val location = lm.getLastKnownLocation(provider) ?: continue
                if (best == null || location.time > best.time) best = location
            }
        } catch (_: SecurityException) {
            // 权限刚被撤销：下面主动请求那条路会再判一次
        }
        val cached = best
        if (cached != null && System.currentTimeMillis() - cached.time < LOCATION_STALE_MS) {
            pushLocation(cached)
            return
        }

        val provider = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            LocationManager.NETWORK_PROVIDER
        } else {
            LocationManager.GPS_PROVIDER
        }
        try {
            lm.requestLocationUpdates(
                provider,
                0,
                0f,
                object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        // 拿一次就摘监听：持续定位对出行 app 没有必须常驻的理由
                        lm.removeUpdates(this)
                        timeoutHandler.removeCallbacks(timeoutTask)
                        pushLocation(location)
                    }
                },
                Looper.getMainLooper(),
            )
        } catch (_: Exception) {
            pushLocationError("failed")
            return
        }
        // 超时给明确失败，别让前端那 8 秒轮询一直挂着。
        // 但这个任务必须能撤：拿到坐标后如果不撤，5 秒后会把成功结果覆盖成
        // error=failed，前端于是把「已定位」又降级成「没有定位」（实测踩过）
        timeoutHandler.postDelayed(timeoutTask, LOCATION_TIMEOUT_MS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_LOCATION) return
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) {
            requestOneShotLocation()
        } else {
            // 拒绝和失败分开：前端据此决定提示去设置，还是只当没有定位
            pushLocationError("denied")
        }
    }

    private fun pushLocation(location: Location) {
        trace("pushLocation ${location.longitude},${location.latitude}")
        val loc = HashMap<String, Any>()
        loc["lng"] = location.longitude
        loc["lat"] = location.latitude
        loc["accuracy"] = location.accuracy
        // 毫秒时间戳：前端按 5 分钟判过期
        loc["at"] = System.currentTimeMillis()
        pushLocationProps(loc)
    }

    /**
     * 两条通道都发。
     *
     * 实测只发 updateGlobalProps 时，原生侧拿到了坐标、JS 侧的 useGlobalPropsChanged
     * 一次都没回调 —— 那条路在部分渲染模式下不会把变更推给 React 层。
     * sendGlobalEvent 走 rLynxChange，是显式事件通道，前端用 GlobalEventEmitter 订阅
     * （见 lynx/src/App/index.tsx）。
     */
    private fun pushLocationProps(loc: Map<String, Any>) {
        val view = lynxView ?: return
        val props = HashMap<String, Any>()
        props["__fpLocation"] = loc
        view.updateGlobalProps(props)

        val payload = HashMap<String, Any>()
        payload["__fpLocation"] = loc
        view.sendGlobalEvent("__fpLocation", JavaOnlyArray.of(JavaOnlyMap.from(payload)))
    }

    private fun pushLocationError(reason: String) {
        trace("pushError $reason")
        val loc = HashMap<String, Any>()
        loc["error"] = reason
        pushLocationProps(loc)
    }

    private fun trace(msg: String) {
        Log.d(TAG, "[loc] $msg")
    }

    override fun onResume() {
        super.onResume()
        trace("resume asked=$locationAsked view=${lynxView != null}")
    }

    /** 返回键：Lynx 页面是单页应用、没有可退的导航栈，用安卓标准的两次返回退出 */
    @Deprecated("Activity.onBackPressed")
    override fun onBackPressed() {
        val now = System.currentTimeMillis()
        if (now - lastBackAt > BACK_WINDOW_MS) {
            lastBackAt = now
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show()
            return
        }
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onDestroy() {
        lynxView?.destroy()
        lynxView = null
        super.onDestroy()
    }

    /** 渲染错误留痕。SVG 解码不在这里：它挂在 Fresco 的解码配置里（见 FPSvgDecoder） */
    private class HostClient : LynxViewClient() {
        override fun onReceivedError(error: LynxError?) {
            if (error == null) return
            Log.e(TAG, "lynx error code=${error.errorCode} ${error.summaryMessage}")
        }

        override fun onLoadFailed(url: String?) {
            Log.e(TAG, "lynx load failed: $url")
        }
    }

    companion object {
        private const val TAG = "FunnyPlus"
        private const val BUNDLE_ASSET = "web/main.lynx.bundle"
        private const val BACK_WINDOW_MS = 2000L

        /** 定位权限回调用固定 requestCode 区分（目前只有这一个） */
        private const val REQ_LOCATION = 1001

        /** 超过这个年龄的坐标当没有：壳存的是上次结果，人移动后会把城市定错 */
        private const val LOCATION_STALE_MS = 5 * 60 * 1000L

        /** 主动要一次位置最多等多久，超时明确报失败，别让前端干等 */
        private const val LOCATION_TIMEOUT_MS = 5000L
    }
}
