// clipboard.js — copy text, and report whether it actually happened.
//
// Two traps this exists to close, both of which end with the UI claiming
// "Copied" over an empty clipboard:
//
//  - `navigator.clipboard.writeText` returns a PROMISE. Wrapping it in
//    try/catch catches only a synchronous throw, never the rejection the
//    browser uses to refuse (denied permission, document not focused).
//  - `navigator.clipboard` is undefined outside a secure context. Reaching the
//    panel over plain http on a LAN address is enough — so this is the ordinary
//    case on a home network, not an edge case.
//
// The fallback is the pre-Clipboard-API selection trick, which still works in
// an insecure context. `execCommand` is deprecated and every engine still
// implements it; when it goes, this returns false and the caller says so.
function copyText(text) {
  if (text == null || text === "") return Promise.resolve(false);
  const str = String(text);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(str).then(() => true, () => legacyCopy(str));
  }
  return Promise.resolve(legacyCopy(str));
}

function legacyCopy(str) {
  try {
    const ta = document.createElement("textarea");
    ta.value = str;
    // Off-screen but still selectable: `display:none` and `hidden` are not, and
    // readOnly keeps the mobile keyboard from opening over the page.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, str.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

export { copyText };
