declare module '@lynx-js/types' {
  interface GlobalProps {
    /**
     * 宿主注入的定位结果。壳层通过 `lynx-view.globalProps` 写，
     * 业务代码（跑在 Worker 里）从 `lynx.__globalProps` 读。
     *
     * 不能往 window 上挂：web 渲染器把业务 JS 放进 Worker 跑，Worker 的
     * globalThis 是 WorkerGlobalScope，看不到主线程的 window。
     */
    __fpLocation?: {
      lng: number;
      lat: number;
      accuracy?: number;
      /** 定位时刻（毫秒时间戳），前端据此判过期 */
      at?: number;
      /** 没有坐标时的原因：denied = 用户拒绝 / failed = 其他失败 */
      error?: string;
    };
  }
}

// This export makes the file a module
export {};
