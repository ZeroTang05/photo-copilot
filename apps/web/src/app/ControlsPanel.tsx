import type { EditState, GlobalKey, Region } from '@photo-copilot/domain';
import { Slider } from './Slider';

interface ControlsPanelProps {
  state?: EditState;
  disabled: boolean;
  allowComposition: boolean;
  onAllowCompositionChange: (next: boolean) => void;
  onGlobalChange: (key: GlobalKey, value: number, transient?: boolean) => void;
  onTransformChange: (patch: Partial<EditState['transform']>, transient?: boolean) => void;
  onCropChange: (key: 'x' | 'y' | 'width' | 'height', value: number, transient?: boolean) => void;
  onAspectLockChange: (value: EditState['transform']['aspectLock']) => void;
  onAddRegion: (shape?: Region['shape'], mode?: Region['mode']) => void;
  regionCount: number;
  onUpdateRegion: (region: Region, transient?: boolean) => void;
  onDeleteRegion: (regionId: string) => void;
  activeBrushRegionId?: string;
  onPaintBrush: (regionId?: string) => void;
  activeRasterPaint?: { regionId: string; operation: 'add' | 'erase' };
  onPaintRaster: (regionId?: string, operation?: 'add' | 'erase') => void;
  onResetCrop: () => void;
  onEditInteractionStart: () => void;
  onEditInteractionEnd: () => void;
  onShowDetail: () => void;
}

const aspectOptions: Array<{ value: EditState['transform']['aspectLock']; label: string }> = [
  { value: 'free', label: '自由' },
  { value: 'original', label: '原图' },
  { value: 'square', label: '正方形' },
  { value: 'portrait4x5', label: '4 比 5' },
  { value: 'landscape3x2', label: '3 比 2' },
  { value: 'wide16x9', label: '16 比 9' },
];

