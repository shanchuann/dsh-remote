/**
 * Web GUI entry injection.
 *
 * The plugin contributes a small floating "远程控制" button to the DSH web
 * index through `webserver/index-inject`. Clicking it opens the pairing page
 * (local /pair) in a new tab, so Desktop users do not have to remember the
 * port or run a script. The script is self-contained vanilla JS and idempotent.
 */
export const REMOTE_ENTRY_ID = "dsh-remote-entry";

/**
 * @returns {string} body script that renders the entry button once.
 */
export function renderRemoteEntryScript() {
  return [
    "(function () {",
    "  if (document.getElementById('" + REMOTE_ENTRY_ID + "')) return;",
    "  function mount() {",
    "    if (document.getElementById('" + REMOTE_ENTRY_ID + "')) return;",
    "    if (!document.body) { setTimeout(mount, 200); return; }",
    "    var config = globalThis.__DSH_REMOTE__ || {};",
    "    var url = config.pairUrl;",
    "    if (typeof url !== 'string' || url.length === 0) return;",
    "    var button = document.createElement('button');",
    "    button.id = '" + REMOTE_ENTRY_ID + "';",
    "    button.type = 'button';",
    "    button.title = '打开 DSH Remote 配对页 / Open the DSH Remote pairing page';",
    "    button.textContent = '远程控制';",
    "    button.style.cssText = [",
    "      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483000',",
    "      'display:inline-flex', 'align-items:center', 'gap:8px',",
    "      'height:36px', 'padding:0 16px', 'border-radius:999px',",
    "      'border:1px solid rgba(255,255,255,0.16)',",
    "      'background:#4D6BFE', 'color:#fff', 'font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif',",
    "      'box-shadow:0 8px 24px rgba(16,24,40,0.24)', 'cursor:pointer'",
    "    ].join(';');",
    "    button.addEventListener('mouseenter', function () { button.style.filter = 'brightness(1.08)'; });",
    "    button.addEventListener('mouseleave', function () { button.style.filter = ''; });",
    "    button.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });",
    "    document.body.appendChild(button);",
    "  }",
    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);",
    "  else mount();",
    "})();"
  ].join("\n");
}
