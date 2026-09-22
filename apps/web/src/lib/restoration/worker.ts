import { ANALYSIS_MAX_EDGE, FILTER_RADIUS, PREVIEW_MAX_EDGE, RESTORATION_ALGORITHM_VERSION, TILE_SIZE } from './constants';
import { analyzeDehaze, reconstructDehaze } from './dehaze';
import { denoiseTile } from './denoise';
import { initializeOpenCv } from './opencv';
import type { DehazeAnalysis, RestorationMode, RestorationParameters } from './types';

interface PrepareMessage {
  type: 'prepare'; imageId: string; generation: number; blob: Blob; parameters: RestorationParameters; mode: RestorationMode;
}

type WorkerMessage = PrepareMessage | { type: 'cancel'; generation: number } | { type: 'release'; imageId: string };

const analyses = new Map<string, DehazeAnalysis>();
let newestGeneration = 0;
const workerScope = self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void };

const scaledSize = (width: number, height: number, maxEdge: number) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const cancelled = (generation: number) => generation !== newestGeneration;
const yieldToMessages = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function finite(values: Float32Array) {
  for (const value of values) if (!Number.isFinite(value)) throw new Error('图像处理失败：算法产生了无效像素');
}

async function analysisFor(cv: any, imageId: string, source: OffscreenCanvas) {
  const cached = analyses.get(imageId);
  if (cached) return cached;
  const size = scaledSize(source.width, source.height, ANALYSIS_MAX_EDGE);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!context) throw new Error('图像处理失败：无法创建分析画布');
  context.drawImage(source, 0, 0, size.width, size.height);
  const analysis = analyzeDehaze(cv, context.getImageData(0, 0, size.width, size.height).data, size.width, size.height);
  analyses.set(imageId, analysis);
  return analysis;
}

async function restore(message: PrepareMessage) {
  const cv = await initializeOpenCv();
  if (cancelled(message.generation)) return;
  const bitmap = await createImageBitmap(message.blob, { imageOrientation: 'from-image' });
  try {
    const size = message.mode === 'preview' ? scaledSize(bitmap.width, bitmap.height, PREVIEW_MAX_EDGE) : { width: bitmap.width, height: bitmap.height };
    // 去雾系数始终从完整原图缩到 1024 计算。预览大小不会改变空气光估计。
    const fullSource = new OffscreenCanvas(bitmap.width, bitmap.height);
    const fullContext = fullSource.getContext('2d', { colorSpace: 'srgb' });
    if (!fullContext) throw new Error('图像处理失败：无法读取原图');
    fullContext.drawImage(bitmap, 0, 0);
    const source = new OffscreenCanvas(size.width, size.height);
    const sourceContext = source.getContext('2d', { colorSpace: 'srgb' });
    if (!sourceContext) throw new Error('图像处理失败：无法读取原图');
    sourceContext.drawImage(fullSource, 0, 0, size.width, size.height);
    const analysis = message.parameters.dehaze > 0 ? await analysisFor(cv, message.imageId, fullSource) : undefined;
    if (cancelled(message.generation)) return;

    const output = new OffscreenCanvas(size.width, size.height);
    const outputContext = output.getContext('2d', { colorSpace: 'srgb' });
    if (!outputContext) throw new Error('图像处理失败：无法创建输出画布');
    for (let top = 0; top < size.height; top += TILE_SIZE) for (let left = 0; left < size.width; left += TILE_SIZE) {
      const width = Math.min(TILE_SIZE, size.width - left), height = Math.min(TILE_SIZE, size.height - top);
      const readLeft = Math.max(0, left - FILTER_RADIUS), readTop = Math.max(0, top - FILTER_RADIUS);
      const readRight = Math.min(size.width, left + width + FILTER_RADIUS), readBottom = Math.min(size.height, top + height + FILTER_RADIUS);
      const readWidth = readRight - readLeft, readHeight = readBottom - readTop;
      const raw = sourceContext.getImageData(readLeft, readTop, readWidth, readHeight);
      const processed = denoiseTile(cv, raw.data, readWidth, readHeight, message.parameters);
      finite(processed);
      const centerX = left - readLeft, centerY = top - readTop;
      const pixels = analysis
        ? reconstructDehaze(raw.data, processed, readWidth, centerX, centerY, width, height, left, top, size.width, size.height, analysis, message.parameters.dehaze / 100)
        : (() => {
          const result = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
            const from = ((centerY + y) * readWidth + centerX + x) * 3;
            const to = (y * width + x) * 4;
            result[to] = Math.round(Math.min(1, Math.max(0, processed[from] ?? 0)) * 255);
            result[to + 1] = Math.round(Math.min(1, Math.max(0, processed[from + 1] ?? 0)) * 255);
            result[to + 2] = Math.round(Math.min(1, Math.max(0, processed[from + 2] ?? 0)) * 255);
            result[to + 3] = 255;
          }
          return result;
        })();
      outputContext.putImageData(new ImageData(pixels, width, height), left, top);
      await yieldToMessages();
      if (cancelled(message.generation)) return;
    }
    const outputBitmap = output.transferToImageBitmap();
    if (cancelled(message.generation)) { outputBitmap.close(); return; }
    workerScope.postMessage({ type: 'complete', imageId: message.imageId, generation: message.generation, width: size.width, height: size.height, algorithmVersion: RESTORATION_ALGORITHM_VERSION, bitmap: outputBitmap }, [outputBitmap]);
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === 'cancel') { newestGeneration = Math.max(newestGeneration, message.generation); return; }
  if (message.type === 'release') { analyses.delete(message.imageId); return; }
  newestGeneration = Math.max(newestGeneration, message.generation);
  void restore(message).catch((error: unknown) => {
    if (!cancelled(message.generation)) workerScope.postMessage({ type: 'error', imageId: message.imageId, generation: message.generation, message: error instanceof Error ? error.message : String(error) });
  });
};
