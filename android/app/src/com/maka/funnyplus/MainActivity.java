package com.maka.funnyplus;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 安卓壳：WebView 加载随包的 web 运行时（和 iOS 壳同一份 main.web.bundle）。
 *
 * 为什么不用 file:// —— 业务 JS 里的 fetch 在 file:// 下会被当成不透明源，wasm 也加载不了。
 * 安卓没有 WKURLSchemeHandler 那种自定义 scheme，所以把 assets 挂在一个 https 虚拟域下：
 * 页面拿到的是正常的安全源，fetch / wasm / localStorage 全部可用。
 *
 * GET /api/* 由原生转发。POST 的 body 拿不到（WebView 不把请求体交给 shouldInterceptRequest），
 * 所以写操作（收藏 / 打卡）在壳里必然失败 —— 前端会照实弹「网络不通」，
 * 不会出现「界面显示已收藏但其实没写进去」这种假成功。
 */
public class MainActivity extends Activity {

    /** 虚拟域名，只用于给 assets 一个安全的源，不产生真实网络请求 */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_ORIGIN = "https://" + ASSET_HOST;
    private static final String ASSET_PREFIX = ASSET_ORIGIN + "/assets/";

    /** 两次返回之间的窗口；超过就当作一次新的误触 */
    private static final long BACK_WINDOW_MS = 2000;

    /** 真后端地址：对应 iOS 的 Info.plist APIBase，打包时用 --api 覆盖 */
    private String apiBase = "http://127.0.0.1:8787";

    private WebView web;
    private long lastBackAt = 0;

    /** 定位只取一次城市级结果；权限回调用固定 requestCode 区分（现在只有这一个） */
    private static final int REQ_LOCATION = 1001;
    /** 超过这个年龄的坐标当没有：壳存的是上次结果，人在路上移动会把城市定错 */
    private static final long LOCATION_STALE_MS = 5 * 60 * 1000L;
    /** 主动要一次位置最多等多久，超时就明确报失败，别让前端挂着 */
    private static final long LOCATION_TIMEOUT_MS = 5000L;

