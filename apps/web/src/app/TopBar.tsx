import { useState, type ChangeEvent } from 'react';
import { photoFileAccept } from '../lib/image-import';

export type ExportFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff';

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
  onFit: () => void;
  onExport: (format: ExportFormat) => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleBottomPanel: () => void;
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) props.onImport(files);
    event.target.value = '';
  };
  return (
    <header className="toolbar">
      <label className="import">
        <input type="file" accept={photoFileAccept} multiple onChange={handleFile} />
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
      <div className="panel-switcher" aria-label="工作区面板">
        <button className={`tool ${props.leftPanelOpen ? 'active-tool' : ''}`} aria-pressed={props.leftPanelOpen} onClick={props.onToggleLeftPanel} title="显示或隐藏缩略图栏">缩略图</button>
        <button className={`tool ${props.rightPanelOpen ? 'active-tool' : ''}`} aria-pressed={props.rightPanelOpen} onClick={props.onToggleRightPanel} title="显示或隐藏调整栏">调整</button>
        <button className={`tool ${props.bottomPanelOpen ? 'active-tool' : ''}`} aria-pressed={props.bottomPanelOpen} onClick={props.onToggleBottomPanel} title="显示或隐藏 AI 副驾">AI 副驾</button>
      </div>
      <div className="toolbar-spacer" />
      <div className="zoom">
        <button className="zoom-btn" onClick={props.onZoomOut} title="缩小">−</button>
        <button className="zoom-fit" onClick={props.onFit} title="适应窗口">{props.zoom}%</button>
        <button className="zoom-btn" onClick={props.onZoomIn} title="放大">+</button>
      </div>
      <div className="export-group">
        <select className="export-format" aria-label="导出格式" value={exportFormat} disabled={!props.hasState || props.exporting} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="webp">WebP</option>
          <option value="avif">AVIF</option>
          <option value="tiff">TIFF</option>
        </select>
        <button className="export" disabled={!props.hasState || props.exporting} onClick={() => props.onExport(exportFormat)}>
          <IconExport />
          <span>{props.exporting ? '导出中' : '导出'}</span>
        </button>
      </div>
    </header>
  );
}
