/** 图像修复算法的固定常量。调参时需以真实照片重新验证。 */
export const RESTORATION_ALGORITHM_VERSION = 'restoration-3';
// 整图预览只需覆盖屏幕显示；原尺寸细节检查和导出仍使用原图像素。
export const PREVIEW_MAX_EDGE = 1280;
export const ANALYSIS_MAX_EDGE = 1024;
export const TILE_SIZE = 512;
export const FILTER_RADIUS = 2;
export const DENOISE_DIAMETER = 5;
export const DENOISE_SIGMA_SPACE = 2;
export const DENOISE_LUMA_SIGMA_COLOR = 30 / 255;
export const DENOISE_CHROMA_SIGMA_COLOR = 70 / 255;
export const DEHAZE_DARK_CHANNEL_SIZE = 15;
export const DEHAZE_GUIDE_RADIUS = 16;
export const DEHAZE_GUIDE_EPSILON = 0.001;
export const DEHAZE_OMEGA = 0.95;
export const DEHAZE_MIN_TRANSMISSION = 0.35;
export const DEHAZE_AIRLIGHT_FLOOR = 0.001;
