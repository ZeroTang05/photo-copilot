import {
  DEHAZE_AIRLIGHT_FLOOR, DEHAZE_DARK_CHANNEL_SIZE, DEHAZE_GUIDE_EPSILON, DEHAZE_GUIDE_RADIUS,
  DEHAZE_MIN_TRANSMISSION, DEHAZE_OMEGA,
} from './constants';
import type { OpenCv } from './opencv';
import type { DehazeAnalysis } from './types';

const clamp = (value: number, lower = 0, upper = 1) => Math.min(upper, Math.max(lower, value));
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const srgb = (value: number) => clamp(value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055);
const luminance = (red: number, green: number, blue: number) => .2126 * red + .7152 * green + .0722 * blue;
const at = (values: ArrayLike<number>, index: number) => values[index] ?? 0;

function oddSize(preferred: number, shortEdge: number) {
  const limit = Math.max(1, shortEdge % 2 === 0 ? shortEdge - 1 : shortEdge);
  return Math.max(1, Math.min(preferred, limit));
}

function oneChannelMat(cv: OpenCv, width: number, height: number, values: Float32Array) {
  const mat = new cv.Mat(height, width, cv.CV_32FC1);
  mat.data32F.set(values);
  return mat;
}

function boxMean(cv: OpenCv, width: number, height: number, values: Float32Array, kernel: number) {
  const source = oneChannelMat(cv, width, height, values);
  const output = new cv.Mat();
  try {
    cv.boxFilter(source, output, cv.CV_32F, new cv.Size(kernel, kernel), new cv.Point(-1, -1), true, cv.BORDER_REFLECT_101);
    return new Float32Array(output.data32F);
  } finally {
    source.delete(); output.delete();
  }
}

/** 从缩小后的原图提取空气光与引导滤波系数；它只依赖原图，可跨滑杆变化复用。 */
export function analyzeDehaze(cv: OpenCv, rgba: Uint8ClampedArray, width: number, height: number): DehazeAnalysis {
  const pixels = width * height;
  const rgb = new Float32Array(pixels * 3);
  const dark = new Float32Array(pixels);
  const guide = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const rgbaIndex = index * 4;
    const channel = index * 3;
    const red = linear(at(rgba, rgbaIndex) / 255), green = linear(at(rgba, rgbaIndex + 1) / 255), blue = linear(at(rgba, rgbaIndex + 2) / 255);
    rgb[channel] = red; rgb[channel + 1] = green; rgb[channel + 2] = blue;
    dark[index] = Math.min(red, green, blue);
    guide[index] = luminance(red, green, blue);
  }

  const kernelSize = oddSize(DEHAZE_DARK_CHANNEL_SIZE, Math.min(width, height));
  const sourceDark = oneChannelMat(cv, width, height, dark);
  const erodedDark = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
  let darkChannel: Float32Array;
  try {
    cv.erode(sourceDark, erodedDark, kernel, new cv.Point(-1, -1), 1, cv.BORDER_REFLECT_101);
    darkChannel = new Float32Array(erodedDark.data32F);
  } finally {
    sourceDark.delete(); erodedDark.delete(); kernel.delete();
  }

  const candidates = Array.from({ length: pixels }, (_, index) => index);
  candidates.sort((left, right) => at(darkChannel, right) - at(darkChannel, left) || left - right);
  const count = Math.max(1, Math.ceil(pixels * .001));
  let airlightIndex = candidates[0]!;
  let brightest = -Infinity;
  for (let offset = 0; offset < count; offset += 1) {
    const index = candidates[offset]!;
    const channel = index * 3;
    const value = luminance(at(rgb, channel), at(rgb, channel + 1), at(rgb, channel + 2));
    if (value > brightest || (value === brightest && index < airlightIndex)) { brightest = value; airlightIndex = index; }
  }
  const airlight: [number, number, number] = [at(rgb, airlightIndex * 3), at(rgb, airlightIndex * 3 + 1), at(rgb, airlightIndex * 3 + 2)];

  const normalized = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const channel = index * 3;
    normalized[index] = Math.min(
      at(rgb, channel) / Math.max(airlight[0], DEHAZE_AIRLIGHT_FLOOR),
      at(rgb, channel + 1) / Math.max(airlight[1], DEHAZE_AIRLIGHT_FLOOR),
      at(rgb, channel + 2) / Math.max(airlight[2], DEHAZE_AIRLIGHT_FLOOR),
    );
  }
  const normalizedMat = oneChannelMat(cv, width, height, normalized);
  const erodedNormalized = new cv.Mat();
  const normalizedKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
  let transmission: Float32Array;
  try {
    cv.erode(normalizedMat, erodedNormalized, normalizedKernel, new cv.Point(-1, -1), 1, cv.BORDER_REFLECT_101);
    transmission = new Float32Array(erodedNormalized.data32F);
  } finally {
    normalizedMat.delete(); erodedNormalized.delete(); normalizedKernel.delete();
  }
  for (let index = 0; index < pixels; index += 1) transmission[index] = clamp(1 - DEHAZE_OMEGA * at(transmission, index));

  const guideSquared = new Float32Array(pixels);
  const guideTransmission = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    guideSquared[index] = at(guide, index) * at(guide, index);
    guideTransmission[index] = at(guide, index) * at(transmission, index);
  }
  const window = oddSize(DEHAZE_GUIDE_RADIUS * 2 + 1, Math.min(width, height));
  const meanGuide = boxMean(cv, width, height, guide, window);
  const meanTransmission = boxMean(cv, width, height, transmission, window);
  const meanGuideSquared = boxMean(cv, width, height, guideSquared, window);
  const meanGuideTransmission = boxMean(cv, width, height, guideTransmission, window);
  const a = new Float32Array(pixels);
  const b = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const variance = Math.max(at(meanGuideSquared, index) - at(meanGuide, index) * at(meanGuide, index), 0);
    a[index] = (at(meanGuideTransmission, index) - at(meanGuide, index) * at(meanTransmission, index)) / (variance + DEHAZE_GUIDE_EPSILON);
    b[index] = at(meanTransmission, index) - at(a, index) * at(meanGuide, index);
  }
  return { width, height, airlight, meanA: boxMean(cv, width, height, a, window), meanB: boxMean(cv, width, height, b, window) };
}

