// OTP delivery over WhatsApp (MSG91 template "uae_otp", same as checkout-app).
// Without MSG91 credentials: development logs the code instead; production refuses.

const MSG91_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

const msg91 = () => {
  const authKey = process.env.MSG91_AUTH_KEY;
  const number = process.env.MSG91_WHATSAPP_NUMBER;
  const namespace = process.env.MSG91_WHATSAPP_NAMESPACE;
  return authKey && number && namespace ? { authKey, number, namespace } : null;
};

/**
 * Numbers that always get a fixed code and no message (store review, QA).
 * OTP_TEST_NUMBERS="+918588047098:0000,+97123432453:0000"
 */
export function testOtpFor(phone: string): string | null {
  for (const entry of (process.env.OTP_TEST_NUMBERS ?? "").split(",")) {
    const [num, code] = entry.split(":").map((s) => s.trim());
    if (num && code && num === phone) return code;
  }
  return null;
}

export async function sendOtpMessage(phone: string, code: string): Promise<void> {
  const cfg = msg91();
  if (!cfg) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[otp:dev] MSG91 not configured, code for ${phone}: ${code}`);
      return;
    }
    throw new Error("MSG91 not configured: set MSG91_AUTH_KEY, MSG91_WHATSAPP_NUMBER, MSG91_WHATSAPP_NAMESPACE");
  }

  const res = await fetch(MSG91_URL, {
    method: "POST",
    headers: { authkey: cfg.authKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      integrated_number: cfg.number,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: "uae_otp",
          language: { code: "en", policy: "deterministic" },
          namespace: cfg.namespace,
          to_and_components: [
            {
              to: [phone.replace(/^\+/, "")],
              components: {
                body_1: { type: "text", value: code },
                // "Copy code" button
                button_1: { subtype: "url", type: "text", value: code },
              },
            },
          ],
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`MSG91 error (${res.status}): ${(await res.text()).slice(0, 300)}`);
}
