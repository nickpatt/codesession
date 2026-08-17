import { useState } from "react";

/**
 * Shows the current session URL with a one-click Copy button. This is the
 * whole sharing mechanism — sessions are link-based, so the URL in the address
 * bar is the invite.
 */
export function ShareLink() {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure origin) — user can still select text */
    }
  }

  return (
    <span className="share">
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button className="secondary" onClick={copy} style={{ marginLeft: "0.4rem" }}>
        {copied ? "Copied!" : "Copy link"}
      </button>
    </span>
  );
}
