import { useState } from 'react';
import { mediaFrameSize, type MediaDisplayFit } from '../lib/mediaFrame';

export default function ResourceImage({ src, name, aspect, fit='contain' }: { src: string; name: string; aspect: string; fit?:MediaDisplayFit }) {
  const [natural, setNatural] = useState(16 / 9);
  // The enclosing zoom viewport supplies the available height. The selected
  // ratio describes the frame, while contain keeps every pixel undistorted.
  const ratio = mediaFrameSize(1, Number.MAX_SAFE_INTEGER, aspect, natural);
  return <div className="resource-image-frame" data-media-aspect={aspect} data-media-fit={fit} style={{ aspectRatio: `${ratio.width} / ${ratio.height}`, maxWidth: `calc(var(--resource-viewport-height) * ${ratio.width / ratio.height})` }}>
    <img draggable={false} src={src} alt={name} onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setNatural(image.naturalWidth / image.naturalHeight); }} className="h-full w-full" style={{objectFit:fit}}/>
  </div>;
}
