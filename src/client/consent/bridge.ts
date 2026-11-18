// Talking to the storefront (postMessage) and to onymous-app (/api/auth/*).
import { getFpRequestId } from "@/client/fp-client";

let parentOrigin: string | null = null;

/** The storefront origin we may message. Set once it has been validated. */
export function setParentOrigin(origin: string | null) {
  parentOrigin = origin;
}

export function post(msg: Record<string, unknown>) {
  if (parentOrigin && window.parent !== window) window.parent.postMessage(msg, parentOrigin);
}

/** Origin of the page framing us (ancestorOrigins isn't in Firefox; fall back to the referrer). */
export function embeddingOrigin(): string {
  let origin = window.location.ancestorOrigins?.[0] ?? "";
  if (!origin) {
    try {
      origin = new URL(document.referrer).origin;
    } catch {}
  }
  return origin;
}

async function api<T>(path: string, body: unknown): Promise<{ ok: boolean; data: T }> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return { ok: r.ok, data: (await r.json().catch(() => ({}))) as T };
}

/** Device cookie only (free). */
export async function recognizeByCookie(shop: string | null): Promise<string | null> {
  try {
    const r = await api<{ recognized?: boolean; token?: string }>("/api/auth/recognize", { shop });
    return r.ok && r.data.recognized && r.data.token ? r.data.token : null;
  } catch {
    return null;
  }
}

export type SendResult = { ok: true } | { ok: false; error: string; retryAfter?: number };

export async function sendCode(shop: string | null, phone: string): Promise<SendResult> {
  try {
    const r = await api<{ error?: string; retryAfter?: number }>("/api/auth/otp/send", { shop, phone });
    if (r.ok) return { ok: true };
    return {
      ok: false,
      retryAfter: r.data.retryAfter,
      error:
        r.data.error === "cooldown"
          ? `Please wait ${r.data.retryAfter ?? 60}s before requesting another code.`
          : r.data.error === "too_many"
            ? "Too many attempts. Please try again later."
            : "We couldn't send a code to that number.",
    };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export type VerifyResult = { ok: true; token: string } | { ok: false; error: string };

export async function verifyCode(shop: string | null, phone: string, code: string): Promise<VerifyResult> {
  try {
    const fpRequestId = await getFpRequestId();
    const r = await api<{ token?: string; error?: string }>("/api/auth/otp/verify", {
      shop,
      phone,
      code,
      ...(fpRequestId ? { fpRequestId } : {}),
    });
    if (r.ok && r.data.token) return { ok: true, token: r.data.token };
    return {
      ok: false,
      error:
        r.data.error === "expired"
          ? "That code has expired. Request a new one."
          : r.data.error === "locked"
            ? "Too many wrong attempts. Request a new code."
            : "That code isn't right. Please check and try again.",
    };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
