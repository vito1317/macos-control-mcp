// Background service worker for macOS Control MCP Bridge
// Connects to the MCP server's WebSocket and scans web page elements on demand.
//
// Architecture:
//   MCP Server (ws://127.0.0.1:18321)  <-->  This Extension  <-->  Active Tab
//   1. Extension connects to WS server on startup
//   2. Server sends { id, action: "scan" }
//   3. Extension injects content script into active tab
//   4. Extension replies with { id, success: true, elements: [...] }

const WS_URL = 'ws://127.0.0.1:18321';
let ws = null;
let reconnectTimer = null;

// ─── Content script to scan interactive elements ─────────────────────
function scanElements() {
  const selectors = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]',
    '[role="slider"]', '[role="textbox"]',
    '[onclick]', '[tabindex]', 'summary', 'details', 'label[for]',
    '[contenteditable="true"]',
  ];
  const allElements = document.querySelectorAll(selectors.join(','));
  const results = [];
  const seen = new Set();
  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight ||
        rect.right < 0 || rect.left > window.innerWidth) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const key = Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width);
    if (seen.has(key)) continue;
    seen.add(key);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const role = el.getAttribute('role') || '';
    const text = (el.textContent || '').trim().substring(0, 60);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const href = el.getAttribute('href') || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    let kind = tag;
    if (tag === 'input') kind = 'input[' + (type || 'text') + ']';
    if (role) kind = role;
    if (tag === 'a') kind = 'link';
    const label = ariaLabel || placeholder || text || name || id || (href ? href.substring(0, 40) : '') || '(no label)';
    results.push({
      kind, label: label.substring(0, 60),
      cx: Math.round(rect.left + rect.width / 2),
      cy: Math.round(rect.top + rect.height / 2),
      w: Math.round(rect.width), h: Math.round(rect.height),
      tag, href: href ? href.substring(0, 80) : undefined, type: type || undefined,
    });
  }
  return {
    success: true, url: location.href, title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollY: Math.round(window.scrollY), count: results.length, elements: results,
  };
}

// ─── WebSocket connection management ─────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[MCP Bridge] Connected to MCP server');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.action === 'scan') {
      await handleScan(msg);
    } else if (msg.action === 'ping') {
      ws.send(JSON.stringify({ id: msg.id, success: true, action: 'pong' }));
    }
  };

  ws.onclose = () => {
    console.log('[MCP Bridge] Disconnected from MCP server');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
    ws = null;
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000); // retry every 3 seconds
}

// ─── Scan handler ────────────────────────────────────────────────────
async function handleScan(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse(msg.id, { success: false, error: 'No active tab' });
      return;
    }

    // Skip chrome:// and edge:// pages (can't inject scripts)
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
        tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
      sendResponse(msg.id, { success: false, error: 'Cannot scan browser internal pages' });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanElements,
    });

    const result = results[0]?.result;
    if (result) {
      sendResponse(msg.id, result);
    } else {
      sendResponse(msg.id, { success: false, error: 'Script returned no result' });
    }
  } catch (err) {
    sendResponse(msg.id, { success: false, error: err.message });
  }
}

function sendResponse(id, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ id, ...data }));
  }
}

// ─── Startup ─────────────────────────────────────────────────────────
connect();

// Re-connect when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  connect();
});

// Re-connect when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  connect();
});

// Keep service worker alive by pinging periodically
// (MV3 service workers can be terminated after 30s of inactivity)
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Service worker is alive, WS is connected — all good
  } else {
    connect();
  }
}, 25000);
