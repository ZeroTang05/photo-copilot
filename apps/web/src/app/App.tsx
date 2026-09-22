import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as UTIF from 'utif2';
import { applyChanges, changedSummary, createInitialState, defaultGlobal, SCHEMA_VERSION, type EditState, type GlobalKey, type PlanPayload, type Region } from '@photo-copilot/domain';
import type { PlanRequest, SegmentIntent, SegmentResponse } from '@photo-copilot/ai-contract';
import { PhotoRenderer } from '@photo-copilot/renderer';
import { activeSlot, useEditor } from '../state/editor';
import { TopBar, type ExportFormat } from './TopBar';
import { ThumbnailSidebar } from './ThumbnailSidebar';
import { ControlsPanel } from './ControlsPanel';
import { CopilotPanel } from './CopilotPanel';
import { decodePhotoFile, isSupportedPhotoFile } from '../lib/image-import';
import { restorationClient } from '../lib/restoration/client';
import { hasRestoration, type RestorationMode, type RestorationParameters } from '../lib/restoration/types';
import { alphaFromMaskPng, maskMetrics, MaskAssetStore } from '../lib/masks';

function uid() { return crypto.randomUUID(); }

const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_IMAGE_EDGE = 16_384;
const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;
const CANVAS_EXPORT_FORMATS = {
  jpeg: { mime: 'image/jpeg' as const, extension: 'jpg', label: 'JPEG', quality: 0.92 },
  png: { mime: 'image/png' as const, extension: 'png', label: 'PNG', quality: 1 },
  webp: { mime: 'image/webp' as const, extension: 'webp', label: 'WebP', quality: 0.92 },
  avif: { mime: 'image/avif' as const, extension: 'avif', label: 'AVIF', quality: 0.92 },
};

interface ReferencePhoto {
  name: string;
  blob: Blob;
  thumbnail: string;
}

interface DetailPreview {
  original: string;
  processed: string;
}

interface SamCandidate {
  candidateId: string;
  imageId: string;
  sourceVersion: number;
  query: string | null;
  displayLabel: string;
  maskRef: { assetId: string; version: number };
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number };
  areaRatio: number;
}

// 旋转时取能完全填满当前画幅的最大内接矩形，避免边角复制或拉伸。
function rotationAutoCropScale(sourceWidth: number, sourceHeight: number, crop: EditState['transform']['crop'], angleDeg: number) {
  const cropAspect = (sourceWidth * crop.width) / (sourceHeight * crop.height);
  const radians = angleDeg * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return Math.min(cropAspect / (cosine * cropAspect + sine), 1 / (sine * cropAspect + cosine));
}

async function imageDimensions(source: Blob) {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

async function normalizedBlob(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片规范化失败')), 'image/png');
  });
}

async function thumbnailFromBlob(blob: Blob, maxEdge = 240): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function previewFromBlob(blob: Blob, maxEdge: number, quality = .85) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG 编码失败')), 'image/jpeg', quality);
  }).then((jpeg) => ({ blob: jpeg, width: canvas.width, height: canvas.height }));
}

