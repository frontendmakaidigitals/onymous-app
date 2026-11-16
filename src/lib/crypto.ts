import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY       = Buffer.from(process.env.ENCRYPTION_KEY!, "hex"); // 32 bytes = 64 hex chars

export function encrypt(plaintext: string): string {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Malformed ciphertext");
  const iv        = Buffer.from(ivHex, "hex");
  const authTag   = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher  = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}