export function wait (milliseconds: number = 10): Promise<void> {
  return new Promise(res => setTimeout(res, milliseconds));
}

const realSetImmediate = setImmediate;
export const flushPromises = () => new Promise(realSetImmediate);
