import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { applyChanges, changedSummary, createInitialState, defaultGlobal, type EditState, type GlobalKey, type PlanPayload, type Region } from '@photo-copilot/domain';
import type { PlanRequest } from '@photo-copilot/ai-contract';
import { PhotoRenderer } from '@photo-copilot/renderer';
import { activeSlot, useEditor } from '../state/editor';
import { TopBar } from './TopBar';
import { ThumbnailSidebar } from './ThumbnailSidebar';
import { ControlsPanel } from './ControlsPanel';
import { CopilotPanel } from './CopilotPanel';

function uid() { return crypto.randomUUID(); }

async function normalizedBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
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

async function previewFromBlob(blob: Blob, maxEdge: number) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG 编码失败')), 'image/jpeg', 0.85);
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
  const currentSlot = useEditor((state) => activeSlot(state));
  const images = useEditor((state) => state.images);
  const activeIndex = useEditor((state) => state.activeIndex);
  const candidate = useEditor((state) => state.candidate);
  const commit = useEditor((state) => state.commit);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const setCandidate = useEditor((state) => state.setCandidate);
  const reset = useEditor((state) => state.reset);
  const addImage = useEditor((state) => state.addImage);
  const setActiveIndex = useEditor((state) => state.setActiveIndex);
  const removeImage = useEditor((state) => state.removeImage);

  const state = currentSlot?.state;

  const [status, setStatus] = useState('导入一张 JPEG 或 PNG 开始编辑');
  const [instruction, setInstruction] = useState('');
  const [allowComposition, setAllowComposition] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [activeBrushRegionId, setActiveBrushRegionId] = useState<string>();

  const controllerRef = useRef<AbortController | undefined>(undefined);
  const brushStrokeRef = useRef<{ regionId: string; dabs: Array<{ x: number; y: number }>; last?: { x: number; y: number } } | undefined>(undefined);

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

  const draw = useCallback(() => {
    if (!displayState || !rendererRef.current || !canvasRef.current) return;
    const parent = canvasRef.current.parentElement;
    const availableWidth = (parent?.clientWidth ?? 900) * 0.92;
    const availableHeight = (parent?.clientHeight ?? 600) * 0.87;
    const aspect = (displayState.sourceWidth * displayState.transform.crop.width) / (displayState.sourceHeight * displayState.transform.crop.height);
    const width = Math.min(availableWidth, availableHeight * aspect);
    rendererRef.current.render(displayState, width, width / aspect);
  }, [displayState]);

  useEffect(() => { draw(); }, [draw]);
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

  // Switch renderer to the active image's blob whenever activeIndex changes.
  useEffect(() => {
    if (!currentSlot || !canvasRef.current) return;
    rendererRef.current?.dispose();
    const r = new PhotoRenderer(canvasRef.current);
    rendererRef.current = r;
    void r.load(currentSlot.blob).then(() => draw());
  }, [currentSlot?.blob]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFit = useCallback(() => { setZoom(100); draw(); }, [draw]);

  const handleCompareStart = useCallback(() => {
    if (!state) return;
    setCompare(true);
    rendererRef.current?.render({ ...state, global: defaultGlobal(), regions: [] });
  }, [state]);

  const handleCompareEnd = useCallback(() => {
    setCompare(false);
    draw();
  }, [draw]);

  const handleImport = async (file: File) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setStatus('仅支持 JPEG 或 PNG 图片'); return; }
    if (file.size > 25 * 1024 * 1024) { setStatus('图片超过 25 MiB 限制'); return; }
    try {
      setStatus('正在解码和规范化图片');
      const blob = await normalizedBlob(file);
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width * bitmap.height > 24_000_000 || bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width < 64 || bitmap.height < 64) {
        bitmap.close();
        throw new Error('图片尺寸不在 64 像素至 2400 万像素范围内');
      }
      const next = createInitialState(uid(), bitmap.width, bitmap.height);
      bitmap.close();
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

  const handleGlobalChange = (key: GlobalKey, value: number) => {
    if (!state || candidate) return;
    controllerRef.current?.abort();
    commit({ ...state, global: { ...state.global, [key]: value } });
  };

  const handleTransformChange = (patch: Partial<EditState['transform']>) => {
    if (!state || candidate) return;
    commit({ ...state, transform: { ...state.transform, ...patch } });
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

  const handleCropChange = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!state || candidate) return;
    const crop = { ...state.transform.crop, [key]: value };
    crop.width = Math.min(crop.width, 1 - crop.x);
    crop.height = Math.min(crop.height, 1 - crop.y);
    commit({ ...state, transform: { ...state.transform, crop } });
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
    };
    commit({ ...state, regions: [...state.regions, region] });
    if (shape === 'brush') setActiveBrushRegionId(region.id);
  };

  const handleUpdateRegion = (nextRegion: Region) => {
    if (!state || candidate) return;
    commit({ ...state, regions: state.regions.map((region) => region.id === nextRegion.id ? nextRegion : region) });
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
    const qx = crop.x + ((event.clientX - rect.left) / rect.width) * crop.width;
    const qy = crop.y + ((event.clientY - rect.top) / rect.height) * crop.height;
    const angle = state.transform.angleDeg * Math.PI / 180;
    const x = Math.cos(angle) * (qx - .5) + Math.sin(angle) * (qy - .5) + .5;
    const y = -Math.sin(angle) * (qx - .5) + Math.cos(angle) * (qy - .5) + .5;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  const appendBrushDab = (point: { x: number; y: number }) => {
    const stroke = brushStrokeRef.current;
    if (!stroke || !state) return;
    const region = state.regions.find((item) => item.id === stroke.regionId);
    if (!region) return;
    const minimumDistance = region.brushRadius * .3;
    if (stroke.last && Math.hypot(point.x - stroke.last.x, point.y - stroke.last.y) < minimumDistance) return;
    if (stroke.dabs.length >= 32) return;
    stroke.dabs.push(point); stroke.last = point;
  };

  const handleBrushPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || candidate || !activeBrushRegionId) return;
    const region = state.regions.find((item) => item.id === activeBrushRegionId);
    const point = pointFromCanvasEvent(event);
    if (!region || region.shape !== 'brush' || !point) return;
    brushStrokeRef.current = { regionId: region.id, dabs: [...region.brushDabs], last: undefined };
    appendBrushDab(point);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleBrushPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!brushStrokeRef.current) return;
    const point = pointFromCanvasEvent(event);
    if (point) appendBrushDab(point);
  };

  const finishBrushStroke = () => {
    const stroke = brushStrokeRef.current;
    brushStrokeRef.current = undefined;
    if (!stroke || !state || candidate) return;
    commit({ ...state, regions: state.regions.map((region) => region.id === stroke.regionId ? { ...region, brushDabs: stroke.dabs } : region) });
  };

  const handleResetCrop = () => {
    if (!state || candidate) return;
    commit({ ...state, transform: { ...state.transform, crop: { x: 0, y: 0, width: 1, height: 1 }, aspectLock: 'original' } });
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
      const original = await previewFromBlob(currentSlot.blob, 1024);
      const offscreen = document.createElement('canvas');
      const currentRenderer = new PhotoRenderer(offscreen);
      await currentRenderer.load(currentSlot.blob);
      currentRenderer.render(state, original.width, original.height);
      const current = await previewFromBlob(await currentRenderer.toBlob(0.85), 1024);
      currentRenderer.dispose();
      const payload: PlanRequest = {
        schemaVersion: 1,
        requestId: uid(),
        imageId: state.imageId,
        baseRevision: state.revision,
        mode,
        instruction: mode === 'auto' ? '自然改善照片，保持现场氛围' : instruction.trim(),
        state,
        allowComposition,
        originalPreview: { mime: 'image/jpeg', width: original.width, height: original.height, base64: await toBase64(original.blob) },
        currentPreview: { mime: 'image/jpeg', width: current.width, height: current.height, base64: await toBase64(current.blob) },
        context: [],
      };
      const response = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: signal.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '建议请求失败');
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

  const handleExport = async () => {
    if (!state || !currentSlot || candidate) return;
    try {
      setExporting(true);
      controllerRef.current?.abort();
      const crop = state.transform.crop;
      const outW = Math.round(state.sourceWidth * crop.width);
      const outH = Math.round(state.sourceHeight * crop.height);
      const offscreen = document.createElement('canvas');
      const output = new PhotoRenderer(offscreen);
      await output.load(currentSlot.blob);
      output.render(state, outW, outH);
      const blob = await output.toBlob(0.92);
      output.dispose();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentSlot.name}-edited.jpg`;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus(`已导出 ${outW} × ${outH} JPEG`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出资源不足。请缩小裁切范围后重新尝试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void handleImport(file); }}>
      <TopBar
        hasState={Boolean(state)}
        canUndo={Boolean(currentSlot && currentSlot.history.length > 0)}
        canRedo={Boolean(currentSlot && currentSlot.future.length > 0)}
        exporting={exporting}
        onImport={handleImport}
        onUndo={undo}
        onRedo={redo}
        onCompareStart={handleCompareStart}
        onCompareEnd={handleCompareEnd}
        zoom={zoom}
        onZoomIn={() => setZoom((value) => Math.min(200, value + 25))}
        onZoomOut={() => setZoom((value) => Math.max(25, value - 25))}
        onZoomPreset={setZoom}
        onFit={handleFit}
        onExport={handleExport}
        copilotOpen={copilotOpen}
        onToggleCopilot={() => setCopilotOpen((value) => !value)}
      />
      <section className="content">
        <div className="leftStack">
          <ThumbnailSidebar
            images={images}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            onRemove={(index) => {
              removeImage(index);
              setStatus('已从当前会话移除图片');
            }}
          />
          <div className="canvasWrap" onWheel={(event) => { if (!state) return; event.preventDefault(); setZoom((value) => Math.min(200, Math.max(25, value + (event.deltaY < 0 ? 10 : -10)))); }}>
            <canvas
              ref={canvasRef}
              className={activeBrushRegionId ? 'brush-canvas' : undefined}
              style={{ transform: `scale(${zoom / 100})` }}
              aria-label={activeBrushRegionId ? '画笔蒙版画布，按住并拖动涂抹' : '照片编辑画布'}
              onPointerDown={handleBrushPointerDown}
              onPointerMove={handleBrushPointerMove}
              onPointerUp={finishBrushStroke}
              onPointerCancel={finishBrushStroke}
            />
          </div>
          {copilotOpen && <CopilotPanel
            status={status}
            instruction={instruction}
            setInstruction={setInstruction}
            hasState={Boolean(state)}
            busy={busy}
            onAuto={() => void requestPlan('auto')}
            onFollowup={() => void requestPlan('followup')}
            onCancel={() => controllerRef.current?.abort()}
            onClose={() => setCopilotOpen(false)}
            thumbnail={currentSlot?.thumbnail}
            candidate={candidate?.payload}
            onApply={applyCandidate}
            onDiscard={() => { setCandidate(); setStatus('已放弃建议'); }}
          />}
        </div>
        <ControlsPanel
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
          onResetCrop={handleResetCrop}
        />
      </section>
    </main>
  );
}
