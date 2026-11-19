import { EventEmitter } from 'node:events';

export interface DomainEvent {
  type: string;
  order_id?: string;
  status?: string;
  protocol?: string;
  at: string;
  data?: Record<string, unknown>;
}

/** In-process pub/sub that feeds the live SSE stream of the merchant console. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(200);
  }
  publish(event: Omit<DomainEvent, 'at'>) {
    this.emitter.emit('event', { ...event, at: new Date().toISOString() } satisfies DomainEvent);
  }
  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
