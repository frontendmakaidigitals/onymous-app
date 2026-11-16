/**
 * SMS delivery. Plug your provider (Twilio, Unifonic, etc.) in `deliver`.
 * In development the code is logged instead of sent.
 */
export async function sendSms(phone: string, message: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[sms:dev] to ${phone}: ${message}`);
    return;
  }
  throw new Error("SMS provider not configured: implement sendSms in src/lib/sms.ts");
}
