/** 图像修复算法的固定常量。调参时需以真实照片重新验证。 */
export const RESTORATION_ALGORITHM_VERSION = 'restoration-1';
export const PREVIEW_MAX_EDGE = 2048;
export const ANALYSIS_MAX_EDGE = 1024;
export const TILE_SIZE = 512;
export const FILTER_RADIUS = 2;
export const DENOISE_DIAMETER = 5;
export const DENOISE_SIGMA_SPACE = 1.5;
export const DENOISE_LUMA_SIGMA_COLOR = 12 / 255;
export const DENOISE_CHROMA_SIGMA_COLOR = 35 / 255;
export const DEHAZE_DARK_CHANNEL_SIZE = 15;
export const DEHAZE_GUIDE_RADIUS = 16;
export const DEHAZE_GUIDE_EPSILON = 0.001;
export const DEHAZE_OMEGA = 0.95;
export const DEHAZE_MIN_TRANSMISSION = 0.15;
export const DEHAZE_AIRLIGHT_FLOOR = 0.001;

