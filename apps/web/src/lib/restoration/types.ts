import type { GlobalKey } from '@photo-copilot/domain';

export type RestorationMode = 'preview' | 'detail' | 'export';

export type RestorationParameters = Pick<Record<GlobalKey, number>, 'dehaze' | 'denoiseLuma' | 'denoiseChroma'>;

export interface RestorationRequest {
  imageId: string;
  generation: number;
  blob: Blob;
  parameters: RestorationParameters;
  mode: RestorationMode;
}

export interface RestorationResult {
  imageId: string;
  generation: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface DehazeAnalysis {
  width: number;
  height: number;
  airlight: readonly [number, number, number];
  meanA: Float32Array;
  meanB: Float32Array;
}

export const hasRestoration = (parameters: RestorationParameters) => parameters.dehaze > 0 || parameters.denoiseLuma > 0 || parameters.denoiseChroma > 0;

