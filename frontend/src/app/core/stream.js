import { createEventStream } from '../../lib/event-stream.js';

// Singleton EventStream for realtime channels
export const eventStream = createEventStream();

