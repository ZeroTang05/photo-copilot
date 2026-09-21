import * as UTIF from 'utif2';
import libRawWasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';

const RAW_EXTENSIONS = new Set(['arw', 'cr2', 'cr3', 'dng', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2', 'srw', 'x3f']);
const TIFF_EXTENSIONS = new Set(['tif', 'tiff']);
const BROWSER_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export const photoFileAccept = [
  ...BROWSER_IMAGE_TYPES,
  'image/tiff',
  '.tif,.tiff,.dng,.arw,.cr2,.cr3,.nef,.nrw,.orf,.pef,.raf,.raw,.rw2,.srw,.x3f',
].join(',');

function extensionOf(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupportedPhotoFile(file: File) {
  const extension = extensionOf(file);
  return RAW_EXTENSIONS.has(extension) || TIFF_EXTENSIONS.has(extension) || file.type === 'image/tiff' || BROWSER_IMAGE_TYPES.has(file.type);
}

/** 将解码后的 RGBA 像素规范化为浏览器画布可继续处理的 PNG。 */
async function rgbaToPng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片规范化失败')), 'image/png');
  });
}

/**
 * LibRaw 遇到局部损坏的 RAW 时，少数相机会返回长度正确但内容错位的像素。
 * 用抽样的相邻像素差识别这种条纹数据，避免将绿色乱码交给画布渲染。
 */
function hasPlausibleRawPixels(data: Uint8Array, width: number, height: number, channels: number) {
  const rowStep = Math.max(1, Math.floor(height / 64));
  const columnStep = Math.max(1, Math.floor(width / 64));
  let differenceTotal = 0;
  let channelCount = 0;
  for (let row = 0; row < height; row += rowStep) {
    for (let column = 1; column < width; column += columnStep) {
      const current = (row * width + column) * channels;
      const previous = current - channels;
      for (let channel = 0; channel < 3; channel += 1) {
        differenceTotal += Math.abs(data[current + channel]! - data[previous + channel]!);
        channelCount += 1;
      }
    }
  }
  return channelCount > 0 && differenceTotal / channelCount < 45;
}

/** 尝试读取相机保存的 JPEG 预览；它能在主 RAW 数据损坏时保留可编辑照片。 */
async function embeddedRawPreview(decoder: import('@colorhythm/libraw-wasm').LibRaw): Promise<Blob | undefined> {
  try {
    decoder.unpackThumb();
    const preview = decoder.dcrawMakeMemThumb();
    if (preview.type_ !== 'LIBRAW_IMAGE_JPEG' || preview.data.length < 4 || preview.data[0] !== 0xff || preview.data[1] !== 0xd8) return undefined;
    return new Blob([preview.data], { type: 'image/jpeg' });
  } catch {
    return undefined;
  }
}

/** TIFF 通过 UTIF 解码为 RGBA 像素，选择第一个可显示的画面。 */
async function decodeTiff(file: File) {
  const source = await file.arrayBuffer();
  const ifd = UTIF.decode(source).find((candidate) => {
    try {
      UTIF.decodeImage(source, candidate);
      return candidate.width > 0 && candidate.height > 0;
    } catch {
      return false;
    }
  });
  if (!ifd) throw new Error('TIFF 中没有可编辑的图片画面');
  return rgbaToPng(new Uint8ClampedArray(UTIF.toRGBA8(ifd)), ifd.width, ifd.height);
}

/**
 * LibRaw 在浏览器内完成 RAW 的去马赛克、相机白平衡和 sRGB 输出。
 * 仅在选择 RAW 文件时动态加载 WebAssembly，普通图片不会下载该解码器。
 */
async function decodeRaw(file: File) {
  const { LibRaw } = await import('@colorhythm/libraw-wasm');
  await LibRaw.initialize(fetch(libRawWasmUrl));
  const decoder = new LibRaw();
  await decoder.waitUntilReady();
  try {
    decoder.open(await file.arrayBuffer());
    const embeddedPreview = await embeddedRawPreview(decoder);
    decoder.setUseCameraWb(1);
    decoder.setOutputColor(1); // LibRaw 的 sRGB 输出。
    decoder.setOutputBps(8);
    decoder.unpack();
    decoder.dcrawProcess();
    const image = decoder.dcrawMakeMemImage();
    if (image.type_ !== 'LIBRAW_IMAGE_BITMAP' || image.bits !== 8 || image.colors < 3) {
      if (embeddedPreview) return embeddedPreview;
      throw new Error('此 RAW 相机无法输出可编辑的 RGB 图片');
    }
    const pixelCount = image.width * image.height;
    if (image.data.length < pixelCount * image.colors || !hasPlausibleRawPixels(image.data, image.width, image.height, image.colors)) {
      if (embeddedPreview) return embeddedPreview;
      throw new Error('RAW 主图数据损坏，且没有可用的相机内嵌预览图');
    }
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      const source = index * image.colors;
      const target = index * 4;
      rgba[target] = image.data[source]!;
      rgba[target + 1] = image.data[source + 1]!;
      rgba[target + 2] = image.data[source + 2]!;
      rgba[target + 3] = 255;
    }
    return rgbaToPng(rgba, image.width, image.height);
  } finally {
    decoder.dispose();
  }
}

/** 根据文件格式选择浏览器原生、TIFF 或 RAW 解码路径。 */
export async function decodePhotoFile(file: File): Promise<Blob> {
  const extension = extensionOf(file);
  if (RAW_EXTENSIONS.has(extension)) return decodeRaw(file);
  if (TIFF_EXTENSIONS.has(extension) || file.type === 'image/tiff') return decodeTiff(file);
  if (BROWSER_IMAGE_TYPES.has(file.type)) return file;
  throw new Error('仅支持 JPEG、PNG、WebP、AVIF、GIF、TIFF 或相机 RAW 图片');
}
