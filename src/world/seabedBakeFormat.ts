/** Shared by the app and tools/bake-seabed.mjs (kept free of imports so Node can load it). Bump when the layout changes. */
export const SEABED_BAKE_VERSION = 1;

/** FNV-1a over the profile source, so a stale bake can be detected in development. */
export function sourceHash(src: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
