export function randomUUID() {
  return globalThis.crypto.randomUUID();
}
export default { randomUUID };
