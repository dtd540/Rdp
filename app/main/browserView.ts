import { BrowserWindow, WebContentsView } from 'electron';


export const BROWSER_PARTITION = 'persist:browser';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserTab {
  id: string;
  view: WebContentsView;
  url: string;
}

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
}

const tabs = new Map<string, BrowserTab>();
let getWindow: (() => BrowserWindow | null) | null = null;
let activeId: string | null = null;
let bounds: Bounds | null = null;
let attached = false;

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function publish(payload: Record<string, unknown>): void {
  getWindow?.()?.webContents.send('bridge:event', 'browser', payload);
}

function summarize(id: string): BrowserTabState | null {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return null;
  const contents = tab.view.webContents;
  return {
    id,
    url: contents.getURL() || tab.url,
    title: contents.getTitle(),
    canBack: contents.navigationHistory.canGoBack(),
    canForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading()
  };
}

function syncState(id: string): void {
  const state = summarize(id);
  if (state) publish({ type: 'state', ...state });
}

function position(): void {
  if (!bounds || !activeId) return;
  const tab = tabs.get(activeId);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const width = Math.max(0, Math.round(bounds.width));
  const height = Math.max(0, Math.round(bounds.height));
  tab.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width, height });
}

function attach(tab: BrowserTab): void {
  const win = getWindow?.();
  if (!win || win.isDestroyed()) return;
  const already = attached && activeId === tab.id;
  if (already) return;
  detach();
  win.contentView.addChildView(tab.view);
  attached = true;
  activeId = tab.id;
  position();
}

function detach(): void {
  const win = getWindow?.();
  const previous = activeId ? tabs.get(activeId) : null;
  if (win && !win.isDestroyed() && previous && attached) {
    win.contentView.removeChildView(previous.view);
  }
  attached = false;
}

function create(id: string, url: string): BrowserTab {
  const target = isWebUrl(url) ? url : 'about:blank';
  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });

  const contents = view.webContents;
  const tab: BrowserTab = { id, view, url: target };

  contents.setWindowOpenHandler(({ url: target2 }) => {
    if (isWebUrl(target2)) void contents.loadURL(target2);
    return { action: 'deny' };
  });

  const guardNavigation = (event: Electron.Event, url: string): void => {
    if (!isWebUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

  contents.on('did-start-loading', () => syncState(id));
  contents.on('did-stop-loading', () => syncState(id));
  contents.on('did-navigate', () => {
    tab.url = contents.getURL() || tab.url;
    syncState(id);
  });
  contents.on('did-navigate-in-page', () => {
    tab.url = contents.getURL() || tab.url;
    syncState(id);
  });
  contents.on('page-title-updated', (_event, title) => publish({ id, type: 'title', title }));
  contents.on('found-in-page', (_event, result) => publish({ id, type: 'found', active: result.activeMatchOrdinal ?? 0, total: result.matches ?? 0 }));
  contents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    publish({ id, type: 'fail', detail: description, url: validatedURL });
  });
  contents.on('render-process-gone', () => publish({ id, type: 'gone', detail: 'The page stopped responding.' }));

  tabs.set(id, tab);
  if (isWebUrl(target)) void contents.loadURL(target);
  return tab;
}

export function initializeBrowserViews(win: () => BrowserWindow | null): void {
  getWindow = win;
}


export function syncBrowserTabs(payload: { tabs?: Array<{ id?: unknown; url?: unknown }>; activeId?: unknown }): { tabs: BrowserTabState[] } {
  const wanted: Array<{ id: string; url: string }> = [];
  for (const entry of Array.isArray(payload.tabs) ? payload.tabs : []) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.url !== 'string') continue;
    wanted.push({ id: entry.id, url: entry.url });
  }
  const keep = new Set(wanted.map((tab) => tab.id));

  for (const [id, tab] of tabs) {
    if (keep.has(id)) continue;
    detachIfActive(id);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tabs.delete(id);
  }

  for (const { id, url } of wanted) {
    const existing = tabs.get(id);
    if (!existing || existing.view.webContents.isDestroyed()) {
      create(id, url);
      continue;
    }
    if (url !== existing.url && url !== existing.view.webContents.getURL()) {
      existing.url = url;
      if (isWebUrl(url)) void existing.view.webContents.loadURL(url);
    }
  }

  const nextActive = typeof payload.activeId === 'string' ? payload.activeId : null;
  if (nextActive) {
    const tab = tabs.get(nextActive);
    if (tab) attach(tab);
  }

  return { tabs: [...tabs.keys()].map((id) => summarize(id)).filter((state): state is BrowserTabState => state !== null) };
}

function detachIfActive(id: string): void {
  if (activeId === id) detach();
}

export function setBrowserBounds(next: Bounds): void {
  bounds = next;
  position();
}

export function hideBrowserView(): void {
  detach();
}

export function navigateBrowserTab(id: string, url: string): boolean {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed() || !isWebUrl(url)) return false;
  tab.url = url;
  void tab.view.webContents.loadURL(url);
  return true;
}

export function browserTabAction(id: string, action: string): boolean {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return false;
  const contents = tab.view.webContents;
  switch (action) {
    case 'back':
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      return true;
    case 'forward':
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      return true;
    case 'reload':
      contents.reload();
      return true;
    case 'stop':
      contents.stop();
      return true;
    default:
      return false;
  }
}

export function zoomBrowserTab(id: string, factor: number): number {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return 1;
  const clamped = Math.min(3, Math.max(0.5, factor));
  tab.view.webContents.setZoomFactor(clamped);
  return clamped;
}

export function findInBrowserTab(id: string, text: string, forward: boolean, findNext: boolean): boolean {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed() || !text) return false;
  tab.view.webContents.findInPage(text, { forward, findNext });
  return true;
}

export function stopFindInBrowserTab(id: string, action: 'clearSelection' | 'keepSelection'): void {
  const tab = tabs.get(id);
  if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.stopFindInPage(action);
}

export function disposeBrowserViews(): void {
  detach();
  for (const tab of tabs.values()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  tabs.clear();
  activeId = null;
  bounds = null;
}