function bilinear(values: Float32Array, width: number, height: number, x: number, y: number) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const right = Math.max(0, Math.min(width - 1, left + 1));
  const bottom = Math.max(0, Math.min(height - 1, top + 1));
  const fx = clamp(x - Math.floor(x)); const fy = clamp(y - Math.floor(y));
  return (at(values, top * width + left) * (1 - fx) + at(values, top * width + right) * fx) * (1 - fy)
    + (at(values, bottom * width + left) * (1 - fx) + at(values, bottom * width + right) * fx) * fy;
}

/** 以完整输出坐标读取分析系数，防止导出分块之间重新估计雾分布。 */
export function reconstructDehaze(
  original: Uint8ClampedArray, processedSrgb: Float32Array, tileWidth: number, centerX: number, centerY: number,
  centerWidth: number, centerHeight: number, outputX: number, outputY: number, outputWidth: number, outputHeight: number, analysis: DehazeAnalysis, strength: number,
) {
  const output = new Uint8ClampedArray(centerWidth * centerHeight * 4);
  for (let y = 0; y < centerHeight; y += 1) for (let x = 0; x < centerWidth; x += 1) {
    const localX = centerX + x, localY = centerY + y;
    const sourceIndex = (localY * tileWidth + localX) * 4;
    const rgbIndex = (localY * tileWidth + localX) * 3;
    const u = (outputX + x + .5) / outputWidth, v = (outputY + y + .5) / outputHeight;
    const analysisX = u * analysis.width - .5, analysisY = v * analysis.height - .5;
    const transmission = clamp(bilinear(analysis.meanA, analysis.width, analysis.height, analysisX, analysisY)
      * luminance(linear(at(original, sourceIndex) / 255), linear(at(original, sourceIndex + 1) / 255), linear(at(original, sourceIndex + 2) / 255))
      + bilinear(analysis.meanB, analysis.width, analysis.height, analysisX, analysisY));
    const safeTransmission = Math.max(transmission, DEHAZE_MIN_TRANSMISSION);
    const target = (y * centerWidth + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const input = linear(at(processedSrgb, rgbIndex + channel));
      const airlight = at(analysis.airlight, channel);
      const candidate = (input - airlight) / safeTransmission + airlight;
      output[target + channel] = Math.round(srgb(input + strength * (candidate - input)) * 255);
    }
    output[target + 3] = 255;
  }
  return output;
}
