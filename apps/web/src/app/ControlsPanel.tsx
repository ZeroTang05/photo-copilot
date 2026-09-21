import type { EditState, GlobalKey, Region } from '@photo-copilot/domain';
import { Slider } from './Slider';

interface ControlsPanelProps {
  state?: EditState;
  disabled: boolean;
  allowComposition: boolean;
  onAllowCompositionChange: (next: boolean) => void;
  onGlobalChange: (key: GlobalKey, value: number) => void;
  onTransformChange: (patch: Partial<EditState['transform']>) => void;
  onCropChange: (key: 'x' | 'y' | 'width' | 'height', value: number) => void;
  onAspectLockChange: (value: EditState['transform']['aspectLock']) => void;
  onAddRegion: (shape?: Region['shape'], mode?: Region['mode']) => void;
  regionCount: number;
  onUpdateRegion: (region: Region) => void;
  onDeleteRegion: (regionId: string) => void;
  activeBrushRegionId?: string;
  onPaintBrush: (regionId?: string) => void;
  onResetCrop: () => void;
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

function RegionEditor({ region, disabled, onUpdate, onDelete, activeBrushRegionId, onPaintBrush }: { region: Region; disabled: boolean; onUpdate: (next: Region) => void; onDelete: () => void; activeBrushRegionId?: string; onPaintBrush: (regionId?: string) => void }) {
  const change = <K extends keyof Region>(key: K, value: Region[K]) => onUpdate({ ...region, [key]: value });
  const adjustment = (key: keyof Region['adjustments'], value: number) => onUpdate({ ...region, adjustments: { ...region.adjustments, [key]: value } });
  const isBrush = region.shape === 'brush';
  const isLinear = region.shape === 'linear';
  return <div className="region-editor">
    <div className="region-editor-head">
      <input aria-label="区域名称" value={region.label} disabled={disabled} maxLength={40} onChange={(event) => change('label', event.target.value)} />
      <button className="region-delete" disabled={disabled} onClick={onDelete}>删除</button>
    </div>
    <label className="check"><input type="checkbox" checked={region.enabled} disabled={disabled} onChange={(event) => change('enabled', event.target.checked)} />启用蒙版</label>
    <label className="select-row"><span>蒙版类型</span><select value={region.shape} disabled={disabled} onChange={(event) => change('shape', event.target.value as Region['shape'])}><option value="ellipse">椭圆径向</option><option value="linear">线性渐变</option><option value="brush">画笔</option></select></label>
    {region.shape === 'ellipse' && <label className="select-row"><span>影响范围</span><select value={region.mode} disabled={disabled} onChange={(event) => change('mode', event.target.value as Region['mode'])}><option value="inside">椭圆内</option><option value="outside">椭圆外</option></select></label>}
    {isBrush ? <>
      <button className={`brush-paint ${activeBrushRegionId === region.id ? 'active-tool' : ''}`} disabled={disabled} onClick={() => onPaintBrush(activeBrushRegionId === region.id ? undefined : region.id)}>{activeBrushRegionId === region.id ? '正在画面上涂抹' : '在画面上涂抹'}</button>
      <p className="region-hint">点击后直接在照片上拖动。再次点击按钮结束涂抹。</p>
      <Slider label="笔刷大小" value={region.brushRadius} min={.01} max={.35} step={.01} disabled={disabled} onChange={(value) => change('brushRadius', value)} />
      <p className="region-hint">已记录 {region.brushDabs.length}/32 个笔触点。</p>
    </> : <>
      <Slider label={isLinear ? '渐变中心 X' : '中心 X'} value={region.centerX} min={0} max={1} step={.01} disabled={disabled} onChange={(value) => change('centerX', value)} />
      <Slider label={isLinear ? '渐变中心 Y' : '中心 Y'} value={region.centerY} min={0} max={1} step={.01} disabled={disabled} onChange={(value) => change('centerY', value)} />
      {isLinear ? <>
        <Slider label="渐变方向" value={region.angleDeg} min={-180} max={180} step={1} unit="°" disabled={disabled} onChange={(value) => change('angleDeg', value)} />
        <Slider label="过渡范围" value={region.feather} min={.05} max={1} step={.01} disabled={disabled} onChange={(value) => change('feather', value)} />
      </> : <>
        <Slider label="横向范围" value={region.radiusX} min={0.01} max={1} step={.01} disabled={disabled} onChange={(value) => change('radiusX', value)} />
        <Slider label="纵向范围" value={region.radiusY} min={0.01} max={1} step={.01} disabled={disabled} onChange={(value) => change('radiusY', value)} />
        <Slider label="羽化" value={region.feather} min={0.05} max={1} step={0.01} disabled={disabled} onChange={(value) => change('feather', value)} />
      </>}
    </>}
    <Slider label="局部曝光" value={region.adjustments.exposureEV} min={-2} max={2} step={0.01} disabled={disabled} onChange={(value) => adjustment('exposureEV', value)} />
    <Slider label="局部高光" value={region.adjustments.highlights} min={-100} max={100} step={.1} disabled={disabled} onChange={(value) => adjustment('highlights', value)} />
    <Slider label="局部饱和" value={region.adjustments.saturation} min={-100} max={100} step={.1} disabled={disabled} onChange={(value) => adjustment('saturation', value)} />
  </div>;
}

export function ControlsPanel(props: ControlsPanelProps) {
  const { state, disabled, regionCount } = props;
  const crop = state?.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <aside className="controls">
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
          min={-10}
          max={10}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onTransformChange({ angleDeg: value })}
          unit="°"
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
          label="裁切左侧"
          value={crop.x}
          min={0}
          max={Math.max(0, 1 - crop.width)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('x', value)}
          resetValue={null}
        />
        <Slider
          label="裁切顶部"
          value={crop.y}
          min={0}
          max={Math.max(0, 1 - crop.height)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('y', value)}
          resetValue={null}
        />
        <Slider
          label="裁切宽度"
          value={crop.width}
          min={0.01}
          max={Math.max(0.01, 1 - crop.x)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('width', value)}
          resetValue={null}
        />
        <Slider
          label="裁切高度"
          value={crop.height}
          min={0.01}
          max={Math.max(0.01, 1 - crop.y)}
          step={0.01}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('height', value)}
          resetValue={null}
        />
        <button className="crop-reset" disabled={!state || disabled} onClick={props.onResetCrop}>恢复完整照片</button>
        <p className="crop-hint">先缩小“裁切宽度”或“裁切高度”，左侧与顶部才会有可移动空间。双击任何调色名称可归零。</p>
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
          onChange={(value) => props.onGlobalChange('exposureEV', value)}
        />
        <Slider
          label="对比度"
          value={state?.global.contrast ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('contrast', value)}
        />
        <Slider
          label="高光"
          value={state?.global.highlights ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('highlights', value)}
        />
        <Slider
          label="阴影"
          value={state?.global.shadows ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('shadows', value)}
        />
        <Slider
          label="白色色阶"
          value={state?.global.whites ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('whites', value)}
        />
        <Slider
          label="黑色色阶"
          value={state?.global.blacks ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('blacks', value)}
        />
        <Slider
          label="清晰度"
          value={state?.global.clarity ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('clarity', value)}
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
          onChange={(value) => props.onGlobalChange('warmth', value)}
        />
        <Slider
          label="色调"
          variant="tint"
          value={state?.global.tint ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('tint', value)}
        />
        <Slider
          label="自然饱和度"
          value={state?.global.vibrance ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('vibrance', value)}
        />
        <Slider
          label="饱和度"
          value={state?.global.saturation ?? 0}
          min={-100}
          max={100}
          step={0.1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('saturation', value)}
        />
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
        {state?.regions.map((region) => <RegionEditor key={region.id} region={region} disabled={disabled} onUpdate={props.onUpdateRegion} onDelete={() => props.onDeleteRegion(region.id)} activeBrushRegionId={props.activeBrushRegionId} onPaintBrush={props.onPaintBrush} />)}
        {regionCount === 0 && <p className="region-hint">使用椭圆、线性渐变或画笔蒙版，独立调整局部光线与颜色。</p>}
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('ellipse', 'outside')}>添加椭圆外径向蒙版</button>
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('linear')}>添加线性渐变</button>
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('brush')}>添加画笔蒙版</button>
      </details>
    </aside>
  );
}
