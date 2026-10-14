import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../src-tauri/runtime/', import.meta.url));
const bundle = await fs.realpath(process.argv[2] ?? '');
if (path.dirname(bundle) !== path.resolve(root) || !/^docx-[a-f0-9-]+$/.test(path.basename(bundle))) throw Error('Expected a generated DOCX bundle inside the runtime directory');
const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'bundle-manifest.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(new URL('../../backend/package-lock.json', import.meta.url), 'utf8'));
for (const pkg of manifest.packages) {
  if (lock.packages[pkg.path]?.version !== pkg.version) throw Error(`Bundle package differs from lock: ${pkg.name}`);
}
const hash = async filename => {
  const h = createHash('sha256'); for await (const bytes of createReadStream(filename)) h.update(bytes); return h.digest('hex');
};
for (const entry of manifest.files) {
  const filename = path.resolve(bundle, entry.path);
  const relative = path.relative(bundle, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative) || (await fs.lstat(filename)).isSymbolicLink()) throw Error('Unsafe bundle manifest entry');
  if ((await fs.stat(filename)).size !== entry.size || await hash(filename) !== entry.sha256) throw Error(`Bundle integrity mismatch: ${entry.path}`);
}

// A fresh temporary directory outside the repo makes accidental resolution of
// repository node_modules impossible. The bundled Node is the only executable.
const temporaryRoot = await fs.realpath(os.tmpdir());
const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'labos-docx-bundle-probe-'));
try {
  await fs.cp(bundle, temporary, { recursive: true });
  const script = `
    import {spawn} from 'node:child_process';
    import {resolve} from 'node:path';
    function convert(mode,body){return new Promise((accept,reject)=>{
      const header=Buffer.alloc(5);header[0]=mode;header.writeUInt32BE(body.length,1);
      const child=spawn(process.execPath,['--max-old-space-size=128',resolve('src/docx-native-worker.js')],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      const chunks=[];let size=0,diagnostic='';
      const timer=setTimeout(()=>{child.kill();reject(Error('Native worker timed out: '+diagnostic));},20000);
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.stdin.on('error',()=>{});child.stderr.on('data',data=>{diagnostic=(diagnostic+data.toString()).slice(0,1000);});
      child.stdout.on('data',data=>{size+=data.length;if(size>17*1024*1024){child.kill();reject(Error('Native output limit'));}else chunks.push(data);});
      child.on('close',code=>{clearTimeout(timer);const out=Buffer.concat(chunks);
        if(code!==0||out.length<5||out.readUInt32BE(1)!==out.length-5||out[0]!==mode)return reject(Error('Invalid native worker frame'));
        accept(out.subarray(5));
      });
      // Match native Rust: close the input handle after writing the one frame.
      child.stdin.end(Buffer.concat([header,body]),()=>child.stdin.destroy());
    });}
    const file=await convert(2,Buffer.from('<h1>Offline bundle</h1><p><b>Preserved</b></p><table><tr><td>Cell</td></tr></table>'));
    const preview=JSON.parse(await convert(1,file));
    for(const expected of ['Offline bundle','<strong>Preserved</strong>','<table>','Cell']) {
      if(!preview.html.includes(expected))throw Error('Missing round-trip content: '+expected);
    }
    console.log(JSON.stringify({node:process.version,bytes:file.length,roundTrip:true}));
  `;
  const env = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.PATH = ''; // No external Node/converter executable lookup.
  const result = await promisify(execFile)(path.join(temporary, process.platform === 'win32' ? 'node.exe' : 'node'), ['--input-type=module', '-e', script], {
    cwd: temporary, env, windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024,
  });
  console.log(JSON.stringify({ verifiedFiles: manifest.files.length, verifiedPackages: manifest.packages.length, relocated: true, result: JSON.parse(result.stdout.trim()) }));
} finally {
  const resolved = await fs.realpath(temporary);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('labos-docx-bundle-probe-')) throw Error('Refusing cleanup outside this probe directory');
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
