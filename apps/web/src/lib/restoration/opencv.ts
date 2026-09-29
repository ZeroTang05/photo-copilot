import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url';

/** OpenCV 的类型声明很大；Worker 只使用这里列出的稳定运行时能力。 */
export type OpenCv = any;

let runtime: Promise<OpenCv> | undefined;

/**
 * 在 module Worker 中加载同源 OpenCV 脚本。脚本将 cv 安装到 Worker 的 globalThis。
 */
async function loadOpenCvScript() {
  const response = await fetch(opencvUrl);
  if (!response.ok) throw new Error(`OpenCV 初始化失败：资源请求返回 ${response.status}`);
  const source = await response.text();
  const scriptUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
  try {
    await import(/* @vite-ignore */ scriptUrl);
  } finally {
    URL.revokeObjectURL(scriptUrl);
  }
}

/** 在 module Worker 内按需加载 OpenCV，默认编辑不会下载算法资源。 */
export function initializeOpenCv(): Promise<OpenCv> {
  runtime ??= (async () => {
    await loadOpenCvScript();
    const loaded = (self as typeof globalThis & { cv?: unknown }).cv;
    if (!loaded) throw new Error('OpenCV 初始化失败：未找到运行时');
    const cv = typeof loaded === 'function'
      ? await (loaded as () => OpenCv | Promise<OpenCv>)()
      : await loaded as OpenCv;
    const required = ['Mat', 'cvtColor', 'bilateralFilter', 'erode', 'boxFilter', 'resize', 'split', 'merge'];
    for (const name of required) if (typeof cv[name] !== 'function') throw new Error(`OpenCV 初始化失败：缺少 ${name}`);
    return cv;
  })();
  return runtime;
}
