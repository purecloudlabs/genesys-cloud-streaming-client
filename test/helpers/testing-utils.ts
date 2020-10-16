export function wait (milliseconds: number = 10): Promise<void> {
  return new Promise(res => setTimeout(res, milliseconds));
}
