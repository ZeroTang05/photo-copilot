import type { ChangeEvent } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  variant?: 'default' | 'warmth' | 'tint';
}

export function Slider({ label, value, min, max, step, disabled, onChange, formatValue, variant = 'default' }: SliderProps) {
  const display = formatValue ? formatValue(value) : value.toFixed(step < 1 ? 2 : 0);
  const handleRange = (event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value));
  const handleNumber = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(next);
  };
  return (
    <label className={`slider slider-${variant}`}>
      <span className="slider-label">{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={handleRange} />
      <input
        aria-label={`${label}数值`}
        className="slider-value"
        type="text"
        value={display}
        readOnly={disabled}
        onChange={handleNumber}
      />
    </label>
  );
}

export function formatSigned(value: number, decimals = 0): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}