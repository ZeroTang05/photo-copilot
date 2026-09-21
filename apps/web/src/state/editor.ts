import { create } from 'zustand';
import { applyChanges, defaultGlobal, type EditState, type PlanPayload } from '@photo-copilot/domain';

export interface Candidate {
  payload: PlanPayload;
  planId: string;
  requestId: string;
  baseRevision: number;
}

export interface ImageSlot {
  blob: Blob;
  name: string;
  thumbnail: string; // data URL for sidebar
  state: EditState;
  history: EditState[];
  future: EditState[];
}

interface ActiveInteraction {
  imageIndex: number;
  initialState: EditState;
}

interface EditorStore {
  images: ImageSlot[];
  activeIndex: number;
  candidate?: Candidate;
  interaction?: ActiveInteraction;
  addImage: (slot: { blob: Blob; name: string; thumbnail: string; state: EditState }) => void;
  setActiveIndex: (index: number) => void;
  removeImage: (index: number) => void;
  beginInteraction: () => void;
  preview: (next: EditState) => void;
  endInteraction: () => void;
  commit: (next: EditState) => void;
  undo: () => void;
  redo: () => void;
  setCandidate: (candidate?: Candidate) => void;
  reset: () => void;
}

const HISTORY_LIMIT = 100;

const sameState = (left: EditState, right: EditState) => JSON.stringify(left) === JSON.stringify(right);

export const useEditor = create<EditorStore>((set, get) => ({
  images: [],
  activeIndex: -1,
  addImage: (slot) => {
    const images = [
      ...get().images,
      { ...slot, history: [], future: [] } satisfies ImageSlot,
    ];
    set({ images, activeIndex: images.length - 1, candidate: undefined, interaction: undefined });
  },
  setActiveIndex: (index) => {
    const images = get().images;
    if (index < 0 || index >= images.length) return;
    set({ activeIndex: index, candidate: undefined, interaction: undefined });
  },
  removeImage: (index) => {
    const images = [...get().images];
    images.splice(index, 1);
    const activeIndex = get().activeIndex;
    let nextActive = activeIndex;
    if (images.length === 0) nextActive = -1;
    else if (activeIndex >= images.length) nextActive = images.length - 1;
    else if (activeIndex > index) nextActive = activeIndex - 1;
    set({ images, activeIndex: nextActive, candidate: undefined, interaction: undefined });
  },
  beginInteraction: () => {
    const { images, activeIndex, interaction } = get();
    if (interaction || activeIndex < 0) return;
    const slot = images[activeIndex];
    if (!slot) return;
    set({ interaction: { imageIndex: activeIndex, initialState: slot.state } });
  },
  preview: (next) => {
    const { images, activeIndex, interaction } = get();
    if (!interaction || interaction.imageIndex !== activeIndex) return;
    const slot = images[activeIndex];
    if (!slot) return;
    const nextImages = [...images];
    nextImages[activeIndex] = {
      ...slot,
      // 拖动期间沿用起始 revision，防止每个像素移动都被当成一项编辑。
      state: { ...next, revision: interaction.initialState.revision },
    };
    set({ images: nextImages, candidate: undefined });
  },
  endInteraction: () => {
    const { images, activeIndex, interaction } = get();
    if (!interaction) return;
    if (interaction.imageIndex !== activeIndex) {
      set({ interaction: undefined });
      return;
    }
    const slot = images[activeIndex];
    if (!slot) {
      set({ interaction: undefined });
      return;
    }
    if (sameState(slot.state, interaction.initialState)) {
      set({ interaction: undefined });
      return;
    }
    const updated: ImageSlot = {
      ...slot,
      state: { ...slot.state, revision: interaction.initialState.revision + 1 },
      history: [...slot.history, interaction.initialState].slice(-HISTORY_LIMIT),
      future: [],
    };
    const nextImages = [...images];
    nextImages[activeIndex] = updated;
    set({ images: nextImages, candidate: undefined, interaction: undefined });
  },
  commit: (next) => {
    const { images, activeIndex } = get();
    if (activeIndex < 0) return;
    const slot = images[activeIndex];
    if (!slot) return;
    const updated: ImageSlot = {
      ...slot,
      state: { ...next, revision: slot.state.revision + 1 },
      history: [...slot.history, slot.state].slice(-HISTORY_LIMIT),
      future: [],
    };
    const nextImages = [...images];
    nextImages[activeIndex] = updated;
    set({ images: nextImages, candidate: undefined, interaction: undefined });
  },
  undo: () => {
    const { images, activeIndex } = get();
    if (activeIndex < 0) return;
    const slot = images[activeIndex];
    if (!slot || slot.history.length === 0) return;
    const prior = slot.history[slot.history.length - 1];
    if (!prior) return;
    const updated: ImageSlot = {
      ...slot,
      state: { ...prior, revision: slot.state.revision + 1 },
      history: slot.history.slice(0, -1),
      future: [slot.state, ...slot.future],
    };
    const nextImages = [...images];
    nextImages[activeIndex] = updated;
    set({ images: nextImages, candidate: undefined, interaction: undefined });
  },
  redo: () => {
    const { images, activeIndex } = get();
    if (activeIndex < 0) return;
    const slot = images[activeIndex];
    if (!slot || slot.future.length === 0) return;
    const next = slot.future[0];
    if (!next) return;
    const updated: ImageSlot = {
      ...slot,
      state: { ...next, revision: slot.state.revision + 1 },
      history: [...slot.history, slot.state],
      future: slot.future.slice(1),
    };
    const nextImages = [...images];
    nextImages[activeIndex] = updated;
    set({ images: nextImages, candidate: undefined, interaction: undefined });
  },
  setCandidate: (candidate) => set({ candidate }),
  reset: () => {
    const { images, activeIndex } = get();
    if (activeIndex < 0) return;
    const slot = images[activeIndex];
    if (!slot) return;
    const resetState: EditState = {
      ...slot.state,
      revision: slot.state.revision + 1,
      global: defaultGlobal(),
      transform: { angleDeg: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, aspectLock: 'original' },
      regions: [],
    };
    const updated: ImageSlot = {
      ...slot,
      state: resetState,
      history: [...slot.history, slot.state].slice(-HISTORY_LIMIT),
      future: [],
    };
    const nextImages = [...images];
    nextImages[activeIndex] = updated;
    set({ images: nextImages, candidate: undefined, interaction: undefined });
  },
}));

export function activeSlot(state: EditorStore): ImageSlot | undefined {
  if (state.activeIndex < 0) return undefined;
  return state.images[state.activeIndex];
}

// Re-export so other modules can use applyChanges without importing from domain directly.
export { applyChanges };
