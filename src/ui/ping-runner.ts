/**
 * Keepalive for stream: connect to background and send ping every 15s
 * so the service worker does not go idle. Loaded by ping-runner.html (no inline script for CSP).
 */
(function () {
  const port = chrome.runtime.connect({ name: "pageai-stream-keepalive" });
  const id = setInterval(function () {
    try {
      port.postMessage({ type: "ping" });
    } catch {
      clearInterval(id);
    }
  }, 15000);
  port.onDisconnect.addListener(function () {
    clearInterval(id);
  });
})();