const Chevron = () => (
  <svg className="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function RegionEditor({ region, disabled, onUpdate, onDelete, activeBrushRegionId, onPaintBrush, activeRasterPaint, onPaintRaster }: { region: Region; disabled: boolean; onUpdate: (next: Region, transient?: boolean) => void; onDelete: () => void; activeBrushRegionId?: string; onPaintBrush: (regionId?: string) => void; activeRasterPaint?: { regionId: string; operation: 'add' | 'erase' }; onPaintRaster: (regionId?: string, operation?: 'add' | 'erase') => void }) {
  const change = (patch: Record<string, unknown>, transient?: boolean) => onUpdate({ ...region, ...patch } as Region, transient);
  const adjustment = (key: keyof Region['adjustments'], value: number, transient?: boolean) => onUpdate({ ...region, adjustments: { ...region.adjustments, [key]: value } }, transient);
  const isBrush = region.shape === 'brush';
  const isLinear = region.shape === 'linear';
  const isRaster = region.shape === 'raster';
  return <div className="region-editor">
    <div className="region-editor-head">
      <input aria-label="区域名称" value={region.label} disabled={disabled} maxLength={40} onChange={(event) => change({ label: event.target.value })} />
      <button className="region-delete" disabled={disabled} onClick={onDelete}>删除</button>
    </div>
    <label className="check"><input type="checkbox" checked={region.enabled} disabled={disabled} onChange={(event) => change({ enabled: event.target.checked })} />启用蒙版</label>
    {isRaster ? <p className="region-hint">SAM3 像素蒙版。调整参数只会作用在识别出的区域。</p> : <label className="select-row"><span>蒙版类型</span><select value={region.shape} disabled={disabled} onChange={(event) => change({ shape: event.target.value })}><option value="ellipse">椭圆径向</option><option value="linear">线性渐变</option><option value="brush">画笔</option></select></label>}
    {region.shape === 'ellipse' && <label className="select-row"><span>影响范围</span><select value={region.mode} disabled={disabled} onChange={(event) => change({ mode: event.target.value })}><option value="inside">椭圆内</option><option value="outside">椭圆外</option></select></label>}
    {isRaster ? <>
      <label className="check"><input type="checkbox" checked={region.mode === 'outside'} disabled={disabled} onChange={(event) => change({ mode: event.target.checked ? 'outside' : 'inside' })} />反选蒙版</label>
      <Slider label="边缘羽化" value={region.featherRadius} min={0} max={.02} step={.001} disabled={disabled} onChange={(value, transient) => change({ featherRadius: value }, transient)} />
      <div className="raster-paint-actions"><button className={`brush-paint ${activeRasterPaint?.regionId === region.id && activeRasterPaint.operation === 'add' ? 'active-tool' : ''}`} disabled={disabled} onClick={() => onPaintRaster(activeRasterPaint?.regionId === region.id && activeRasterPaint.operation === 'add' ? undefined : region.id, 'add')}>补选画笔</button><button className={`brush-paint ${activeRasterPaint?.regionId === region.id && activeRasterPaint.operation === 'erase' ? 'active-tool' : ''}`} disabled={disabled} onClick={() => onPaintRaster(activeRasterPaint?.regionId === region.id && activeRasterPaint.operation === 'erase' ? undefined : region.id, 'erase')}>擦除画笔</button></div>
      <p className="region-hint">在照片上拖动修正选区，一次拖动会生成一条可撤销的蒙版版本。</p>
    </> : isBrush ? <>
      <button className={`brush-paint ${activeBrushRegionId === region.id ? 'active-tool' : ''}`} disabled={disabled} onClick={() => onPaintBrush(activeBrushRegionId === region.id ? undefined : region.id)}>{activeBrushRegionId === region.id ? '正在画面上涂抹' : '在画面上涂抹'}</button>
      <p className="region-hint">点击后直接在照片上拖动。再次点击按钮结束涂抹。</p>
      <Slider label="笔刷大小" value={region.brushRadius} min={.01} max={.35} step={.01} disabled={disabled} onChange={(value, transient) => change({ brushRadius: value }, transient)} />
      <p className="region-hint">已记录 {region.brushDabs.length}/32 个笔触点。</p>
    </> : <>
      <Slider label={isLinear ? '渐变中心 X' : '中心 X'} value={region.centerX} min={0} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ centerX: value }, transient)} />
      <Slider label={isLinear ? '渐变中心 Y' : '中心 Y'} value={region.centerY} min={0} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ centerY: value }, transient)} />
      {isLinear ? <>
        <Slider label="渐变方向" value={region.angleDeg} min={-180} max={180} step={1} unit="°" disabled={disabled} onChange={(value, transient) => change({ angleDeg: value }, transient)} />
        <Slider label="过渡范围" value={region.feather} min={.05} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ feather: value }, transient)} />
      </> : <>
        <Slider label="横向范围" value={region.radiusX} min={0.01} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ radiusX: value }, transient)} />
        <Slider label="纵向范围" value={region.radiusY} min={0.01} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ radiusY: value }, transient)} />
        <Slider label="羽化" value={region.feather} min={.05} max={1} step={.01} disabled={disabled} onChange={(value, transient) => change({ feather: value }, transient)} />
      </>}
    </>}
    <Slider label="局部曝光" value={region.adjustments.exposureEV} min={-2} max={2} step={0.01} disabled={disabled} onChange={(value, transient) => adjustment('exposureEV', value, transient)} />
    <Slider label="局部高光" value={region.adjustments.highlights} min={-100} max={100} step={.1} disabled={disabled} onChange={(value, transient) => adjustment('highlights', value, transient)} />
    <Slider label="局部饱和" value={region.adjustments.saturation} min={-100} max={100} step={.1} disabled={disabled} onChange={(value, transient) => adjustment('saturation', value, transient)} />
  </div>;
}

