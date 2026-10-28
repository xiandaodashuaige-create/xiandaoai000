import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';
const FONT_PATH = path.join(os.tmpdir(), 'NotoSansSC.ttf');

/** SFNT directory bounds reject interrupted downloads and non-font HTTP bodies. */
export function completeFontDirectory(bytes, fileSize = bytes.length) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 12 ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 12
  )
    return false;
  const signature = bytes.readUInt32BE(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) return false;
  const tables = bytes.readUInt16BE(4);
  const directorySize = 12 + tables * 16;
  if (!tables || bytes.length < directorySize || fileSize < directorySize)
    return false;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    const offset = bytes.readUInt32BE(at + 8),
      length = bytes.readUInt32BE(at + 12);
    if (offset > fileSize || length > fileSize - offset) return false;
  }
  return true;
}

async function completeFontFile(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const size = (await handle.stat()).size;
    const header = Buffer.alloc(12);
    if ((await handle.read(header, 0, 12, 0)).bytesRead !== 12) return false;
    const directorySize = 12 + header.readUInt16BE(4) * 16;
    if (!header.readUInt16BE(4) || directorySize > size) return false;
    const directory = Buffer.alloc(directorySize);
    if (
      (await handle.read(directory, 0, directorySize, 0)).bytesRead !==
      directorySize
    )
      return false;
    return completeFontDirectory(directory, size);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

/** One in-flight load per consumer group; only complete files reach the cache path. */
export function createFontLoader({
  fontPath = FONT_PATH,
  fetcher = (...args) => globalThis.fetch(...args),
  write = writeFile,
} = {}) {
  let pending;
  async function load() {
    if (await completeFontFile(fontPath)) return fontPath;
    const response = await fetcher(FONT_URL);
    if (!response.ok) throw new Error(`font_download_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!completeFontDirectory(bytes)) throw new Error('font_download_invalid');
    await mkdir(path.dirname(fontPath), { recursive: true });
    const temporary = fontPath + '.' + randomUUID() + '.tmp';
    try {
      await write(temporary, bytes, { flag: 'wx' });
      try {
        await rename(temporary, fontPath);
      } catch (error) {
        // A separate worker may have published a valid font first. Windows can
        // reject replacing a font which Sharp already has open; reuse the winner.
        if (!(await completeFontFile(fontPath))) throw error;
      }
      return fontPath;
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  return function ensureFont() {
    if (!pending) {
      const current = load().finally(() => {
        if (pending === current) pending = undefined;
      });
      pending = current;
    }
    return pending;
  };
}

// Both poster and video overlays import this same module instance.
export const ensureFont = createFontLoader();
