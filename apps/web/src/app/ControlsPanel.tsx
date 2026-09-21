import type { EditState, GlobalKey, Region } from '@photo-copilot/domain';
import { Slider, formatSigned } from './Slider';

interface ControlsPanelProps {
  state?: EditState;
  disabled: boolean;
  allowComposition: boolean;
  onAllowCompositionChange: (next: boolean) => void;
  onGlobalChange: (key: GlobalKey, value: number) => void;
  onTransformChange: (patch: Partial<EditState['transform']>) => void;
  onCropChange: (key: 'x' | 'y' | 'width' | 'height', value: number) => void;
  onAspectLockChange: (value: EditState['transform']['aspectLock']) => void;
  onAddRegion: (mode?: Region['mode']) => void;
  regionCount: number;
  onUpdateRegion: (region: Region) => void;
  onDeleteRegion: (regionId: string) => void;
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

const DisabledPlaceholder = ({ label }: { label: string }) => (
  <div className="placeholder" aria-label={`${label}（即将推出）`}>
    <span className="placeholder-label">{label}</span>
    <span className="placeholder-tag">即将推出</span>
  </div>
);

function RegionEditor({ region, disabled, onUpdate, onDelete }: { region: Region; disabled: boolean; onUpdate: (next: Region) => void; onDelete: () => void }) {
  const change = <K extends keyof Region>(key: K, value: Region[K]) => onUpdate({ ...region, [key]: value });
  const adjustment = (key: keyof Region['adjustments'], value: number) => onUpdate({ ...region, adjustments: { ...region.adjustments, [key]: value } });
  return <div className="region-editor">
    <div className="region-editor-head">
      <input aria-label="区域名称" value={region.label} disabled={disabled} maxLength={40} onChange={(event) => change('label', event.target.value)} />
      <button className="region-delete" disabled={disabled} onClick={onDelete}>删除</button>
    </div>
    <label className="check"><input type="checkbox" checked={region.enabled} disabled={disabled} onChange={(event) => change('enabled', event.target.checked)} />启用蒙版</label>
    <label className="select-row"><span>影响范围</span><select value={region.mode} disabled={disabled} onChange={(event) => change('mode', event.target.value as Region['mode'])}><option value="inside">椭圆内</option><option value="outside">椭圆外</option></select></label>
    <Slider label="中心 X" value={region.centerX} min={0} max={1} step={0.0001} disabled={disabled} onChange={(value) => change('centerX', value)} />
    <Slider label="中心 Y" value={region.centerY} min={0} max={1} step={0.0001} disabled={disabled} onChange={(value) => change('centerY', value)} />
    <Slider label="横向范围" value={region.radiusX} min={0.01} max={1} step={0.0001} disabled={disabled} onChange={(value) => change('radiusX', value)} />
    <Slider label="纵向范围" value={region.radiusY} min={0.01} max={1} step={0.0001} disabled={disabled} onChange={(value) => change('radiusY', value)} />
    <Slider label="羽化" value={region.feather} min={0.05} max={1} step={0.01} disabled={disabled} onChange={(value) => change('feather', value)} />
    <Slider label="局部曝光" value={region.adjustments.exposureEV} min={-2} max={2} step={0.01} disabled={disabled} onChange={(value) => adjustment('exposureEV', value)} formatValue={(value) => formatSigned(value, 2)} />
    <Slider label="局部高光" value={region.adjustments.highlights} min={-100} max={100} step={1} disabled={disabled} onChange={(value) => adjustment('highlights', value)} formatValue={(value) => formatSigned(value)} />
    <Slider label="局部饱和" value={region.adjustments.saturation} min={-100} max={100} step={1} disabled={disabled} onChange={(value) => adjustment('saturation', value)} formatValue={(value) => formatSigned(value)} />
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
          formatValue={(value) => `${value.toFixed(1)}°`}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={props.allowComposition}
            onChange={(event) => props.onAllowCompositionChange(event.target.checked)}
          />
          允许 AI 建议构图
        </label>
        <Slider
          label="裁切左侧"
          value={crop.x}
          min={0}
          max={Math.max(0, 1 - crop.width)}
          step={0.0001}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('x', value)}
        />
        <Slider
          label="裁切顶部"
          value={crop.y}
          min={0}
          max={Math.max(0, 1 - crop.height)}
          step={0.0001}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('y', value)}
        />
        <Slider
          label="裁切宽度"
          value={crop.width}
          min={0.01}
          max={Math.max(0.01, 1 - crop.x)}
          step={0.0001}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('width', value)}
        />
        <Slider
          label="裁切高度"
          value={crop.height}
          min={0.01}
          max={Math.max(0.01, 1 - crop.y)}
          step={0.0001}
          disabled={!state || disabled}
          onChange={(value) => props.onCropChange('height', value)}
        />
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
          formatValue={(value) => formatSigned(value, 2)}
        />
        <Slider
          label="对比度"
          value={state?.global.contrast ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('contrast', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="高光"
          value={state?.global.highlights ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('highlights', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="阴影"
          value={state?.global.shadows ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('shadows', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="白色色阶"
          value={state?.global.whites ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('whites', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="黑色色阶"
          value={state?.global.blacks ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('blacks', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="清晰度"
          value={state?.global.clarity ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('clarity', value)}
          formatValue={(value) => formatSigned(value)}
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
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('warmth', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="色调"
          variant="tint"
          value={state?.global.tint ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('tint', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="自然饱和度"
          value={state?.global.vibrance ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('vibrance', value)}
          formatValue={(value) => formatSigned(value)}
        />
        <Slider
          label="饱和度"
          value={state?.global.saturation ?? 0}
          min={-100}
          max={100}
          step={1}
          disabled={!state || disabled}
          onChange={(value) => props.onGlobalChange('saturation', value)}
          formatValue={(value) => formatSigned(value)}
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
              props.onAddRegion();
            }}
            disabled={!state || disabled || regionCount >= 4}
          >
            +
          </button>
        </summary>
        {state?.regions.map((region) => <RegionEditor key={region.id} region={region} disabled={disabled} onUpdate={props.onUpdateRegion} onDelete={() => props.onDeleteRegion(region.id)} />)}
        {regionCount === 0 && <p className="region-hint">添加椭圆蒙版后可独立调整局部光线与颜色。</p>}
        <button className="region-add-outside" disabled={!state || disabled || regionCount >= 4} onClick={() => props.onAddRegion('outside')}>添加椭圆外径向蒙版</button>
        <DisabledPlaceholder label="画笔蒙版" />
        <DisabledPlaceholder label="线性渐变" />
      </details>
    </aside>
  );
}
