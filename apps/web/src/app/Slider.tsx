import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  // transient 表示正在连续拖动，父组件只更新预览，不写入撤销记录。
  onChange: (value: number, transient?: boolean) => void;
  resetValue?: number | null;
  unit?: string;
  variant?: 'default' | 'warmth' | 'tint';
}

interface DragState { lastX: number; rawValue: number; }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const decimalsFor = (step: number) => Math.max(0, Math.min(4, `${step}`.split('.')[1]?.length ?? 0));

// 所有入口都对齐到 step 指定的最小单位，避免出现难以复现的连续小数。
// Shift 加速，Alt/Option 降低鼠标拖动速度，双击名称归零。
export function Slider({ label, value, min, max, step, disabled, onChange, resetValue, unit, variant = 'default' }: SliderProps) {
  const drag = useRef<DragState | undefined>(undefined);
  const rangeDragging = useRef(false);
  const decimals = decimalsFor(step);
  const emit = (next: number, transient = false) => {
    const rounded = Number((Math.round(next / step) * step).toFixed(decimals));
    const normalized = clamp(rounded, min, max);
    onChange(normalized, transient);
    return normalized;
  };
  const handleRange = (event: ChangeEvent<HTMLInputElement>) => emit(Number(event.target.value), rangeDragging.current);
  const handleNumber = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.valueAsNumber;
    if (Number.isFinite(next)) emit(next);
  };
  const handleScrubStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    drag.current = { lastX: event.clientX, rawValue: value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const handleScrubMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || disabled) return;
    const mode = event.altKey ? 0.2 : event.shiftKey ? 5 : 1;
    // 保留未舍入的累计值：数值很小的参数在 Alt 精调时也会稳定地逐格前进。
    // 只在写入状态时按 step 对齐，因此切换 Shift、Alt 不会让拖动路径重新计算。
    const next = clamp(drag.current.rawValue + (event.clientX - drag.current.lastX) * ((max - min) / 240) * mode, min, max);
    drag.current = { lastX: event.clientX, rawValue: next };
    emit(next, true);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { if (resetValue !== null) emit(resetValue ?? (min <= 0 && max >= 0 ? 0 : min)); return; }
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const multiplier = event.shiftKey ? 10 : 1;
    emit(value + direction * step * multiplier);
  };
  const defaultValue = resetValue ?? (min <= 0 && max >= 0 ? 0 : min);
  return (
    <div className={`slider slider-${variant}${unit ? ' slider-has-unit' : ''}`}>
      <button
        type="button"
        className="slider-label slider-scrub"
        disabled={disabled}
        onPointerDown={handleScrubStart}
        onPointerMove={handleScrubMove}
        onPointerUp={() => { drag.current = undefined; }}
        onPointerCancel={() => { drag.current = undefined; }}
        onDoubleClick={() => { if (resetValue !== null) emit(defaultValue); }}
        onKeyDown={handleKey}
        title="拖动调整；Shift 加速；按住 Alt 降低拖动速度；双击归零"
      >{label}</button>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onPointerDown={() => { rangeDragging.current = true; }}
        onPointerUp={() => { rangeDragging.current = false; }}
        onPointerCancel={() => { rangeDragging.current = false; }}
        onChange={handleRange}
      />
      <div className="slider-number">
        <input aria-label={`${label}数值`} className="slider-value" type="number" value={Number(value.toFixed(decimals))} min={min} max={max} step={step} disabled={disabled} onChange={handleNumber} />
        <span className="slider-stepper" aria-label={`${label}步进调整`}>
          <button type="button" disabled={disabled || value >= max} onClick={() => emit(value + step)} aria-label={`${label}增加`}><span aria-hidden="true">▲</span></button>
          <button type="button" disabled={disabled || value <= min} onClick={() => emit(value - step)} aria-label={`${label}减少`}><span aria-hidden="true">▼</span></button>
        </span>
        {unit && <span className="slider-unit">{unit}</span>}
      </div>
    </div>
  );
}
