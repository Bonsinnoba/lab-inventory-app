export type MediaDisplayFit = 'contain' | 'cover';
export function mediaFrameSize(width: number, height: number, aspect: string, natural: number) {
  const ratios: Record<string, number> = { '16/9': 16 / 9, '4/3': 4 / 3, '1/1': 1, '9/16': 9 / 16 };
  const selected = ratios[aspect];
  const ratio = typeof selected === 'number' ? selected : (Number.isFinite(natural) && natural > 0 ? natural : 16 / 9);
  const availableWidth = Number.isFinite(width) ? Math.max(1, width) : 1, availableHeight = Number.isFinite(height) ? Math.max(1, height) : 1;
  const fittedWidth = Math.min(availableWidth, availableHeight * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}
