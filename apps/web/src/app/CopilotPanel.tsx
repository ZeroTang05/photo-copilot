import type { ChangeEvent } from 'react';
import type { PlanPayload } from '@photo-copilot/domain';
import { photoFileAccept } from '../lib/image-import';

interface CopilotPanelProps {
  status: string;
  instruction: string;
  setInstruction: (value: string) => void;
  hasState: boolean;
  busy: boolean;
  onAuto: () => void;
  onFollowup: () => void;
  onSegment: () => void;
  pointSegmentationSupported: boolean;
  pointSelectionActive: boolean;
  onTogglePointSelection: () => void;
  onCancel: () => void;
  onClose: () => void;
  thumbnail?: string;
  candidate?: PlanPayload;
  onApply: () => void;
  onDiscard: () => void;
  referencePhoto?: { name: string; thumbnail: string };
  onReferenceImport: (file: File) => void;
  onRemoveReference: () => void;
}

const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const IconSparkles = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2 13.5 8.5 20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5L12 2z" />
    <path d="M19 14l.8 3.2 3.2.8-3.2.8L19 22l-.8-3.2L15 18l3.2-.8L19 14z" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

export function CopilotPanel(props: CopilotPanelProps) {
  const charCount = props.instruction.length;
  const charLimit = 500;
  const handleInstruction = (event: ChangeEvent<HTMLTextAreaElement>) => props.setInstruction(event.target.value.slice(0, charLimit));
  const handleReference = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) props.onReferenceImport(file);
    event.target.value = '';
  };
  return (
    <section className="copilot">
      <div className="copilot-header">
        <span className="copilot-title"><IconSparkles /> AI 副驾</span>
        <span className="copilot-subtitle">{props.status}</span>
        <button className="copilot-close" onClick={props.onClose} aria-label="关闭 AI 面板"><IconClose /></button>
      </div>
      <div className="copilot-body">
        {props.candidate ? (
          <SuggestionPanel
            candidate={props.candidate}
            thumbnail={props.thumbnail}
            onApply={props.onApply}
            onDiscard={props.onDiscard}
          />
        ) : (
          <div className="copilot-empty">
            <div className="copilot-empty-text">
              {props.hasState
                ? '点击分析并建议，或用一句话说明希望保留和改变的内容。'
                : '导入照片后可获得可解释的参数建议。'}
            </div>
          </div>
        )}
        <div className="copilot-input">
          <div className="reference-row">
            <label className="reference-upload" title="上传一张参考图，让 AI 参考其调色风格">
              <input type="file" accept={photoFileAccept} disabled={!props.hasState || props.busy} onChange={handleReference} />
              <span>添加参考图</span>
            </label>
            {props.referencePhoto && <div className="reference-chip">
              <img src={props.referencePhoto.thumbnail} alt={`参考图：${props.referencePhoto.name}`} />
              <span title={props.referencePhoto.name}>{props.referencePhoto.name}</span>
              <button type="button" aria-label="移除参考图" title="移除参考图" disabled={props.busy} onClick={props.onRemoveReference}>×</button>
            </div>}
          </div>
          <textarea
            value={props.instruction}
            maxLength={charLimit}
            onChange={handleInstruction}
            placeholder="用自然语言描述你想要的修改效果,例如:让天空更通透,突出夕阳的色彩"
            disabled={!props.hasState}
          />
          <div className="copilot-input-meta">
            <span className="char-count">{charCount}/{charLimit}</span>
          </div>
          <div className="copilot-input-actions">
            <div className="spacer" />
            <button className="discard" disabled={!props.busy} onClick={props.onCancel}>取消</button>
            <button className="ghost" disabled={!props.hasState || props.busy} onClick={props.onAuto}>分析并建议</button>
            <button className="ghost" disabled={!props.hasState || props.busy || !props.instruction.trim()} onClick={props.onSegment}>AI 局部调整</button>
            {props.pointSegmentationSupported && <button className={`ghost ${props.pointSelectionActive ? 'active-tool' : ''}`} disabled={!props.hasState || props.busy} onClick={props.onTogglePointSelection}>{props.pointSelectionActive ? '结束点选' : '点选物体'}</button>}
            <button className="primary" disabled={!props.hasState || props.busy || !props.instruction.trim()} onClick={props.onFollowup}>应用</button>
          </div>
        </div>
      </div>
    </section>
  );
}

interface SuggestionPanelProps {
  candidate: PlanPayload;
  thumbnail?: string;
  onApply: () => void;
  onDiscard: () => void;
}

function SuggestionPanel({ candidate, thumbnail, onApply, onDiscard }: SuggestionPanelProps) {
  const title = candidate.message || '编辑计划';
  const description = candidate.observations.join(' ');
  return (
    <div className="suggestion">
      {thumbnail && <img className="suggestion-thumb" src={thumbnail} alt="预览" />}
      <div className="suggestion-text">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {candidate.reasons.map((reason) => (
          <small key={reason.target}>{reason.intent}</small>
        ))}
      </div>
      <div className="suggestion-actions">
        <button className="primary" onClick={onApply}>应用此建议 <IconChevronRight /></button>
        <button className="ghost" onClick={onDiscard}>放弃</button>
      </div>
    </div>
  );
}
