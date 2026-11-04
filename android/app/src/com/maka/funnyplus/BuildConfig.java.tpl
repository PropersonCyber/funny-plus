package com.maka.funnyplus;

/** 构建期注入的配置，由 build.sh 生成；__API_BASE__ 会被替换成 real 后端地址 */
public final class BuildConfig {
    public static final String API_BASE = "__API_BASE__";
    /** 指向本机后端视为开发构建：开 WebView 远程调试 */
    public static final boolean DEBUG = API_BASE.contains("127.0.0.1") || API_BASE.isEmpty();
}