export function ControlsPanel(props: ControlsPanelProps) {
  const { state, disabled, regionCount } = props;
  const crop = state?.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <aside
      className="controls"
      onPointerDownCapture={(event) => {
        if (event.target instanceof HTMLElement && (event.target.closest('.slider-scrub') || event.target.matches('input[type="range"]'))) props.onEditInteractionStart();
      }}
      onPointerUpCapture={() => props.onEditInteractionEnd()}
      onPointerCancelCapture={() => props.onEditInteractionEnd()}
    >
      {/* 构图 */}
      <details open>
        <summary><Chevron /><span>构图</span></summary>
        <label className="select-row">
          <span>裁剪比例</span>
          <select
            value={state?.transform.aspectLock ?? 'original'}
            disabled={!state || disabled}
            onChange={(event) => props.onAspectLockChange(event.target.value as EditState['transform']['aspectLock'])}
          >
            {aspectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>
        <Slider
          label="旋转"
          value={state?.transform.angleDeg ?? 0}
          min={-180}
          max={180}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onTransformChange({ angleDeg: value }, transient)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={props.allowComposition}
            disabled={!state || disabled}
            onChange={(event) => props.onAllowCompositionChange(event.target.checked)}
          />
          允许 AI 建议构图
        </label>
        <Slider
          label="裁切宽度"
          value={crop.width}
          min={0.01}
          max={Math.max(0.01, 1 - crop.x)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onCropChange('width', value, transient)}
          resetValue={null}
        />
        <Slider
          label="裁切高度"
          value={crop.height}
          min={0.01}
          max={Math.max(0.01, 1 - crop.y)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onCropChange('height', value, transient)}
          resetValue={null}
        />
        <Slider
          label="裁切左侧"
          value={crop.x}
          min={0}
          max={Math.max(0, 1 - crop.width)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onCropChange('x', value, transient)}
          resetValue={null}
        />
        <Slider
          label="裁切顶部"
          value={crop.y}
          min={0}
          max={Math.max(0, 1 - crop.height)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onCropChange('y', value, transient)}
          resetValue={null}
        />
        <button className="crop-reset" disabled={!state || disabled} onClick={props.onResetCrop}>恢复完整照片</button>
      </details>

      {/* 光线 */}
      <details open>
        <summary><Chevron /><span>光线</span></summary>
        <Slider
          label="曝光"
          value={state?.global.exposureEV ?? 0}
          min={-2}
          max={2}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('exposureEV', value, transient)}
        />
        <Slider
          label="对比度"
          value={state?.global.contrast ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('contrast', value, transient)}
        />
        <Slider
          label="高光"
          value={state?.global.highlights ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('highlights', value, transient)}
        />
        <Slider
          label="阴影"
          value={state?.global.shadows ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('shadows', value, transient)}
        />
        <Slider
          label="白色色阶"
          value={state?.global.whites ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('whites', value, transient)}
        />
        <Slider
          label="黑色色阶"
          value={state?.global.blacks ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('blacks', value, transient)}
        />
        <Slider
          label="清晰度"
          value={state?.global.clarity ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('clarity', value, transient)}
        />
        <Slider
          label="去雾"
          value={state?.global.dehaze ?? 0}
          min={0}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('dehaze', value, transient)}
        />
      </details>

      {/* 色彩 */}
      <details open>
        <summary><Chevron /><span>色彩</span></summary>
        <Slider
          label="色温"
          variant="warmth"
          value={state?.global.warmth ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('warmth', value, transient)}
        />
        <Slider
          label="色调"
          variant="tint"
          value={state?.global.tint ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('tint', value, transient)}
        />
        <Slider
          label="自然饱和度"
          value={state?.global.vibrance ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('vibrance', value, transient)}
        />
        <Slider
          label="饱和度"
          value={state?.global.saturation ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('saturation', value, transient)}
        />
      </details>

      {/* 细节 */}
      <details open>
        <summary><Chevron /><span>细节</span></summary>
        <Slider
          label="明度降噪"
          value={state?.global.denoiseLuma ?? 0}
          min={0}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('denoiseLuma', value, transient)}
        />
        <p className="region-hint">减少亮暗颗粒。数值更高时，细小纹理也会更平滑。</p>
        <Slider
          label="颜色降噪"
          value={state?.global.denoiseChroma ?? 0}
          min={0}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value, transient) => props.onGlobalChange('denoiseChroma', value, transient)}
        />
        <p className="region-hint">减少暗部的红绿蓝杂点，亮度细节保持独立控制。</p>
        <button className="region-add-outside" disabled={!state || disabled} onClick={props.onShowDetail}>查看原尺寸细节</button>
      </details>

      {/* 局部调整 */}
      <details open>
        <summary>
          <Chevron />
          <span>局部调整</span>
          <button
            className="add-region"
            onClick={(event) => {
              event.preventDefault();
              props.onAddRegion('ellipse');
            }}
            disabled={!state || disabled || regionCount >= 4}
          >
            +
          </button>
        </summary>
        {state?.regions.map((region) => <RegionEditor key={region.id} region={region} disabled={disabled} onUpdate={props.onUpdateRegion} onDelete={() => props.onDeleteRegion(region.id)} activeBrushRegionId={props.activeBrushRegionId} onPaintBrush={props.onPaintBrush} activeRasterPaint={props.activeRasterPaint} onPaintRaster={props.onPaintRaster} />)}
        {regionCount === 0 && <p className="region-hint">使用椭圆、线性渐变或画笔蒙版，独立调整局部光线与颜色。</p>}
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('ellipse', 'outside')}>添加椭圆外径向蒙版</button>
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('linear')}>添加线性渐变</button>
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('brush')}>添加画笔蒙版</button>
      </details>
    </aside>
  );
}
