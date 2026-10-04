import { Parser } from 'htmlparser2';

export const DOCX_INPUT_LIMIT = 4 * 1024 * 1024;
const tags = new Set('html body p div span h1 h2 h3 h4 h5 h6 strong b em i u s del sub sup br hr ul ol li table thead tbody tfoot tr td th colgroup col a img blockquote pre code'.split(' '));
const forbidden = new Set('script style link svg math iframe object embed video audio source'.split(' '));
const styles = new Set('color background-color font-family font-size font-weight font-style text-decoration text-align vertical-align white-space margin margin-left margin-right margin-top margin-bottom padding padding-left padding-right padding-top padding-bottom border border-collapse border-color border-width border-style width height line-height'.split(' '));
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function invalid(message) { const error = new Error(message); error.status = 422; throw error; }

// Rebuild a constrained HTML dialect. No remote/local image URLs, style sheets,
// SVG references or converter-specific attributes can reach the converter.
export function validateDocxHtml(html) {
  if (typeof html !== 'string') invalid('html must be a string');
  if (Buffer.byteLength(html) > DOCX_INPUT_LIMIT) invalid('DOCX input exceeds 4 MiB');
  let output = '', nodes = 0, depth = 0, images = 0;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (++nodes > 20000 || ++depth > 64) invalid('DOCX markup is too complex');
      if (forbidden.has(name)) invalid(`Unsupported DOCX element: ${name}`);
      if (!tags.has(name)) return;
      const safe = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (key === 'style') {
          safe.style = value.split(';').filter(part => {
            const colon = part.indexOf(':');
            return styles.has(part.slice(0, colon).trim().toLowerCase()) && /^[a-z0-9 #.,%()'"+\-:]+$/i.test(part) && !/url|expression|import/i.test(part);
          }).join(';');
        } else if (['colspan', 'rowspan', 'width', 'height', 'start'].includes(key) && /^\d{1,4}%?$/.test(value)) safe[key] = value;
        else if (['alt', 'title'].includes(key)) safe[key] = value.slice(0, 1000);
        else if (name === 'a' && key === 'href' && /^(https?:\/\/|mailto:|#)/i.test(value)) safe.href = value;
      }
      if (name === 'img') {
        if (++images > 32) invalid('DOCX supports at most 32 images');
        const match = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(attributes.src || '');
        if (!match) invalid('DOCX images must be embedded PNG, JPEG or GIF data; remote images are not fetched');
        const bytes = Buffer.from(match[2], 'base64');
        if (bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2]) invalid('Invalid or oversized DOCX image');
        const type = match[1];
        const valid = type === 'png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.toString('ascii',12,16) === 'IHDR'
          : type === 'jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.length >= 10 && ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6));
        if (!valid) invalid('DOCX image content does not match its declared type');
        if (type !== 'jpeg') {
          const width = type === 'png' ? bytes.readUInt32BE(16) : bytes.readUInt16LE(6);
          const height = type === 'png' ? bytes.readUInt32BE(20) : bytes.readUInt16LE(8);
          if (!width || !height || width * height > 25000000) invalid('DOCX image dimensions are too large');
        }
        safe.src = attributes.src;
      }
      output += `<${name}${Object.entries(safe).map(([key,value]) => ` ${key}="${escape(value)}"`).join('')}>`;
    },
    ontext(value) { output += escape(value); },
    onclosetag(name) { depth--; if (tags.has(name) && !['img','br','hr','col'].includes(name)) output += `</${name}>`; },
  }, { decodeEntities: true });
  parser.end(html);
  return output;
}
