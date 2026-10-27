import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('presentation shell scope is limited to generated copies and existing URL schemes', () => {
  const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const allowed = new RegExp(config.tauri.allowlist.shell.open);
  const base = 'C:\\Users\\test\\AppData\\Local\\Temp\\labos-presentation-12345678-1234-1234-1234-123456789abc\\Presentation';
  for (const path of [base + '.ppt', base + '.pptx', 'https://example.com/slides']) {
    assert.ok(allowed.test(path), path);
  }
  for (const path of [base + '.pptx.exe', base + '.pptm', 'C:\\Windows\\notepad.exe', 'file:///C:/slides.pptx']) {
    assert.equal(allowed.test(path), false, path);
  }
});
