import {
  DENOISE_CHROMA_SIGMA_COLOR, DENOISE_DIAMETER, DENOISE_LUMA_SIGMA_COLOR, DENOISE_SIGMA_SPACE,
} from './constants';
import type { OpenCv } from './opencv';
import type { RestorationParameters } from './types';

const at = (values: Float32Array, index: number) => values[index] ?? 0;

/** 将 RGBA 瓦片转换为 0 到 1 的 sRGB 浮点 RGB，并按两个滑杆独立混合 YCrCb 通道。 */
export function denoiseTile(cv: OpenCv, rgba: Uint8ClampedArray, width: number, height: number, parameters: RestorationParameters): Float32Array {
  const owned: any[] = [];
  const own = <T>(value: T): T => { owned.push(value); return value; };
  try {
    const source = own(new cv.Mat(height, width, cv.CV_8UC4));
    source.data.set(rgba);
    const rgb8 = own(new cv.Mat());
    cv.cvtColor(source, rgb8, cv.COLOR_RGBA2RGB);
    const rgb = own(new cv.Mat());
    rgb8.convertTo(rgb, cv.CV_32FC3, 1 / 255);
    if (parameters.denoiseLuma === 0 && parameters.denoiseChroma === 0) return new Float32Array(rgb.data32F);

    const originalYCrCb = own(new cv.Mat());
    cv.cvtColor(rgb, originalYCrCb, cv.COLOR_RGB2YCrCb);
    const mixed = new Float32Array(originalYCrCb.data32F);

    if (parameters.denoiseLuma > 0) {
      const channels = own(new cv.MatVector());
      cv.split(originalYCrCb, channels);
      const originalLuma = own(channels.get(0));
      const filteredLuma = own(new cv.Mat());
      cv.bilateralFilter(originalLuma, filteredLuma, DENOISE_DIAMETER, DENOISE_LUMA_SIGMA_COLOR, DENOISE_SIGMA_SPACE, cv.BORDER_REFLECT_101);
      const strength = parameters.denoiseLuma / 100;
      for (let index = 0; index < width * height; index += 1) mixed[index * 3] = at(mixed, index * 3) + strength * (at(filteredLuma.data32F, index) - at(mixed, index * 3));
    }

    if (parameters.denoiseChroma > 0) {
      const filteredRgb = own(new cv.Mat());
      cv.bilateralFilter(rgb, filteredRgb, DENOISE_DIAMETER, DENOISE_CHROMA_SIGMA_COLOR, DENOISE_SIGMA_SPACE, cv.BORDER_REFLECT_101);
      const filteredYCrCb = own(new cv.Mat());
      cv.cvtColor(filteredRgb, filteredYCrCb, cv.COLOR_RGB2YCrCb);
      const strength = parameters.denoiseChroma / 100;
      for (let index = 0; index < width * height; index += 1) {
        const channel = index * 3;
        mixed[channel + 1] = at(mixed, channel + 1) + strength * (at(filteredYCrCb.data32F, channel + 1) - at(mixed, channel + 1));
        mixed[channel + 2] = at(mixed, channel + 2) + strength * (at(filteredYCrCb.data32F, channel + 2) - at(mixed, channel + 2));
      }
    }

    const mixedMat = own(new cv.Mat(height, width, cv.CV_32FC3));
    mixedMat.data32F.set(mixed);
    const output = own(new cv.Mat());
    cv.cvtColor(mixedMat, output, cv.COLOR_YCrCb2RGB);
    return new Float32Array(output.data32F);
  } finally {
    for (const item of owned.reverse()) item.delete();
  }
}
