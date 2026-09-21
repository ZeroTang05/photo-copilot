import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  resetValue?: number | null;
  unit?: string;
  variant?: 'default' | 'warmth' | 'tint';
}

interface DragState { startX: number; startValue: number; }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const decimalsFor = (step: number) => Math.max(0, Math.min(4, `${step}`.split('.')[1]?.length ?? 0));

// 数值框负责精确输入；名称区域支持专业软件常见的 scrub 拖动。
// Shift 加速，Alt/Option 进入精细模式，双击名称归零。
export function Slider({ label, value, min, max, step, disabled, onChange, resetValue, unit, variant = 'default' }: SliderProps) {
  const drag = useRef<DragState | undefined>(undefined);
  const decimals = decimalsFor(step);
  const rangeStep = step / 10;
  const emit = (next: number, precision = rangeStep) => {
    const rounded = Number((Math.round(next / precision) * precision).toFixed(Math.max(decimals + 1, 2)));
    onChange(clamp(rounded, min, max));
  };
  const handleRange = (event: ChangeEvent<HTMLInputElement>) => emit(Number(event.target.value));
  const handleNumber = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.valueAsNumber;
    if (Number.isFinite(next)) emit(next, rangeStep);
  };
  const handleScrubStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    drag.current = { startX: event.clientX, startValue: value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const handleScrubMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || disabled) return;
    const mode = event.altKey ? 0.1 : event.shiftKey ? 5 : 1;
    // 约 240px 走完整个数值区间，日常拖动与精确微调都有足够空间。
    emit(drag.current.startValue + (event.clientX - drag.current.startX) * ((max - min) / 240) * mode);
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { if (resetValue !== null) emit(resetValue ?? (min <= 0 && max >= 0 ? 0 : min)); return; }
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const multiplier = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
    emit(value + direction * step * multiplier);
  };
  const defaultValue = resetValue ?? (min <= 0 && max >= 0 ? 0 : min);
  return (
    <div className={`slider slider-${variant}`}>
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
        title="拖动调整；Shift 加速；Alt 精细；双击归零"
      >{label}</button>
      <input type="range" value={value} min={min} max={max} step={rangeStep} disabled={disabled} onChange={handleRange} />
      <label className="slider-number">
        <input aria-label={`${label}数值`} className="slider-value" type="number" value={Number(value.toFixed(Math.max(decimals + 1, 2)))} min={min} max={max} step={rangeStep} disabled={disabled} onChange={handleNumber} />
        {unit && <span>{unit}</span>}
      </label>
    </div>
  );
}
