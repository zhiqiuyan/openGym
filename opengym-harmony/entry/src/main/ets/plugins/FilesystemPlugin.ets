/*
 * Filesystem — the phone's private data directory.
 *
 * The app keeps a mirror of its state here (opengym-state.json) and reads health exports from
 * the same place. The mirror matters because the WebView's own storage can be evicted under
 * pressure, and on a phone this copy of the training log is the only one (lib/mobile.js).
 *
 * Capacitor's `directory` enum arrives as a name; this maps it onto the sandbox:
 *   DATA            -> filesDir          (the app's own files)
 *   DOCUMENTS       -> filesDir/documents
 *   CACHE           -> cacheDir
 *   LIBRARY_NO_CLOUD-> filesDir/library
 *   EXTERNAL        -> filesDir/external  (the app's own external dir)
 */

import { fileIo as fs } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PluginHandler } from '../common/PluginHandler';
import { Json } from '../common/Json';

/**
 * One decoded UTF-8 character: its code point and how many bytes it took.
 *
 * The type is named because ArkTS will not take an object literal as a type, and a method
 * may not return one either.
 */
interface Utf8Char {
  point: number;
  len: number;
}

export class FilesystemPlugin extends PluginHandler {
  async invoke(method: string, payload: string): Promise<string> {
    const json = new Json(payload);
    switch (method) {
      case 'readFile':
        return this.readFile(json.str('path'), json.str('directory', 'DATA'), json.str('encoding', 'utf8'));
      case 'writeFile':
        return this.writeFile(json.str('path'), json.str('directory', 'DATA'),
          json.str('data'), json.str('encoding', 'utf8'), json.bool('recursive', false));
      case 'appendFile':
        return this.appendFile(json.str('path'), json.str('directory', 'DATA'),
          json.str('data'), json.str('encoding', 'utf8'));
      case 'deleteFile':
        return this.deleteFile(json.str('path'), json.str('directory', 'DATA'));
      case 'readdir':
        return this.readdir(json.str('path'), json.str('directory', 'DATA'));
      case 'stat':
        return this.stat(json.str('path'), json.str('directory', 'DATA'));
      case 'rename':
        return this.rename(json.str('from'), json.str('to'),
          json.str('directory', 'DATA'), json.str('toDirectory', ''));
      case 'copyFile':
        return this.copyFile(json.str('from'), json.str('to'),
          json.str('directory', 'DATA'), json.str('toDirectory', ''));
      case 'mkdir':
        return this.mkdir(json.str('path'), json.str('directory', 'DATA'), json.bool('recursive', false));
      case 'rmdir':
        return this.rmdir(json.str('path'), json.str('directory', 'DATA'), json.bool('recursive', false));
      case 'getUri':
        return this.getUri(json.str('path'), json.str('directory', 'DATA'));
      case 'downloadFile':
        return this.downloadFile(json);
      default:
        return Json.error('Filesystem: unknown method ' + method);
    }
  }

  /** The directory a Capacitor name stands for. */
  private resolveDir(name: string): string {
    const ctx = getContext();
    switch (name) {
      case 'CACHE':
        return ctx.cacheDir;
      case 'DOCUMENTS':
        return ctx.filesDir + '/documents';
      case 'LIBRARY':
      case 'LIBRARY_NO_CLOUD':
        return ctx.filesDir + '/library';
      case 'EXTERNAL':
        return ctx.filesDir + '/external';
      case 'DATA':
      default:
        return ctx.filesDir;
    }
  }

  /** A path relative to a directory, with the directory's own name kept out of the way. */
  private fullPath(path: string, directory: string): string {
    const base = this.resolveDir(directory);
    const clean = path.startsWith('/') ? path.substring(1) : path;
    return base + '/' + clean;
  }

