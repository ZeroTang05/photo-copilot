import type { ImageSlot } from '../state/editor';

interface ThumbnailSidebarProps {
  images: ImageSlot[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}

const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export function ThumbnailSidebar({ images, activeIndex, onSelect, onRemove }: ThumbnailSidebarProps) {
  const slots = images.length > 0 ? images : [];
  return (
    <aside className="thumbnails">
      {slots.map((slot, index) => (
        <div
          key={`${slot.name}-${index}`}
          className={`thumbnail ${index === activeIndex ? 'active' : ''}`}
          onClick={() => onSelect(index)}
        >
          <img src={slot.thumbnail} alt={slot.name} />
          {index === activeIndex && (
            <button
              className="thumbnail-close"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(index);
              }}
              title="移除图片"
              aria-label="移除图片"
            >
              <IconClose />
            </button>
          )}
        </div>
      ))}
      {slots.length === 0 && (
        <div className="thumbnail-empty" aria-hidden="true">
          <IconPlus />
        </div>
      )}
    </aside>
  );
}