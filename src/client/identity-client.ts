"use client";
import { getFpRequestId } from "@/client/fp-client";

export type Recognized = { token: string; firstName: string | null; via: string };

/** Cookie first (free); fingerprint only if the cookie didn't work. */
export async function recognizeDevice(shop: string): Promise<Recognized | null> {
  const call = async (fpRequestId?: string): Promise<Recognized | null> => {
    const r = await fetch("/api/auth/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ shop, fpRequestId }),
    });
    const d = r.ok ? await r.json() : null;
    return d?.recognized ? { token: d.token, firstName: d.firstName ?? null, via: d.via } : null;
  };
  return (await call()) ?? (await call(await getFpRequestId()));
}