  private async readFile(path: string, directory: string, encoding: string): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      const file = fs.openSync(target, fs.OpenMode.READ_ONLY);
      try {
        const stat = fs.statSync(file.fd);
        const buffer = new ArrayBuffer(stat.size);
        fs.readSync(file.fd, buffer);
        return Json.build(['"data":' + Json.str(this.decode(buffer, encoding))]);
      } finally {
        fs.closeSync(file);
      }
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** The encoding names Capacitor uses, mapped onto what the file API takes. */
  private decode(buffer: ArrayBuffer, encoding: string): string {
    const bytes = new Uint8Array(buffer);
    if (encoding === 'base64') {
      return this.toBase64(bytes);
    }
    if (encoding === 'ascii') {
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
      }
      return out;
    }
    if (encoding === 'utf16') {
      return this.decodeUtf16(bytes);
    }
    // UTF8 is the default and what the app writes.
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const code = this.utf8Code(bytes, i);
      out += String.fromCodePoint(code.point);
      i += code.len;
    }
    return out;
  }

  /** One UTF-8 character, decoded by hand so the file API stays out of it. */
  private utf8Code(bytes: Uint8Array, i: number): Utf8Char {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      const one: Utf8Char = { point: b0, len: 1 };
      return one;
    }
    if (b0 < 0xe0 && i + 1 < bytes.length) {
      const two: Utf8Char = { point: ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f), len: 2 };
      return two;
    }
    if (b0 < 0xf0 && i + 2 < bytes.length) {
      const three: Utf8Char = {
        point: ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
        len: 3
      };
      return three;
    }
    if (i + 3 < bytes.length) {
      const four: Utf8Char = {
        point: ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f),
        len: 4
      };
      return four;
    }
    const bad: Utf8Char = { point: 0xfffd, len: 1 };
    return bad;
  }

  private decodeUtf16(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    }
    return out;
  }

  private toBase64(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (b0 << 16) | (b1 << 8) | b2;
      // A string cannot be indexed in ArkTS; charAt is the way to pick a character.
      out += alphabet.charAt((n >> 18) & 63) + alphabet.charAt((n >> 12) & 63);
      out += i + 1 < bytes.length ? alphabet.charAt((n >> 6) & 63) : '=';
      out += i + 2 < bytes.length ? alphabet.charAt(n & 63) : '=';
    }
    return out;
  }

  private async writeFile(path: string, directory: string, data: string,
    encoding: string, recursive: boolean): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      if (recursive) {
        this.ensureDir(target);
      }
      const file = fs.openSync(target, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      try {
        const bytes = this.encode(data, encoding);
        fs.writeSync(file.fd, bytes.buffer as ArrayBuffer);
        return Json.build(['"uri":' + Json.str(this.uriOf(target))]);
      } finally {
        fs.closeSync(file);
      }
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  /** The bytes to write, for the encodings the app uses. */
  private encode(data: string, encoding: string): Uint8Array {
    if (encoding === 'base64') {
      return this.fromBase64(data);
    }
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < data.length) {
        const low = data.charCodeAt(i + 1);
        const point = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
        out.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  private fromBase64(text: string): Uint8Array {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = text.replace(/=+$/, '');
    const out: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const index = alphabet.indexOf(clean.charAt(i));
      if (index < 0) {
        continue;
      }
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(out);
  }

  private async appendFile(path: string, directory: string, data: string, encoding: string): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      const file = fs.openSync(target, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
      try {
        const bytes = this.encode(data, encoding);
        fs.writeSync(file.fd, bytes.buffer as ArrayBuffer);
        return Json.build(['"uri":' + Json.str(this.uriOf(target))]);
      } finally {
        fs.closeSync(file);
      }
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async deleteFile(path: string, directory: string): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      fs.unlinkSync(target);
      return Json.build(['"uri":' + Json.str(this.uriOf(target))]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async readdir(path: string, directory: string): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      const names = fs.listFileSync(target);
      const files: string[] = [];
      const dirs: string[] = [];
      for (const name of names) {
        const full = target + '/' + name;
        let isDir = false;
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch (e) {
          isDir = false;
        }
        const entry: string = Json.build([
          '"name":' + Json.str(name),
          '"type":' + Json.str(isDir ? 'directory' : 'file')
        ]);
        if (isDir) {
          dirs.push(entry);
        } else {
          files.push(entry);
        }
      }
      return Json.build([
        '"files":[' + files.join(',') + ']',
        '"directories":[' + dirs.join(',') + ']'
      ]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async stat(path: string, directory: string): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      const stat = fs.statSync(target);
      return Json.build([
        '"uri":' + Json.str(this.uriOf(target)),
        '"type":' + Json.str(stat.isDirectory() ? 'directory' : 'file'),
        '"size":' + String(stat.size),
        '"mtime":' + String(stat.mtime),
        '"ctime":' + String(stat.ctime)
      ]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async rename(from: string, to: string, directory: string, toDirectory: string): Promise<string> {
    try {
      const src = this.fullPath(from, directory);
      const dst = this.fullPath(to, toDirectory.length > 0 ? toDirectory : directory);
      fs.renameSync(src, dst);
      return Json.build(['"uri":' + Json.str(this.uriOf(dst))]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async copyFile(from: string, to: string, directory: string, toDirectory: string): Promise<string> {
    try {
      const src = this.fullPath(from, directory);
      const dst = this.fullPath(to, toDirectory.length > 0 ? toDirectory : directory);
      fs.copyFileSync(src, dst);
      return Json.build(['"uri":' + Json.str(this.uriOf(dst))]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async mkdir(path: string, directory: string, recursive: boolean): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      if (recursive) {
        this.ensureDir(target);
      } else {
        fs.mkdirSync(target);
      }
      return Json.build(['"uri":' + Json.str(this.uriOf(target))]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async rmdir(path: string, directory: string, _recursive: boolean): Promise<string> {
    try {
      const target = this.fullPath(path, directory);
      fs.rmdirSync(target);
      return Json.build(['"uri":' + Json.str(this.uriOf(target))]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    }
  }

  private async getUri(path: string, directory: string): Promise<string> {
    return Json.build(['"uri":' + Json.str(this.uriOf(this.fullPath(path, directory)))]);
  }

  /**
   * Fetch a file into the app's own directory.
   *
   * The app uses this for the exercise media and for the files it exports (a plan to share,
   * a CSV of the training log). The download happens here, natively, and the answer is the
   * path it landed at.
   */
  private async downloadFile(json: Json): Promise<string> {
    const url = json.str('url', '');
    const path = json.str('path', '');
    const directory = json.str('directory', 'CACHE');
    if (url.length === 0) {
      return Json.error('no url');
    }
    const request = http.createHttp();
    try {
      // The callback form: with an optional parameter the promise overload widens into
      // "void & Promise<HttpResponse>", and the result cannot be read off it.
      const body: string = await new Promise<string>((resolve) => {
        const downloadOptions: http.HttpRequestOptions = {
          method: http.RequestMethod.GET,
          readTimeout: 60000
        };
        request.request(url, downloadOptions,
          (err: BusinessError, response: http.HttpResponse) => {
            if (err) {
              resolve('');
              return;
            }
            if (response.responseCode < 200 || response.responseCode >= 300) {
              resolve('');
              return;
            }
            resolve(String(response.result));
          });
      });
      if (body.length === 0) {
        return Json.error('download failed');
      }
      const name = path.length > 0 ? path : 'download';
      const target = this.fullPath(name, directory);
      this.ensureDir(target);
      const file = fs.openSync(target, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      try {
        const bytes = this.encode(body, 'utf8');
        fs.writeSync(file.fd, bytes.buffer as ArrayBuffer);
      } finally {
        fs.closeSync(file);
      }
      return Json.build([
        '"path":' + Json.str(target),
        '"uri":' + Json.str(this.uriOf(target))
      ]);
    } catch (error) {
      return Json.error((error as BusinessError).message || String(error));
    } finally {
      request.destroy();
    }
  }

  /**
   * The URI the page can load. A file:// URL into the app's own sandbox: the Web component
   * reads it with fileAccess on, and nothing outside the app can reach it.
   */
  private uriOf(target: string): string {
    return 'file://' + target;
  }

  /** Make sure a directory exists, creating the levels above it too. */
  private ensureDir(target: string): void {
    const parts = target.split('/');
    let current = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.length === 0) {
        continue;
      }
      current += (current.endsWith('/') ? '' : '/') + part;
      try {
        fs.mkdirSync(current);
      } catch (e) {
        // Already there — the only expected reason to fail here.
      }
    }
  }
}
