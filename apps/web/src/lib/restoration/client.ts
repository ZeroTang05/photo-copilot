import restorationWorkerUrl from './worker.ts?worker&url';
import type { RestorationRequest, RestorationResult } from './types';

interface Pending {
  resolve: (value: RestorationResult) => void;
  reject: (reason: Error) => void;
}

/** 主线程只接收当前 generation 的结果，旧任务无法覆盖新滑杆值。 */
export class RestorationClient {
  private worker?: Worker;
  private pending = new Map<number, Pending>();

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(restorationWorkerUrl, { type: 'classic', name: 'photo-restoration' });
    worker.onmessage = (event: MessageEvent<any>) => {
      const message = event.data;
      const pending = this.pending.get(message.generation);
      if (!pending) { if (message.bitmap instanceof ImageBitmap) message.bitmap.close(); return; }
      this.pending.delete(message.generation);
      if (message.type === 'complete') pending.resolve(message);
      else pending.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || '图像处理线程异常结束');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear(); this.worker?.terminate(); this.worker = undefined;
    };
    this.worker = worker;
    return worker;
  }

  prepare(request: RestorationRequest) {
    const worker = this.ensureWorker();
    return new Promise<RestorationResult>((resolve, reject) => {
      this.pending.set(request.generation, { resolve, reject });
      worker.postMessage({ type: 'prepare', ...request });
    });
  }

  cancel(generation: number) {
    this.worker?.postMessage({ type: 'cancel', generation });
    for (const [key, pending] of this.pending) if (key < generation) { pending.reject(new DOMException('已由新的图像处理任务替换', 'AbortError')); this.pending.delete(key); }
  }

  releaseImage(imageId: string) { this.worker?.postMessage({ type: 'release', imageId }); }

  dispose() {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(new DOMException('图像处理已结束', 'AbortError'));
    this.pending.clear();
  }
}

export const restorationClient = new RestorationClient();
