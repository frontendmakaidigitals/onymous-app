import { recognizeDevice } from "@/client/identity-client";

const KEY = "gc_session";

async function validate(shop: string, token: string) {
  try {
    const r = await fetch(`/api/customer?shop=${encodeURIComponent(shop)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = r.ok ? await r.json() : null;
    return !!d?.customer?.phone;
  } catch { return false; }
}

export async function resolveSession(shop: string): Promise<string | null> {
  const sid = new URLSearchParams(window.location.search).get("sid");
  const existing = sid || sessionStorage.getItem(KEY);
  if (existing && (await validate(shop, existing))) {
    sessionStorage.setItem(KEY, existing);
    return existing;
  }
  sessionStorage.removeItem(KEY);
  const fresh = (await recognizeDevice(shop))?.token ?? null;
  if (fresh) sessionStorage.setItem(KEY, fresh);
  return fresh;
}
