import { useState, type ChangeEvent } from 'react';

interface TopBarProps {
  hasState: boolean;
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  zoom: number;
  onImport: (files: File[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCompareStart: () => void;
  onCompareEnd: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomPreset: (value: number) => void;
  onFit: () => void;
  onExport: () => void;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
}

const IconImport = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const IconUndo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 6 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const IconRedo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 18 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const IconCompare = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);

const IconZoomOut = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconZoomIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="12" y1="5" x2="12" y2="19" />
  </svg>
);

const IconExport = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export function TopBar(props: TopBarProps) {
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) props.onImport(files);
    event.target.value = '';
  };
  return (
    <header className="toolbar">
      <label className="import">
        <input type="file" accept="image/jpeg,image/png" multiple onChange={handleFile} />
        <IconImport />
        <span>导入</span>
      </label>
      <div className="toolbar-divider" />
      <button className="tool" disabled={!props.hasState || !props.canUndo} onClick={props.onUndo} title="撤销 (Ctrl+Z)">
        <IconUndo />
        <span>撤销</span>
      </button>
      <button className="tool" disabled={!props.hasState || !props.canRedo} onClick={props.onRedo} title="重做 (Ctrl+Shift+Z)">
        <IconRedo />
        <span>重做</span>
      </button>
      <button className="tool" disabled={!props.hasState} onMouseDown={props.onCompareStart} onMouseUp={props.onCompareEnd} onMouseLeave={props.onCompareEnd} title="按住查看原图">
        <IconCompare />
        <span>对比</span>
      </button>
      <button className={`tool ${props.copilotOpen ? 'active-tool' : ''}`} onClick={props.onToggleCopilot} title="显示或隐藏 AI 副驾">
        <span>AI 副驾</span>
      </button>
      <div className="toolbar-spacer" />
      <div className="zoom">
        <button className="zoom-btn" onClick={props.onZoomOut} title="缩小">−</button>
        <button className="zoom-fit" onClick={props.onFit} title="适应窗口">{props.zoom}%</button>
        <button className="zoom-btn" onClick={props.onZoomIn} title="放大">+</button>
        <button className="zoom-menu" onClick={() => setShowZoomMenu((value) => !value)} title="缩放选项" aria-label="缩放选项">▾</button>
        {showZoomMenu && <div className="zoom-popover">{[25, 50, 100, 150, 200].map((value) => <button key={value} onClick={() => { props.onZoomPreset(value); setShowZoomMenu(false); }}>{value}%</button>)}</div>}
      </div>
      <button className="export" disabled={!props.hasState || props.exporting} onClick={props.onExport}>
        <IconExport />
        <span>{props.exporting ? '导出中' : '导出'}</span>
      </button>
    </header>
  );
}
