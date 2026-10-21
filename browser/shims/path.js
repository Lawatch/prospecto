export function join(...parts) {
  return parts.filter((p) => p !== '' && p != null).join('/').replace(/\/+/g, '/');
}
export const resolve = join;
export function extname(p) {
  const m = String(p).match(/(\.[^./\\]*)$/);
  return m ? m[1] : '';
}
export function basename(p) {
  return String(p).split('/').pop();
}
export function dirname(p) {
  return String(p).split('/').slice(0, -1).join('/') || '/';
}
export default { join, resolve, extname, basename, dirname };
