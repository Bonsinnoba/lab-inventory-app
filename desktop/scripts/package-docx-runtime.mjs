// Produce an isolated, relocatable development bundle from installed locked
// dependencies. No npm install, network access, database or environment copying.
// Release CI must separately certify/sign the runtime and bundled notices.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(repo, 'backend');
const modules = await fs.realpath(path.join(backend, 'node_modules'));
const locked = JSON.parse(await fs.readFile(path.join(backend, 'package-lock.json'), 'utf8'));
const target = path.join(repo, 'desktop', 'src-tauri', 'runtime', `docx-${randomUUID()}`);
const inside = (root, filename) => {
  const relative = path.relative(root, filename);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Bundle path escapes its root');
  return relative;
};
const hash = async filename => {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(filename)) digest.update(bytes);
  return digest.digest('hex');
};
const packageName = name => {
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw Error('Invalid dependency name');
  return name;
};
async function locate(name, from) {
  packageName(name);
  let directory = from;
  while (true) {
    const candidate = path.join(directory, 'node_modules', name);
    try {
      const real = await fs.realpath(candidate);
      inside(modules, real);
      return real;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (directory === backend) throw Error(`Missing installed dependency: ${name}`);
    const parent = path.dirname(directory);
    inside(backend, parent); directory = parent;
  }
}
const copied = new Set();
const packages = [];
async function copyPackage(name, from, optional = false) {
  let source;
  try { source = await locate(name, from); }
  catch (error) { if (optional && error.message.startsWith('Missing installed dependency:')) return; throw error; }
  if (copied.has(source)) return;
  copied.add(source);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const relative = path.join('node_modules', inside(modules, source));
  if (locked.packages?.[relative.replaceAll('\\', '/')]?.version !== manifest.version) {
    throw Error(`Installed dependency differs from package-lock: ${name}`);
  }
  await fs.cp(source, path.join(target, relative), { recursive: true, errorOnExist: true, force: false, filter: async filename => {
    const subpath = inside(source, filename);
    if (subpath.split(path.sep).includes('node_modules')) return false;
    if ((await fs.lstat(filename)).isSymbolicLink()) throw Error('Symlink in DOCX dependency; bundle requires review');
    return true;
  } });
  packages.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? null, path: relative.replaceAll('\\', '/') });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    await copyPackage(dependency, source, Object.hasOwn(manifest.optionalDependencies ?? {}, dependency));
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) await copyPackage(dependency, source, true);
}

await fs.mkdir(path.dirname(target), { recursive: true });
await fs.mkdir(target); // Unique target; never overwrite or delete an older bundle.
await fs.mkdir(path.join(target, 'src'));
await fs.copyFile(process.execPath, path.join(target, process.platform === 'win32' ? 'node.exe' : 'node'));
if (process.platform !== 'win32') await fs.chmod(path.join(target, 'node'), 0o755);
await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'labos-docx-runtime', private: true, type: 'module' }, null, 2));
for (const filename of ['docx-converter.js', 'docx-worker.js', 'docx-input.js', 'docx-transform.js', 'docx-native-worker.js']) {
  await fs.copyFile(path.join(backend, 'src', filename), path.join(target, 'src', filename));
}
for (const name of ['@turbodocx/html-to-docx', 'mammoth', 'htmlparser2']) await copyPackage(name, backend);
const files = [];
async function inventory(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(filename);
    else if (entry.isFile()) files.push({ path: inside(target, filename).replaceAll('\\', '/'), size: (await fs.stat(filename)).size, sha256: await hash(filename) });
    else throw Error('Unsupported bundle entry');
  }
}
await inventory(target);
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { protocol: 1, platform: process.platform, arch: process.arch, nodeVersion: process.version,
  sourceLockSha256: await hash(path.join(backend, 'package-lock.json')), packages, files };
await fs.writeFile(path.join(target, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ bundle: target, packages: packages.length, files: files.length, bytes: files.reduce((n, file) => n + file.size, 0),
  status: 'Development bundle only; native integration, signing and installer acceptance remain open.' }));
