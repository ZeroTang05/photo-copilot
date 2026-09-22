import type { MaskRef } from '@photo-copilot/domain';

export interface MaskAsset {
  imageId: string;
  sourceVersion: number;
  width: number;
  height: number;
  pixels: Uint8Array;
  version: number;
  origin: 'sam3' | 'brush';
}

export interface MaskMetrics {
  bbox: { x: number; y: number; width: number; height: number };
  areaRatio: number;
}

/**
 * 只在浏览器内保存蒙版的不可变版本。编辑状态只带 MaskRef，历史记录不会重复复制大像素数组。
 */
export class MaskAssetStore {
  private readonly assets = new Map<string, Map<number, MaskAsset>>();

  create(input: Omit<MaskAsset, 'version'>): MaskRef {
    const assetId = crypto.randomUUID();
    this.assets.set(assetId, new Map([[1, { ...input, pixels: input.pixels.slice(), version: 1 }]]));
    return { assetId, version: 1 };
  }

  get(ref: MaskRef): MaskAsset {
    const asset = this.assets.get(ref.assetId)?.get(ref.version);
    if (!asset) throw new Error('蒙版资源已丢失，请重新识别选区');
    return asset;
  }

  /** 画笔生成一个同 assetId 的新版本，旧版本仍可供撤销和重做使用。 */
  paint(ref: MaskRef, points: Array<{ x: number; y: number }>, radius: number, operation: 'add' | 'erase'): MaskRef {
    if (points.length === 0) return ref;
    const source = this.get(ref);
    const pixels = source.pixels.slice();
    const rx = Math.max(1, radius * source.width);
    const ry = Math.max(1, radius * source.height);
    for (const point of points) {
      const cx = point.x * source.width;
      const cy = point.y * source.height;
      const left = Math.max(0, Math.floor(cx - rx));
      const right = Math.min(source.width - 1, Math.ceil(cx + rx));
      const top = Math.max(0, Math.floor(cy - ry));
      const bottom = Math.min(source.height - 1, Math.ceil(cy + ry));
      for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
        const distance = Math.hypot((x + .5 - cx) / rx, (y + .5 - cy) / ry);
        if (distance <= 1) pixels[y * source.width + x] = operation === 'add' ? 255 : 0;
      }
    }
    const versions = this.assets.get(ref.assetId)!;
    const version = Math.max(...versions.keys()) + 1;
    versions.set(version, { ...source, pixels, version, origin: 'brush' });
    return { assetId: ref.assetId, version };
  }

  releaseImage(imageId: string) {
    for (const [assetId, versions] of this.assets) {
      const first = versions.values().next().value as MaskAsset | undefined;
      if (first?.imageId === imageId) this.assets.delete(assetId);
    }
  }
}

/** 从 SAM 返回的透明 PNG 中提取 alpha 通道；像素不会再依赖上游临时 URL。 */
export async function alphaFromMaskPng(blob: Blob, expectedWidth: number, expectedHeight: number): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  if (blob.size > 8 * 1024 * 1024) throw new Error('单个 SAM 蒙版超过 8 MiB 限制');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) throw new Error('SAM 蒙版尺寸与输入图片不一致');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法读取蒙版像素');
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = rgba[index * 4 + 3]!;
    return { width: canvas.width, height: canvas.height, pixels };
  } finally { bitmap.close(); }
}

export function maskMetrics(width: number, height: number, pixels: Uint8Array): MaskMetrics {
  let left = width, top = height, right = -1, bottom = -1, area = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (pixels[y * width + x]! > 0) {
    area += 1; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return {
    bbox: right < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height },
    areaRatio: area / pixels.length,
  };
}
