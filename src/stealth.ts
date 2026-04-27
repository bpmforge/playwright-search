import type { BrowserContext } from "playwright";

const stealthScript = `
(() => {
  // 1. navigator.webdriver -> undefined
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
  } catch {}

  // 2. plugins + mimeTypes — non-empty, plausible
  try {
    const makePlugin = (name, filename, description) => {
      const p = Object.create(Plugin.prototype);
      Object.defineProperties(p, {
        name: { value: name },
        filename: { value: filename },
        description: { value: description },
        length: { value: 1 },
      });
      return p;
    };
    const plugins = [
      makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ];
    Object.setPrototypeOf(plugins, PluginArray.prototype);
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => plugins });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => Object.setPrototypeOf([], MimeTypeArray.prototype) });
  } catch {}

  // 3. window.chrome — full surface incl. loadTimes() + csi()
  try {
    const startTime = (performance.timing && performance.timing.navigationStart) || Date.now() - 1000;
    if (!window.chrome) {
      window.chrome = {};
    }
    window.chrome.runtime = window.chrome.runtime || { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformOs: {}, PlatformArch: {}, PlatformNaclArch: {}, RequestUpdateCheckStatus: {}, id: undefined };
    window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    window.chrome.loadTimes = function() {
      return {
        requestTime: startTime / 1000,
        startLoadTime: startTime / 1000,
        commitLoadTime: startTime / 1000 + 0.05,
        finishDocumentLoadTime: startTime / 1000 + 0.3,
        finishLoadTime: startTime / 1000 + 0.6,
        firstPaintTime: startTime / 1000 + 0.4,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    };
    window.chrome.csi = function() {
      return {
        startE: startTime,
        onloadT: startTime + 600,
        pageT: Date.now() - startTime,
        tran: 15,
      };
    };
  } catch {}

  // 4. permissions.query — notifications consistent with Notification.permission
  try {
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, name: 'notifications', onchange: null, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true;} })
          : originalQuery.call(window.navigator.permissions, params);
    }
  } catch {}

  // 5. WebGL vendor / renderer
  try {
    const spoof = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = function(p) {
        if (p === 37445) return 'Intel Inc.';
        if (p === 37446) return 'Intel Iris OpenGL Engine';
        return orig.call(this, p);
      };
    };
    if (typeof WebGLRenderingContext !== 'undefined') spoof(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') spoof(WebGL2RenderingContext.prototype);
  } catch {}

  // 6. languages — match en-US locale
  try {
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(Navigator.prototype, 'language', { get: () => 'en-US' });
  } catch {}

  // 7. iframe contentWindow — apply same patches inside iframes
  try {
    const origAttachShadow = Element.prototype.attachShadow;
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tag, opts) {
      const el = origCreateElement.call(this, tag, opts);
      if (String(tag).toLowerCase() === 'iframe') {
        try {
          const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
          if (desc && desc.get) {
            Object.defineProperty(el, 'contentWindow', {
              get() {
                const cw = desc.get.call(el);
                if (cw && !cw.__patched) {
                  try {
                    Object.defineProperty(cw.Navigator.prototype, 'webdriver', { get: () => undefined });
                    cw.__patched = true;
                  } catch {}
                }
                return cw;
              },
            });
          }
        } catch {}
      }
      return el;
    };
  } catch {}

  // Bonus: hardware concurrency + device memory plausible defaults
  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 });
  } catch {}
})();
`;

export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(stealthScript);
}
