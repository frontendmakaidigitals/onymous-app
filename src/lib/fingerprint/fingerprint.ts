import { FingerprintJsServerApiClient, Region } from "@fingerprintjs/fingerprintjs-pro-server-api";
import redis from "@/lib/redis";
import { chargeFingerprint } from "@/lib/fingerprint/usage";

const client = new FingerprintJsServerApiClient({
  apiKey: process.env.FP_SECRET_API_KEY!,
  region: Region.AP,
});

export type DeviceSignal = {
  visitorId: string;
  confidence: number;
  risky: boolean;          // VPN / bot / tampering / incognito etc.
  ipCountry: string | null;
};

const MAX_AGE_MS = 10 * 60 * 1000; // covers a slow OTP entry

/**
 * The browser only sends a requestId; the real visitorId comes from
 * Fingerprint's server API, so a faked visitorId is useless.
 */
export async function verifyDevice(requestId: string | null | undefined, shop: string | null | undefined): Promise<DeviceSignal | null> {
  if (!requestId) return null;

  // Single-use: a captured requestId can't be replayed
  const fresh = await redis.set(`gc:fpreq:${requestId}`, "1", "EX", 900, "NX");
  if (fresh !== "OK") return null;

  // Counted once per identification; ignored when the store has it off or is over its monthly limit
  if (!(await chargeFingerprint(shop))) return null;

  try {
    const event: any = await client.getEvent(requestId);
    const p = event?.products ?? {};
    const id = p.identification?.data;
    if (!id?.visitorId) return null;
    if (id.timestamp && Date.now() - id.timestamp > MAX_AGE_MS) return null;

    const bot = p.botd?.data?.bot?.result;
    const risky =
      p.vpn?.data?.result === true ||
      (!!bot && bot !== "notDetected") ||
      p.tampering?.data?.result === true ||
      p.virtualMachine?.data?.result === true ||
      id.incognito === true;

    return {
      visitorId: id.visitorId,
      confidence: id.confidence?.score ?? 0,
      risky,
      ipCountry: p.ipInfo?.data?.v4?.geolocation?.country?.code ?? null,
    };
  } catch (err) {
    console.error("[fingerprint] getEvent failed:", err);
    return null; // fail closed: just no fingerprint for this login
  }
}