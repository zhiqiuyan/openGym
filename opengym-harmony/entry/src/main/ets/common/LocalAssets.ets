/*
 * LocalAssets — the app's own web assets, served over https://localhost.
 *
 * Why this exists
 * ---------------
 * ArkWeb refuses to load an ES module from a file:// or resource:// URL. The kernel blocks
 * cross-origin requests on those two schemes, and every module import is a cross-origin
 * request as far as it is concerned: the error on the phone was
 *
 *   Could not load resource://rawfile/assets/index-Kr6mHU6B.js
 *
 * The page itself loaded fine (the boot watchdog in index.html ran, which is why the failure
 * was reported with the app's own wording rather than a blank screen), but the module graph
 * never started, so nothing ever drew.
 *
 * customizeSchemes() does not help: it opens *custom* schemes, and file and resource are not
 * custom — they are the two the kernel deliberately closes.
 *
 * The way through
 * ---------------
 * The official answer is to serve the assets from an https URL and intercept the requests,
 * answering them from rawfile instead of the network. The domain never resolves anywhere:
 * every request for it is answered by the app itself, so nothing leaves the phone and nothing
 * from the internet can reach the page.
 *
 * The domain is https://localhost on purpose. The app's own API server accepts exactly three
 * WebView origins — https://localhost, capacitor://localhost, http://localhost — and only
 * those three get Access-Control-Allow-Private-Network, which a phone pairing with a server
 * on the LAN needs. Any other domain would work for the page and then fail on the first API
 * call.
 *
 * Everything the page asks for is answered from rawfile; anything else (the paired server, the
 * AI provider) is passed through untouched.
 */

import { resourceManager } from '@kit.LocalizationKit';
import { BusinessError } from '@kit.BasicServicesKit';
import common from '@ohos.app.ability.common';

/** The origin the page is served from. */
export const APP_ORIGIN = 'https://localhost';

/** Where the app's own files live inside the package. */
const RAWFILE_ROOT = '';

/**
 * What a file's extension means to a browser.
 *
 * The wrong type here is not cosmetic: a script served as text/plain is refused outright
 * ("the MIME type ... is not a supported JavaScript MIME type"), and a stylesheet served as
 * text/plain is ignored. So the mapping has to be right for every kind of file the build
 * produces, not just the HTML.
 */
function mimeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot < 0 ? '' : path.substring(dot + 1).toLowerCase();
  if (ext === 'html' || ext === 'htm') {
    return 'text/html';
  }
  if (ext === 'js' || ext === 'mjs') {
    return 'text/javascript';
  }
  if (ext === 'css') {
    return 'text/css';
  }
  if (ext === 'json') {
    return 'application/json';
  }
  if (ext === 'svg') {
    return 'image/svg+xml';
  }
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg';
  }
  if (ext === 'gif') {
    return 'image/gif';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  if (ext === 'mp4') {
    return 'video/mp4';
  }
  if (ext === 'webm') {
    return 'video/webm';
  }
  if (ext === 'mov') {
    return 'video/quicktime';
  }
  if (ext === 'm4v') {
    return 'video/x-m4v';
  }
  if (ext === 'ico') {
    return 'image/x-icon';
  }
  if (ext === 'woff') {
    return 'font/woff';
  }
  if (ext === 'woff2') {
    return 'font/woff2';
  }
  if (ext === 'ttf') {
    return 'font/ttf';
  }
  if (ext === 'wasm') {
    return 'application/wasm';
  }
  if (ext === 'txt' || ext === 'map') {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

/**
 * The path of the request, relative to the app's own origin.
 *
 * Returns undefined for anything that is not ours: another host, a different scheme, or a
 * path that tries to climb out of the directory with "..".
 */
export function localPathOf(url: string): string | undefined {
  const prefix = APP_ORIGIN + '/';
  if (!url.startsWith(prefix)) {
    return undefined;
  }
  let path = url.substring(prefix.length);
  // A query string or a fragment is not part of the file name.
  const cut = path.search(/[?#]/);
  if (cut >= 0) {
    path = path.substring(0, cut);
  }
  // A path that climbs out of the app's own directory is not ours to serve.
  if (path.length === 0 || path.indexOf('..') >= 0) {
    return undefined;
  }
  return path;
}

/**
 * Reads one file out of the package.
 *
 * The path is relative to resources/rawfile, and must not start with a slash.
 */
export function readAsset(context: common.UIAbilityContext, path: string): Uint8Array | undefined {
  try {
    const bytes: Uint8Array = context.resourceManager.getRawFileContentSync(RAWFILE_ROOT + path);
    return bytes;
  } catch (error) {
    // A file that is not there is a 404, not a crash: the page asks for things that may not
    // exist (an icon a screen does not use, a source map).
    const message: string = (error as BusinessError).message || String(error);
    console.warn('[LocalAssets] not found:', path, '-', message);
    return undefined;
  }
}

/**
 * The body of a 404, for a path that is not in the package.
 */
export function notFoundBody(path: string): string {
  return 'Not found: ' + path;
}

export { mimeOf };
