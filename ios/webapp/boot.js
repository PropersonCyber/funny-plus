import '@lynx-js/web-core/client';
// 让 <lynx-view> 起来就能加载同目录的 bundle
const view = document.querySelector('lynx-view');
if (view) view.setAttribute('src', './main.web.bundle');
