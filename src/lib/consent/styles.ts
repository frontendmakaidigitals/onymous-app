// Styles for the consent popup iframe page. Inlined into the HTML by the
// embed route so the popup paints in one request. Everything is scoped to
// .oc-* classes; the page itself is transparent (only the card is visible).

export const POPUP_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box;margin:0}
html,body{background:transparent;color:#171717;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit}
.oc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* placement */
.oc-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.4)}
.oc-dock{position:fixed;left:12px;right:12px;bottom:12px;display:flex;justify-content:center}
@media(min-width:640px){.oc-dock{left:auto;right:24px;bottom:24px}}
.oc-preview{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}
.oc-preview *{pointer-events:none}

/* card shells */
.oc-card{position:relative;background:#fff;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.28);outline:1px solid rgba(0,0,0,.05)}
.oc-compact{width:360px;max-width:100%;padding:20px}
.oc-split{width:680px;max-width:100%;display:grid;overflow:hidden}
.oc-split .oc-art{display:none;min-height:380px}
.oc-split .oc-pane{position:relative;display:flex;flex-direction:column;justify-content:center;padding:28px;text-align:center}
@media(min-width:640px){.oc-split{grid-template-columns:1fr 1.1fr}.oc-split .oc-art{display:block}}
.oc-spot{position:relative;width:680px;max-width:100%;overflow:hidden;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.28)}
.oc-spot .oc-art{position:absolute;inset:0}
.oc-spot .oc-shade{position:absolute;inset:0;background:rgba(0,0,0,.25)}
.oc-spot .oc-stage{position:relative;display:flex;align-items:center;justify-content:center;min-height:400px;padding:24px}
.oc-spot .oc-glass{position:relative;width:100%;max-width:340px;padding:24px;border-radius:16px;background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 20px 25px -5px rgba(0,0,0,.15)}

/* art panel */
.oc-art{position:relative;overflow:hidden}
.oc-art img{display:block;width:100%;height:100%;object-fit:cover}
.oc-blob{position:absolute;border-radius:999px}

/* text */
.oc-brand{display:block;margin-bottom:12px;color:#737373;font-size:12px;font-weight:600;letter-spacing:.2em;text-transform:uppercase}
.oc-compact .oc-brand{letter-spacing:.08em}
.oc-h{padding-right:28px;font-size:20px;font-weight:600;line-height:1.3}
.oc-compact .oc-h{font-size:18px}
.oc-split .oc-h{padding-right:0}
.oc-sub{margin:6px 0 18px;color:#525252;font-size:14px;line-height:1.45}
.oc-legal{margin-top:14px;color:#737373;font-size:11px;line-height:1.4}

/* form */
.oc-form{display:flex;flex-direction:column;gap:10px;text-align:left}
.oc-field{display:flex;height:44px;overflow:hidden;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff}
.oc-field:focus-within{border-color:rgba(0,0,0,.45)}
.oc-field select{padding:0 8px;border:0;border-right:1px solid rgba(0,0,0,.1);background:transparent;color:#262626;font-size:14px;outline:0}
.oc-field input{flex:1;min-width:0;padding:0 12px;border:0;background:transparent;font-size:15px;outline:0}
.oc-field input.oc-code{text-align:center;letter-spacing:.5em;font-variant-numeric:tabular-nums}
.oc-btn{height:44px;border:0;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s}
.oc-btn:hover:not(:disabled){opacity:.9}
.oc-btn:disabled{cursor:default;opacity:.55}
.oc-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:#525252}
.oc-link{padding:0;border:0;background:none;color:#404040;font-size:13px;text-decoration:underline;cursor:pointer}
.oc-link:disabled{color:#a3a3a3;text-decoration:none;cursor:default}
.oc-err{color:#dc2626;font-size:12px}
.oc-ok{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 0;text-align:center;font-size:15px;font-weight:600}
.oc-ok-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:999px;color:#fff;font-size:22px}

.oc-close{position:absolute;top:12px;right:12px;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:#737373;cursor:pointer}
.oc-close:hover{background:rgba(0,0,0,.05)}
`;