async function toBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PhotoRenderer | undefined>(undefined);
  const renderedImageIdRef = useRef<string | undefined>(undefined);
  const renderSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const restorationGenerationRef = useRef(0);
  const maskStoreRef = useRef(new MaskAssetStore());
  const currentSlot = useEditor((state) => activeSlot(state));
  const images = useEditor((state) => state.images);
  const activeIndex = useEditor((state) => state.activeIndex);
  const candidate = useEditor((state) => state.candidate);
  const commit = useEditor((state) => state.commit);
  const beginInteraction = useEditor((state) => state.beginInteraction);
  const preview = useEditor((state) => state.preview);
  const endInteraction = useEditor((state) => state.endInteraction);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const setCandidate = useEditor((state) => state.setCandidate);
  const reset = useEditor((state) => state.reset);
  const addImage = useEditor((state) => state.addImage);
  const setActiveIndex = useEditor((state) => state.setActiveIndex);
  const removeImage = useEditor((state) => state.removeImage);

  const state = currentSlot?.state;

  const [status, setStatus] = useState('导入一张图片开始编辑');
  const [instruction, setInstruction] = useState('');
  const [referencePhoto, setReferencePhoto] = useState<ReferencePhoto>();
  const [allowComposition, setAllowComposition] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [activeBrushRegionId, setActiveBrushRegionId] = useState<string>();
  const [activeRasterPaint, setActiveRasterPaint] = useState<{ regionId: string; operation: 'add' | 'erase' }>();
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [isComparing, setIsComparing] = useState(false);
  const [detailPreview, setDetailPreview] = useState<DetailPreview>();
  const [samCandidates, setSamCandidates] = useState<SamCandidate[]>([]);
  const [pointSegmentationSupported, setPointSegmentationSupported] = useState(false);
  const [pointSelectionActive, setPointSelectionActive] = useState(false);
  const [pointDraft, setPointDraft] = useState<Array<{ x: number; y: number; label: 0 | 1 }>>([]);

  const controllerRef = useRef<AbortController | undefined>(undefined);
  const pointRevisionRef = useRef(0);
  const brushStrokeRef = useRef<{ regionId: string; dabs: Array<{ x: number; y: number }>; last?: { x: number; y: number } } | undefined>(undefined);
  const rasterStrokeRef = useRef<{ regionId: string; operation: 'add' | 'erase'; points: Array<{ x: number; y: number }>; last?: { x: number; y: number } } | undefined>(undefined);
  const dragDepthRef = useRef(0);

  /** 为 AI 与导出取得原尺寸修复图；零值直接解码原始规范化 Blob。 */
  const prepareFullBitmap = useCallback(async (slot: NonNullable<typeof currentSlot>, editState: EditState, mode: RestorationMode) => {
    const parameters: RestorationParameters = {
      dehaze: editState.global.dehaze,
      denoiseLuma: editState.global.denoiseLuma,
      denoiseChroma: editState.global.denoiseChroma,
    };
    if (!hasRestoration(parameters)) return createImageBitmap(slot.blob, { imageOrientation: 'from-image' });
    const generation = ++restorationGenerationRef.current;
    restorationClient.cancel(generation);
    const result = await restorationClient.prepare({ imageId: editState.imageId, generation, blob: slot.blob, parameters, mode });
    return result.bitmap;
  }, []);

  const displayState = useMemo<EditState | undefined>(() => {
    if (!state) return undefined;
    if (candidate && candidate.baseRevision === state.revision) {
      try {
        return applyChanges(state, candidate.payload.changes!, allowComposition);
      } catch {
        return state;
      }
    }
    return state;
  }, [state, candidate, allowComposition]);

  // 对比时使用原始纹理和归零参数，其他时候可显示 AI 候选的预处理结果。
  const renderState = isComparing && state ? { ...state, global: defaultGlobal(), regions: [] } : displayState;
  const restorationParameters = useMemo<RestorationParameters>(() => ({
    dehaze: isComparing ? 0 : displayState?.global.dehaze ?? 0,
    denoiseLuma: isComparing ? 0 : displayState?.global.denoiseLuma ?? 0,
    denoiseChroma: isComparing ? 0 : displayState?.global.denoiseChroma ?? 0,
  }), [displayState?.global.dehaze, displayState?.global.denoiseChroma, displayState?.global.denoiseLuma, isComparing]);

  const draw = useCallback(() => {
    if (!renderState || renderedImageIdRef.current !== renderState.imageId || !rendererRef.current || !canvasRef.current) return;
    const parent = canvasRef.current.parentElement;
    const availableWidth = (parent?.clientWidth ?? 900) * 0.92;
    const availableHeight = (parent?.clientHeight ?? 600) * 0.87;
    const aspect = (renderState.sourceWidth * renderState.transform.crop.width) / (renderState.sourceHeight * renderState.transform.crop.height);
    const width = Math.min(availableWidth, availableHeight * aspect);
    renderSizeRef.current = { width, height: width / aspect };
    for (const region of renderState.regions) if (region.shape === 'raster') rendererRef.current.setMask(region.maskRef, maskStoreRef.current.get(region.maskRef));
    rendererRef.current.render(renderState, width, width / aspect);
  }, [renderState]);

  useEffect(() => { draw(); }, [draw]);
  // 面板显隐会改变画布可用空间，等浏览器完成本次布局后再按新尺寸重绘。
  useEffect(() => {
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [bottomPanelOpen, draw, leftPanelOpen, rightPanelOpen]);

  useEffect(() => {
    const handler = () => draw();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [draw]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== 'z') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redo, undo]);

  // 公开 Demo 当前没有点选蒙版接口。只有网关明确宣布可用时才展示点选入口。
  useEffect(() => {
    void fetch('/api/segment-capabilities').then(async (response) => response.ok ? response.json() as Promise<{ pointSegmentation?: boolean }> : { pointSegmentation: false })
      .then((capabilities) => setPointSegmentationSupported(capabilities.pointSegmentation === true)).catch(() => setPointSegmentationSupported(false));
  }, []);

  // 组件卸载时释放当前的 WebGL 资源；切换图片时由下方效果在新图就绪后替换它。
  useEffect(() => () => { rendererRef.current?.dispose(); restorationClient.dispose(); }, []);

  // 先在后台解码新图，确认可用后才替换画布。旧图保持原样，避免切换时闪烁。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!currentSlot) {
      rendererRef.current?.dispose();
      rendererRef.current = undefined;
      renderedImageIdRef.current = undefined;
      canvas.width = 1;
      canvas.height = 1;
      setActiveBrushRegionId(undefined);
      setActiveRasterPaint(undefined);
      return;
    }
    const imageId = currentSlot.state.imageId;
    let cancelled = false;
    const generation = ++restorationGenerationRef.current;
    restorationClient.cancel(generation);
    void (async () => {
      if (hasRestoration(restorationParameters)) {
        setStatus('正在准备图像处理');
        return restorationClient.prepare({ imageId, generation, blob: currentSlot.blob, parameters: restorationParameters, mode: 'preview' });
      }
      const bitmap = await createImageBitmap(currentSlot.blob, { imageOrientation: 'from-image' });
      return { imageId, generation, bitmap, width: bitmap.width, height: bitmap.height };
    })().then((result) => {
      const { bitmap } = result;
      if (cancelled) { bitmap.close(); return; }
      const previous = rendererRef.current;
      const renderer = new PhotoRenderer(canvas);
      renderer.loadBitmap(bitmap);
      for (const region of currentSlot.state.regions) if (region.shape === 'raster') renderer.setMask(region.maskRef, maskStoreRef.current.get(region.maskRef));
      if (cancelled) { renderer.dispose(); return; }
      rendererRef.current = renderer;
      renderedImageIdRef.current = imageId;
      previous?.dispose();
      draw();
      if (hasRestoration(restorationParameters)) setStatus('图像处理已更新');
    }).catch((error: unknown) => {
      if (!cancelled) setStatus(`图像处理失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; };
  }, [currentSlot?.blob, currentSlot?.state.imageId, restorationParameters]); // eslint-disable-line react-hooks/exhaustive-deps

  // 删除照片或离开页面时释放对应的去雾分析系数缓存。
  useEffect(() => {
    const imageId = currentSlot?.state.imageId;
    return () => { if (imageId) { restorationClient.releaseImage(imageId); maskStoreRef.current.releaseImage(imageId); } };
  }, [currentSlot?.state.imageId]);

  const handleFit = useCallback(() => { setZoom(100); draw(); }, [draw]);

  const handleCompareStart = useCallback(() => {
    if (state) setIsComparing(true);
  }, [state]);

  const handleCompareEnd = useCallback(() => {
    setIsComparing(false);
  }, []);

  const handleImport = async (file: File) => {
    if (!isSupportedPhotoFile(file)) { setStatus('仅支持 JPEG、PNG、WebP、AVIF、GIF、TIFF 或相机 RAW 图片'); return; }
    if (file.size > MAX_SOURCE_FILE_BYTES) { setStatus('图片超过 100 MiB 限制'); return; }
    try {
      setStatus('正在浏览器内解码和规范化图片');
      const decoded = await decodePhotoFile(file);
      const dimensions = await imageDimensions(decoded);
      if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS || dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE || dimensions.width < 64 || dimensions.height < 64) {
        throw new Error('图片尺寸需在 64 像素至 1 亿像素以内，单边不超过 16384 像素');
      }
      const blob = await normalizedBlob(decoded);
      const next = createInitialState(uid(), dimensions.width, dimensions.height);
      const thumbnail = await thumbnailFromBlob(blob);
      addImage({
        blob,
        name: file.name.replace(/\.[^.]+$/, ''),
        thumbnail,
        state: next,
      });
      setInstruction('');
      setStatus('本地编辑已就绪。关闭或刷新页面会结束当前会话');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图片无法解码');
    }
  };

  // 批量导入按顺序解码，避免多张高像素照片同时占用大量内存。
  const handleImports = (files: File[]) => {
    void (async () => {
      for (const file of files) await handleImport(file);
      if (files.length > 1) setStatus(`已导入 ${files.length} 张图片，可在左侧切换编辑`);
    })();
  };

  /** 参考图只用于 AI 理解目标风格，不会加入当前编辑队列。 */
  const handleReferenceImport = async (file: File) => {
    if (!isSupportedPhotoFile(file)) { setStatus('参考图格式不受支持'); return; }
    if (file.size > MAX_SOURCE_FILE_BYTES) { setStatus('参考图超过 100 MiB 限制'); return; }
    try {
      controllerRef.current?.abort();
      setStatus('正在准备参考图');
      const decoded = await decodePhotoFile(file);
      const dimensions = await imageDimensions(decoded);
      if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS || dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE || dimensions.width < 64 || dimensions.height < 64) {
        throw new Error('参考图尺寸需在 64 像素至 1 亿像素以内，单边不超过 16384 像素');
      }
      const blob = await normalizedBlob(decoded);
      const thumbnail = await thumbnailFromBlob(blob, 160);
      setReferencePhoto({ name: file.name, blob, thumbnail });
      setCandidate();
      setStatus('参考图已添加。AI 会参考它的色彩与氛围');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '参考图无法解码');
    }
  };

  const handleGlobalChange = (key: GlobalKey, value: number, transient = false) => {
    if (!state || candidate) return;
    controllerRef.current?.abort();
    const next = { ...state, global: { ...state.global, [key]: value } };
    if (transient) preview(next);
    else commit(next);
  };

  const handleTransformChange = (patch: Partial<EditState['transform']>, transient = false) => {
    if (!state || candidate) return;
    const next = { ...state, transform: { ...state.transform, ...patch } };
    if (transient) preview(next);
    else commit(next);
  };

  const handleAspectLockChange = (value: EditState['transform']['aspectLock']) => {
    if (!state || candidate) return;
    const ratios: Record<EditState['transform']['aspectLock'], number | undefined> = {
      free: undefined,
      original: state.sourceWidth / state.sourceHeight,
      square: 1,
      portrait4x5: 4 / 5,
      landscape3x2: 3 / 2,
      wide16x9: 16 / 9,
    };
    const ratio = ratios[value];
    const crop = { ...state.transform.crop };
    if (ratio) {
      const imageRatio = state.sourceWidth / state.sourceHeight;
      const currentRatio = (crop.width * imageRatio) / crop.height;
      if (currentRatio > ratio) crop.width = Math.min(crop.height * ratio / imageRatio, 1);
      else crop.height = Math.min(crop.width * imageRatio / ratio, 1);
      crop.x = Math.min(Math.max(0, crop.x), 1 - crop.width);
      crop.y = Math.min(Math.max(0, crop.y), 1 - crop.height);
    }
    commit({ ...state, transform: { ...state.transform, aspectLock: value, crop } });
  };

  const handleCropChange = (key: 'x' | 'y' | 'width' | 'height', value: number, transient = false) => {
    if (!state || candidate) return;
    const crop = { ...state.transform.crop, [key]: value };
    crop.width = Math.min(crop.width, 1 - crop.x);
    crop.height = Math.min(crop.height, 1 - crop.y);
    const next = { ...state, transform: { ...state.transform, crop } };
    if (transient) preview(next);
    else commit(next);
  };

  const handleAddRegion = (shape: Region['shape'] = 'ellipse', mode: Region['mode'] = 'inside') => {
    if (!state || candidate) return;
    if (state.regions.length === 4) { setStatus('局部区域最多四个'); return; }
    const region = {
      id: uid(),
      label: `局部区域 ${state.regions.length + 1}`,
      enabled: true,
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.2,
      radiusY: 0.2,
      feather: 0.35,
      mode,
      shape,
      angleDeg: 0,
      brushRadius: 0.06,
      brushDabs: [],
      adjustments: { exposureEV: 0, highlights: 0, saturation: 0 },
    } as Region;
    commit({ ...state, regions: [...state.regions, region] });
    if (shape === 'brush') setActiveBrushRegionId(region.id);
  };

  const handleUpdateRegion = (nextRegion: Region, transient = false) => {
    if (!state || candidate) return;
    const next = { ...state, regions: state.regions.map((region) => region.id === nextRegion.id ? nextRegion : region) };
    if (transient) preview(next);
    else commit(next);
    if (activeBrushRegionId === nextRegion.id && nextRegion.shape !== 'brush') setActiveBrushRegionId(undefined);
  };

  const handleDeleteRegion = (regionId: string) => {
    if (!state || candidate) return;
    commit({ ...state, regions: state.regions.filter((region) => region.id !== regionId) });
    if (activeBrushRegionId === regionId) setActiveBrushRegionId(undefined);
  };

  const pointFromCanvasEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !state) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const crop = state.transform.crop;
    const cropAspect = (state.sourceWidth * crop.width) / (state.sourceHeight * crop.height);
    const autoScale = rotationAutoCropScale(state.sourceWidth, state.sourceHeight, crop, state.transform.angleDeg);
    const centeredX = (((event.clientX - rect.left) / rect.width) - .5) * autoScale * cropAspect;
    const centeredY = (((event.clientY - rect.top) / rect.height) - .5) * autoScale;
    const angle = state.transform.angleDeg * Math.PI / 180;
    const x = crop.x + crop.width * .5 + ((Math.cos(angle) * centeredX + Math.sin(angle) * centeredY) / cropAspect) * crop.width;
    const y = crop.y + crop.height * .5 + (-Math.sin(angle) * centeredX + Math.cos(angle) * centeredY) * crop.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  const appendBrushDab = (point: { x: number; y: number }) => {
    const stroke = brushStrokeRef.current;
    if (!stroke || !state) return;
    const region = state.regions.find((item) => item.id === stroke.regionId);
    if (!region || region.shape !== 'brush') return;
    const minimumDistance = region.brushRadius * .3;
    if (stroke.last && Math.hypot(point.x - stroke.last.x, point.y - stroke.last.y) < minimumDistance) return;
    if (stroke.dabs.length >= 32) return;
    stroke.dabs.push(point); stroke.last = point;
  };

  const handleBrushPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || candidate) return;
    if (pointSelectionActive) {
      const point = pointFromCanvasEvent(event);
      if (!point || pointDraft.length >= 16) return;
      const next = [...pointDraft, { ...point, label: event.shiftKey ? 0 as const : 1 as const }];
      setPointDraft(next);
      void requestPointSegmentation(next);
      event.preventDefault();
      return;
    }
    if (activeRasterPaint) {
      const region = state.regions.find((item) => item.id === activeRasterPaint.regionId);
      const point = pointFromCanvasEvent(event);
      if (!region || region.shape !== 'raster' || !point) return;
      rasterStrokeRef.current = { regionId: region.id, operation: activeRasterPaint.operation, points: [point], last: point };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      return;
    }
    if (!activeBrushRegionId) return;
    const region = state.regions.find((item) => item.id === activeBrushRegionId);
    const point = pointFromCanvasEvent(event);
    if (!region || region.shape !== 'brush' || !point) return;
    brushStrokeRef.current = { regionId: region.id, dabs: [...region.brushDabs], last: undefined };
    appendBrushDab(point);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleBrushPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rasterStroke = rasterStrokeRef.current;
    if (rasterStroke) {
      const point = pointFromCanvasEvent(event);
      if (point && (!rasterStroke.last || Math.hypot(point.x - rasterStroke.last.x, point.y - rasterStroke.last.y) >= .01)) { rasterStroke.points.push(point); rasterStroke.last = point; }
      return;
    }
    if (!brushStrokeRef.current) return;
    const point = pointFromCanvasEvent(event);
    if (point) appendBrushDab(point);
  };

  const finishBrushStroke = () => {
    const rasterStroke = rasterStrokeRef.current;
    rasterStrokeRef.current = undefined;
    if (rasterStroke && state && !candidate) {
      const region = state.regions.find((item) => item.id === rasterStroke.regionId);
      if (region?.shape === 'raster') {
        const maskRef = maskStoreRef.current.paint(region.maskRef, rasterStroke.points, .02, rasterStroke.operation);
        commit({ ...state, regions: state.regions.map((item) => item.id === region.id ? { ...item, maskRef } : item) });
        setStatus(rasterStroke.operation === 'add' ? '已补选蒙版区域' : '已擦除蒙版区域');
      }
      return;
    }
    const stroke = brushStrokeRef.current;
    brushStrokeRef.current = undefined;
    if (!stroke || !state || candidate) return;
    commit({ ...state, regions: state.regions.map((region) => region.id === stroke.regionId ? { ...region, brushDabs: stroke.dabs } : region) });
  };

  const handleResetCrop = () => {
    if (!state || candidate) return;
    commit({ ...state, transform: { ...state.transform, crop: { x: 0, y: 0, width: 1, height: 1 }, aspectLock: 'original' } });
  };

  /** 在照片中央截取 512 像素区域，一像素对应一像素，方便判断噪点与纹理。 */
  const handleShowDetail = async () => {
    if (!state || !currentSlot || candidate) return;
    try {
      setStatus('正在处理原尺寸细节');
      const edge = Math.min(512, state.sourceWidth, state.sourceHeight);
      const left = Math.floor((state.sourceWidth - edge) / 2);
      const top = Math.floor((state.sourceHeight - edge) / 2);
      const cropBitmap = async (bitmap: ImageBitmap) => {
        const canvas = document.createElement('canvas');
        canvas.width = edge; canvas.height = edge;
        canvas.getContext('2d')!.drawImage(bitmap, left, top, edge, edge, 0, 0, edge, edge);
        bitmap.close();
        return canvas.toDataURL('image/png');
      };
      const [original, processed] = await Promise.all([
        createImageBitmap(currentSlot.blob, { imageOrientation: 'from-image' }).then(cropBitmap),
        prepareFullBitmap(currentSlot, state, 'detail').then(cropBitmap),
      ]);
      setDetailPreview({ original, processed });
      setStatus('已显示照片中央的原尺寸细节');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图像处理失败，请查看错误详情');
    }
  };

  const requestPlan = async (mode: 'auto' | 'followup') => {
    if (!state || !currentSlot || candidate) return;
    if (mode === 'followup' && !instruction.trim()) { setStatus('请输入希望修改的内容'); return; }
    try {
      controllerRef.current?.abort();
      const signal = new AbortController();
      controllerRef.current = signal;
      setBusy(true);
      setStatus('正在生成建议，可继续手动编辑或取消');
      const referencePromise = referencePhoto ? previewFromBlob(referencePhoto.blob, 1024) : undefined;
      const original = await previewFromBlob(currentSlot.blob, 1024);
      if (hasRestoration({ dehaze: state.global.dehaze, denoiseLuma: state.global.denoiseLuma, denoiseChroma: state.global.denoiseChroma })) setStatus('正在处理原尺寸图片');
      const offscreen = document.createElement('canvas');
      const currentRenderer = new PhotoRenderer(offscreen);
      currentRenderer.loadBitmap(await prepareFullBitmap(currentSlot, state, 'export'));
      for (const region of state.regions) if (region.shape === 'raster') currentRenderer.setMask(region.maskRef, maskStoreRef.current.get(region.maskRef));
      currentRenderer.render(state, original.width, original.height);
      const current = await previewFromBlob(await currentRenderer.toBlob(0.85), 1024);
      currentRenderer.dispose();
      const reference = referencePromise ? await referencePromise : undefined;
      const [originalBase64, currentBase64, referenceBase64] = await Promise.all([
        toBase64(original.blob),
        toBase64(current.blob),
        reference ? toBase64(reference.blob) : Promise.resolve(undefined),
      ]);
      const payload: PlanRequest = {
        schemaVersion: SCHEMA_VERSION,
        requestId: uid(),
        imageId: state.imageId,
        sourceVersion: state.sourceVersion,
        baseRevision: state.revision,
        mode,
        instruction: mode === 'auto' ? '自然改善照片，保持现场氛围' : instruction.trim(),
        state,
        allowComposition,
        originalPreview: { mime: 'image/jpeg', width: original.width, height: original.height, base64: originalBase64 },
        currentPreview: { mime: 'image/jpeg', width: current.width, height: current.height, base64: currentBase64 },
        ...(reference && referenceBase64 ? { referencePreview: { mime: 'image/jpeg' as const, width: reference.width, height: reference.height, base64: referenceBase64 } } : {}),
        context: [],
      };
      const response = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: signal.signal });
      const body = await response.json();
      if (!response.ok) {
        const requestMarker = typeof body.requestId === 'string' ? `（请求编号：${body.requestId}）` : '';
        throw new Error(`${body.message ?? '建议请求失败'}${requestMarker}`);
      }
      if (state.imageId !== body.imageId || state.revision !== body.baseRevision) throw new Error('建议已过期');
      const planPayload = body.payload as PlanPayload;
      if (planPayload.status !== 'plan') { setStatus(planPayload.message || '本次没有可应用的建议'); return; }
      setCandidate({ payload: planPayload, planId: body.planId, requestId: body.requestId, baseRevision: body.baseRevision });
      setStatus('正在预览建议。可应用或放弃');
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') setStatus('已取消建议');
      else setStatus(error instanceof Error ? error.message : '建议请求失败');
    } finally {
      setBusy(false);
    }
  };

  /** 手动输入一个清晰概念时，直接请求 SAM3，避免为了局部选择额外调用 LLM。 */
  const requestSamSegmentation = async () => {
    if (!state || !currentSlot || candidate) return;
    const instructionText = instruction.trim();
    if (!instructionText) { setStatus('请输入想调整的对象，例如“提亮人物”或“sky”'); return; }
    try {
      controllerRef.current?.abort();
      const signal = new AbortController();
      controllerRef.current = signal;
      setBusy(true); setStatus('正在准备 SAM3 选区');
      let preview = await previewFromBlob(currentSlot.blob, 1024, .8);
      for (const edge of [896, 768, 640]) {
        if (preview.blob.size <= 512 * 1024) break;
        preview = await previewFromBlob(currentSlot.blob, edge, .7);
      }
      if (preview.blob.size > 512 * 1024) throw new Error('图片缩略图超过 512 KiB，无法安全发送给 SAM3');
      const originalBase64 = await toBase64(preview.blob);
      let queries: SegmentIntent['queries'] = [{ labelZh: instructionText, textQuery: instructionText }];
      // 明确输入英文概念时可跳过 LLM；中文自然语言先让视觉模型提取至多三个概念。
      if (!/^[\x20-\x7e]+$/.test(instructionText)) {
        setStatus('正在识别需要调整的对象');
        const intentResponse = await fetch('/api/segment-intent', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal.signal, body: JSON.stringify({ requestId: uid(), imageId: state.imageId, sourceVersion: state.sourceVersion, baseRevision: state.revision, instruction: instructionText, originalPreview: { mime: 'image/jpeg', width: preview.width, height: preview.height, base64: originalBase64 }, regions: state.regions.map((region) => ({ id: region.id, label: region.label })), selectedRegionId: null }) });
        const intentBody = await intentResponse.json() as { message?: string; intent?: SegmentIntent };
        if (!intentResponse.ok) throw new Error(intentBody.message ?? '概念识别请求失败');
        if (!intentBody.intent || intentBody.intent.status === 'clarify') throw new Error(intentBody.intent?.message || '请说明需要调整照片中的哪个对象');
        queries = intentBody.intent.queries;
        if (queries.length === 0) throw new Error('没有需要新识别的对象，可直接调整已有局部区域');
      }
      const results: Array<{ query: SegmentIntent['queries'][number]; result: SegmentResponse }> = [];
      for (const query of queries.slice(0, 3)) {
        setStatus(`SAM3 正在识别“${query.labelZh}”`);
        const response = await fetch('/api/segment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: uid(), imageId: state.imageId, sourceVersion: state.sourceVersion, baseRevision: state.revision, preview: { mime: 'image/jpeg', width: preview.width, height: preview.height, base64: originalBase64 }, prompt: { kind: 'text', textQuery: query.textQuery, confidenceThreshold: .45 } }), signal: signal.signal });
        const result = await response.json() as SegmentResponse & { message?: string };
        if (!response.ok) throw new Error(result.message ?? 'SAM3 分割请求失败');
        if (result.imageId !== state.imageId || result.sourceVersion !== state.sourceVersion || result.baseRevision !== state.revision) throw new Error('识别结果已过期');
        results.push({ query, result });
      }
      const prepared = await Promise.all(results.flatMap(({ query, result }) => result.annotations.map(async (annotation) => {
        const maskResponse = await fetch(annotation.maskUrl, { signal: signal.signal });
        if (!maskResponse.ok) throw new Error('无法下载 SAM3 返回的蒙版');
        const decoded = await alphaFromMaskPng(await maskResponse.blob(), result.inputWidth, result.inputHeight);
        const metrics = maskMetrics(decoded.width, decoded.height, decoded.pixels);
        if (metrics.areaRatio === 0) return undefined;
        const maskRef = maskStoreRef.current.create({ imageId: state.imageId, sourceVersion: state.sourceVersion, ...decoded, origin: 'sam3' });
        return { candidateId: uid(), imageId: state.imageId, sourceVersion: state.sourceVersion, query: query.textQuery, displayLabel: annotation.label || query.labelZh, maskRef, width: decoded.width, height: decoded.height, ...metrics } satisfies SamCandidate;
      })));
      const next = prepared.filter(Boolean).slice(0, 8) as SamCandidate[];
      setSamCandidates(next);
      setStatus(next.length ? `已找到 ${next.length} 个选区，选择一个加入局部调整` : 'SAM3 没有找到可用选区');
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') setStatus('已取消 SAM3 识别');
      else setStatus(error instanceof Error ? error.message : 'SAM3 识别失败');
    } finally { setBusy(false); }
  };

  /** 对同一个草稿完整重发点集；revision 确保快速点选时旧蒙版不会覆盖新结果。 */
  const requestPointSegmentation = async (points: Array<{ x: number; y: number; label: 0 | 1 }>) => {
    if (!state || !currentSlot || !pointSegmentationSupported) return;
    const revision = ++pointRevisionRef.current;
    try {
      controllerRef.current?.abort();
      const signal = new AbortController(); controllerRef.current = signal;
      setBusy(true); setStatus('SAM3 正在根据点击位置生成选区');
      let preview = await previewFromBlob(currentSlot.blob, 1024, .8);
      for (const edge of [896, 768, 640]) { if (preview.blob.size <= 512 * 1024) break; preview = await previewFromBlob(currentSlot.blob, edge, .7); }
      if (preview.blob.size > 512 * 1024) throw new Error('图片缩略图超过 512 KiB，无法安全发送给 SAM3');
      const response = await fetch('/api/segment', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal.signal, body: JSON.stringify({ requestId: uid(), imageId: state.imageId, sourceVersion: state.sourceVersion, baseRevision: state.revision, preview: { mime: 'image/jpeg', width: preview.width, height: preview.height, base64: await toBase64(preview.blob) }, prompt: { kind: 'point', points } }) });
      const result = await response.json() as SegmentResponse & { message?: string };
      if (!response.ok) throw new Error(result.message ?? 'SAM3 点选请求失败');
      if (revision !== pointRevisionRef.current || result.imageId !== state.imageId || result.sourceVersion !== state.sourceVersion || result.baseRevision !== state.revision) return;
      const prepared = await Promise.all(result.annotations.map(async (annotation) => {
        const maskResponse = await fetch(annotation.maskUrl, { signal: signal.signal });
        if (!maskResponse.ok) throw new Error('无法下载 SAM3 返回的蒙版');
        const decoded = await alphaFromMaskPng(await maskResponse.blob(), result.inputWidth, result.inputHeight);
        const metrics = maskMetrics(decoded.width, decoded.height, decoded.pixels);
        if (metrics.areaRatio === 0) return undefined;
        const maskRef = maskStoreRef.current.create({ imageId: state.imageId, sourceVersion: state.sourceVersion, ...decoded, origin: 'sam3' });
        return { candidateId: uid(), imageId: state.imageId, sourceVersion: state.sourceVersion, query: null, displayLabel: '选区 1', maskRef, width: decoded.width, height: decoded.height, ...metrics } satisfies SamCandidate;
      }));
      if (revision !== pointRevisionRef.current) return;
      const next = prepared.filter(Boolean).slice(0, 8) as SamCandidate[];
      setSamCandidates(next);
      setStatus(next.length ? '已生成待确认选区，可加入局部调整或继续点选' : 'SAM3 没有生成可用选区');
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      if (revision === pointRevisionRef.current) setStatus(error instanceof Error ? error.message : 'SAM3 点选失败');
    } finally { if (revision === pointRevisionRef.current) setBusy(false); }
  };

  const applySamCandidate = (item: SamCandidate) => {
    if (!state || candidate || state.regions.length >= 4) { setStatus('局部区域最多四个'); return; }
    if (item.imageId !== state.imageId || item.sourceVersion !== state.sourceVersion) { setStatus('选区已过期，请重新识别'); return; }
    commit({ ...state, regions: [...state.regions, {
      id: uid(), label: item.displayLabel.slice(0, 40), enabled: true, mode: 'inside', shape: 'raster', maskRef: item.maskRef, featherRadius: 0,
      adjustments: { exposureEV: 0, highlights: 0, saturation: 0 },
    }] });
    setSamCandidates((items) => items.filter((candidateItem) => candidateItem.candidateId !== item.candidateId));
    setStatus('选区已加入局部调整，可在右侧设置曝光、高光和饱和度');
  };

  const applyCandidate = () => {
    if (!state || !candidate || candidate.baseRevision !== state.revision) return;
    try {
      const next = applyChanges(state, candidate.payload.changes!, allowComposition);
      commit(next);
      setInstruction('');
      setStatus(`已应用建议。${changedSummary(state, next)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '建议无法应用');
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!state || !currentSlot || candidate) return;
    try {
      setExporting(true);
      controllerRef.current?.abort();
      const crop = state.transform.crop;
      const outW = Math.round(state.sourceWidth * crop.width);
      const outH = Math.round(state.sourceHeight * crop.height);
      setStatus(hasRestoration({ dehaze: state.global.dehaze, denoiseLuma: state.global.denoiseLuma, denoiseChroma: state.global.denoiseChroma }) ? '正在处理原尺寸图片' : '正在导出图片');
      const offscreen = document.createElement('canvas');
      const output = new PhotoRenderer(offscreen);
      output.loadBitmap(await prepareFullBitmap(currentSlot, state, 'export'));
      for (const region of state.regions) if (region.shape === 'raster') output.setMask(region.maskRef, maskStoreRef.current.get(region.maskRef));
      output.render(state, outW, outH, 1);
      const selectedFormat = format === 'tiff'
        ? { blob: new Blob([UTIF.encodeImage(output.rgbaPixels(), offscreen.width, offscreen.height)], { type: 'image/tiff' }), extension: 'tiff', label: 'TIFF（无压缩）' }
        : (() => {
          const canvasFormat = CANVAS_EXPORT_FORMATS[format];
          return { blob: output.toBlob(canvasFormat.quality, canvasFormat.mime), extension: canvasFormat.extension, label: canvasFormat.label };
        })();
      const blob = await selectedFormat.blob;
      output.dispose();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentSlot.name}-edited.${selectedFormat.extension}`;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus(`已导出 ${outW} × ${outH} ${selectedFormat.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出资源不足。请缩小裁切范围后重新尝试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main
      className={isDraggingFiles ? 'dragging-files' : undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragLeave={() => {
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) { dragDepthRef.current = 0; setIsDraggingFiles(false); }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        handleImports(Array.from(event.dataTransfer.files));
      }}
    >
      <TopBar
        hasState={Boolean(state)}
        canUndo={Boolean(currentSlot && currentSlot.history.length > 0)}
        canRedo={Boolean(currentSlot && currentSlot.future.length > 0)}
        exporting={exporting}
        onImport={handleImports}
        onUndo={undo}
        onRedo={redo}
        onCompareStart={handleCompareStart}
        onCompareEnd={handleCompareEnd}
        zoom={zoom}
        onZoomIn={() => setZoom((value) => Math.min(200, value + 25))}
        onZoomOut={() => setZoom((value) => Math.max(25, value - 25))}
        onFit={handleFit}
        onExport={handleExport}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        bottomPanelOpen={bottomPanelOpen}
        onToggleLeftPanel={() => setLeftPanelOpen((value) => !value)}
        onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
        onToggleBottomPanel={() => setBottomPanelOpen((value) => !value)}
      />
      <section className={`content ${rightPanelOpen ? '' : 'right-panel-closed'}`}>
        <div className={`leftStack ${leftPanelOpen ? '' : 'left-panel-closed'} ${bottomPanelOpen ? '' : 'bottom-panel-closed'}`}>
          <ThumbnailSidebar
            images={images}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            onRemove={(index) => {
              removeImage(index);
              setStatus(images.length === 1 ? '当前会话没有图片' : '已从当前会话移除图片');
            }}
            onImport={handleImports}
          />
          <div className="canvasWrap" onWheel={(event) => { if (!state) return; event.preventDefault(); setZoom((value) => Math.min(200, Math.max(25, value + (event.deltaY < 0 ? 10 : -10)))); }}>
            <canvas
              ref={canvasRef}
              className={activeBrushRegionId || activeRasterPaint || pointSelectionActive ? 'brush-canvas' : undefined}
              style={{ transform: `scale(${zoom / 100})` }}
              aria-label={pointSelectionActive ? '点选物体画布，点击选择目标，按住 Shift 点击排除区域' : activeBrushRegionId || activeRasterPaint ? '蒙版画布，按住并拖动涂抹' : '照片编辑画布'}
              onPointerDown={handleBrushPointerDown}
              onPointerMove={handleBrushPointerMove}
              onPointerUp={finishBrushStroke}
              onPointerCancel={finishBrushStroke}
            />
          </div>
          {bottomPanelOpen && <CopilotPanel
            status={status}
            instruction={instruction}
            setInstruction={setInstruction}
            hasState={Boolean(state)}
            busy={busy}
            onAuto={() => void requestPlan('auto')}
            onFollowup={() => void requestPlan('followup')}
            onSegment={() => void requestSamSegmentation()}
            pointSegmentationSupported={pointSegmentationSupported}
            pointSelectionActive={pointSelectionActive}
            onTogglePointSelection={() => { setPointSelectionActive((value) => !value); setActiveBrushRegionId(undefined); setActiveRasterPaint(undefined); setStatus(pointSelectionActive ? '已结束点选' : '请在照片上点击目标；按住 Shift 可添加排除点'); }}
            onCancel={() => controllerRef.current?.abort()}
            onClose={() => setBottomPanelOpen(false)}
            thumbnail={currentSlot?.thumbnail}
            candidate={candidate?.payload}
            onApply={applyCandidate}
            onDiscard={() => { setCandidate(); setStatus('已放弃建议'); }}
            referencePhoto={referencePhoto}
            onReferenceImport={(file) => void handleReferenceImport(file)}
            onRemoveReference={() => { controllerRef.current?.abort(); setReferencePhoto(undefined); setCandidate(); setStatus('已移除参考图'); }}
            samCandidates={samCandidates}
            onApplySamCandidate={(candidateId) => {
              const item = samCandidates.find((candidateItem) => candidateItem.candidateId === candidateId);
              if (item) applySamCandidate(item);
            }}
          />}
        </div>
        {rightPanelOpen && <ControlsPanel
          state={state}
          disabled={Boolean(candidate)}
          allowComposition={allowComposition}
          onAllowCompositionChange={setAllowComposition}
          onGlobalChange={handleGlobalChange}
          onTransformChange={handleTransformChange}
          onCropChange={handleCropChange}
          onAspectLockChange={handleAspectLockChange}
          onAddRegion={handleAddRegion}
          regionCount={state?.regions.length ?? 0}
          onUpdateRegion={handleUpdateRegion}
          onDeleteRegion={handleDeleteRegion}
          activeBrushRegionId={activeBrushRegionId}
          onPaintBrush={setActiveBrushRegionId}
          activeRasterPaint={activeRasterPaint}
          onPaintRaster={(regionId, operation) => { setActiveBrushRegionId(undefined); setActiveRasterPaint(regionId && operation ? { regionId, operation } : undefined); }}
          onResetCrop={handleResetCrop}
          onEditInteractionStart={beginInteraction}
          onEditInteractionEnd={endInteraction}
          onShowDetail={() => void handleShowDetail()}
        />}
      </section>
      {isDraggingFiles && <div className="drop-overlay" aria-live="polite">松开即可导入照片</div>}
      {detailPreview && <div className="modal detail-modal" role="dialog" aria-modal="true" aria-label="原尺寸细节对比" onClick={() => setDetailPreview(undefined)}>
        <div onClick={(event) => event.stopPropagation()}>
          <h2>原尺寸细节</h2>
          <p>照片中央区域。左侧为原图，右侧为当前处理效果。</p>
          <div className="detail-images"><figure><img src={detailPreview.original} alt="原图中央细节" /><figcaption>原图</figcaption></figure><figure><img src={detailPreview.processed} alt="处理后中央细节" /><figcaption>处理后</figcaption></figure></div>
          <button onClick={() => setDetailPreview(undefined)}>关闭</button>
        </div>
      </div>}
    </main>
  );
}
