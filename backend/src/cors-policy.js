const desktopOrigins=new Set(['tauri://localhost','http://tauri.localhost','https://tauri.localhost']);
export function isAllowedOrigin(origin,configured=[]){
  // Preserve the existing non-browser/legacy opaque-origin contract, while
  // matching named desktop and administrator-configured web origins exactly.
  return !origin||origin==='null'||desktopOrigins.has(origin)||configured.includes(origin);
}
