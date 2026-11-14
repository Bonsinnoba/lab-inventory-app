export function mediaFrameSize(width: number, height: number, aspect: string, natural: number) {
  const ratios: Record<string, number> = { '16/9': 16 / 9, '4/3': 4 / 3, '1/1': 1, '9/16': 9 / 16 };
  const selected = ratios[aspect];
  const ratio = typeof selected === 'number' ? selected : (Number.isFinite(natural) && natural > 0 ? natural : 16 / 9);
  const availableWidth = Math.max(1, width), availableHeight = Math.max(1, height);
  const fittedWidth = Math.min(availableWidth, availableHeight * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}