    private boolean locationAsked = false;
    private boolean locationResolved = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        String fromBuild = BuildConfig.API_BASE;
        if (fromBuild != null && !fromBuild.isEmpty()) apiBase = fromBuild;

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(245, 248, 255));
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.startsWith(ASSET_ORIGIN)) {
                    String path = req.getUrl().getPath();
                    if (path != null && path.startsWith("/api/")) return proxyApi(req);
                    return serveAsset(req);
                }
                return null;
            }
        });

        setContentView(web);
        web.loadUrl(ASSET_PREFIX + "index.html");

        // 页面起来后再要定位权限：弹窗压在首屏加载上会让人以为卡住了
        web.postDelayed(this::startLocation, 600);
        deliverAuthCallback(getIntent());
    }

    /** assets/web/ 下的静态文件；路径越界一律 404，不给壳外的读权限 */
    private WebResourceResponse serveAsset(WebResourceRequest req) {
        String path = req.getUrl().getPath();
        if (path == null) return notFound("no path");

        String rel = path.startsWith("/assets/") ? path.substring("/assets/".length()) : "";
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) return notFound("bad path");

        try {
            InputStream in = getAssets().open("web/" + rel);
            return new WebResourceResponse(mimeOf(rel), null, 200, "OK",
                    headers("Access-Control-Allow-Origin", "*", "Cache-Control", "no-cache"), in);
        } catch (IOException e) {
            return notFound(rel);
        }
    }

    /**
     * GET /api/* 转给真后端，页面侧看到的是同源 URL，省掉 CORS。
     * 非 GET 直接给 405：body 拿不到，转发过去只会变成空请求体，不如让前端明确失败。
     */
    private WebResourceResponse proxyApi(WebResourceRequest req) {
        if (!"GET".equals(req.getMethod())) {
            return json(405, "{\"error\":\"壳内不支持写操作\"}");
        }

        String path = req.getUrl().getPath();
        String query = req.getUrl().getQuery();
        String target = apiBase + path + (query != null && !query.isEmpty() ? "?" + query : "");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            InputStream resp = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String type = conn.getContentType();
            return new WebResourceResponse(
                    type != null ? type.split(";")[0] : "application/json",
                    "utf-8", code, conn.getResponseMessage(),
                    headers("Access-Control-Allow-Origin", "*"), resp);
        } catch (Exception e) {
            // 后端没起或不可达：给前端明确的 503，让它走随包种子的降级路径
            return json(503, "{\"error\":\"后端不可达\"}");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * 业务 JS 跑在 Web Worker 里（Lynx web 运行时的工作线程），主线程的 window 上没有它的页面栈，
     * 所以原生问不到「现在是不是在详情页」。WebView 自己也没有历史可退（单页应用）。
     * 与其让一次误按就把应用退到桌面、看起来像崩了，不如用安卓标准的两次返回退出。
     */
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackAt > BACK_WINDOW_MS) {
            lastBackAt = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }

    /**
     * 定位注入。**必须写 lynx-view.globalProps，不能挂 window**：
     * 业务 JS 跑在 Web Worker 里，Worker 的 globalThis 看不到主线程 window，
     * 往 window 挂值在 Worker 里永远读不到（之前就是这么写的，定位一直没生效）。
     * globalProps 的 setter 会走 updateGlobalProps → backgroundThread，是官方跨线程通道。
     */
    private void startLocation() {
        if (locationAsked) return;
        locationAsked = true;
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION}, REQ_LOCATION);
            return;
        }
        requestOneShotLocation();
    }

    private void requestOneShotLocation() {
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) {
            injectLocationError("failed");
            return;
        }

        // 有不算旧的缓存就直接用：城市级判断不需要等 GPS 冷启动
        Location best = null;
        try {
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (SecurityException ignored) {
            // 权限在这一瞬间被撤销，往下走主动请求的路径会再判一次
        }
        if (best != null && System.currentTimeMillis() - best.getTime() < LOCATION_STALE_MS) {
            injectLocation(best);
            return;
        }

        String provider = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                ? LocationManager.NETWORK_PROVIDER : LocationManager.GPS_PROVIDER;
        try {
            lm.requestLocationUpdates(provider, 0, 0, new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    // 拿一次就摘掉监听：持续定位要额外说明权限用途，这个 app 没有那种场景
                    lm.removeUpdates(this);
                    injectLocation(location);
                }
            }, Looper.getMainLooper());
        } catch (Exception e) {
            injectLocationError("failed");
            return;
        }

        new Handler(Looper.getMainLooper()).postDelayed(() -> injectLocationError("failed"), LOCATION_TIMEOUT_MS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_LOCATION) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) requestOneShotLocation();
        else injectLocationError("denied");
    }

    private void injectLocation(Location l) {
        if (locationResolved) return;
        locationResolved = true;
        injectJs("(function(){var v=document.querySelector('lynx-view');if(!v)return;"
                + "var g=v.globalProps||{};"
                + "g.__fpLocation={lng:" + l.getLongitude() + ",lat:" + l.getLatitude()
                + ",accuracy:" + l.getAccuracy() + ",at:" + System.currentTimeMillis() + "};"
                + "g.__fpOpenSettings=function(){location.href='app://local/settings';};"
                + "v.globalProps=g;})()");
    }

    private void injectLocationError(String reason) {
        if (locationResolved) return;
        locationResolved = true;
        injectJs("(function(){var v=document.querySelector('lynx-view');if(!v)return;"
                + "var g=v.globalProps||{};g.__fpLocation={error:'" + reason + "'};"
                + "g.__fpOpenSettings=function(){location.href='app://local/settings';};"
                + "v.globalProps=g;})()");
    }
    /** 三方登录回跳：funnyplus://auth?provider=wechat&code=xxx，和 iOS 的 handleURL 同一口径 */
    @Override

    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverAuthCallback(intent);
    }

    private void deliverAuthCallback(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri == null) return;
        // 只认 /auth：分享回跳、深链以后各自加分支，别让任意 scheme 都当登录
        if (!"funnyplus".equals(uri.getScheme()) || !"auth".equals(uri.getHost())) return;
        String provider = uri.getQueryParameter("provider");
        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty()) return;
        if (provider == null || provider.isEmpty()) provider = "wechat";
        injectJs("(function(){var v=document.querySelector('lynx-view');if(!v)return;"
                + "var g=v.globalProps||{};g.__fpAuth={provider:'" + provider + "',code:'" + code + "',at:Date.now()};"
                + "v.globalProps=g;})()");
    }

    private void injectJs(String js) {
        WebView w = web;
        if (w == null) return;
        w.post(() -> {
            try {
                w.evaluateJavascript(js, null);
            } catch (Exception ignored) {
                // 页面还没就绪：这几种注入都是「有最好、没有也能用」，不抛到调用方
            }
        });
    }

    private static WebResourceResponse json(int code, String body) {
        return new WebResourceResponse("application/json", "utf-8", code, "x",
                headers("Access-Control-Allow-Origin", "*"),
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse notFound(String detail) {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(),
                new ByteArrayInputStream(("not found: " + detail).getBytes(StandardCharsets.UTF_8)));
    }

    private static Map<String, String> headers(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static String mimeOf(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".wasm")) return "application/wasm";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
