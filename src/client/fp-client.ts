"use client";
import * as FingerprintJS from "@fingerprintjs/fingerprintjs-pro";

let agentPromise: Promise<FingerprintJS.Agent> | null = null;

function loadAgent() {
    agentPromise ??= FingerprintJS.load({
        apiKey: process.env.NEXT_PUBLIC_FP_PUBLIC_KEY!,
        region: "ap",
    });
    return agentPromise;
}

/** Start loading early (e.g. when the OTP screen opens) so verify isn't slowed down. */
export function preloadFingerprint() {
    loadAgent().catch(() => { });
}

/** Returns a requestId, or undefined if blocked/slow. Never throws. */
export async function getFpRequestId(): Promise<string | undefined> {
    try {
        const agent = await loadAgent();
        const result = await agent.get({ timeout: 3000 });
        return result.requestId;
    } catch (err) {
        console.warn("[fp] identification failed:", err);
        return undefined;
    }
}