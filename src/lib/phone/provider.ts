// Phone verification providers. The app ships with a no-SMS stub (default)
// so the whole flow works in dev with the code surfaced in the UI, and a
// Twilio Verify implementation for production. Server-only — routes import
// this; never ship it to the client.

import { createHash, randomInt } from "node:crypto";

export interface PhoneVerifier {
  /**
   * Begin verification for a phone number (E.164). The stub returns the
   * generated code as `devCode` so dev UIs can display it; real providers
   * send an SMS and return an empty object.
   */
  start(phone: string): Promise<{ devCode?: string }>;
  /** Confirm a code the user typed. */
  check(phone: string, code: string): Promise<boolean>;
}

/** Lowercase hex SHA-256 — used by the routes to store/compare stub codes. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Dev/default provider: generates a random 6-digit code and hands it back so
 * the caller can hash + store it (see /api/phone/start) and the dev UI can
 * show it. No network, no SMS.
 */
export class StubVerifier implements PhoneVerifier {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async start(phone: string): Promise<{ devCode?: string }> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    return { devCode: code };
  }

  /**
   * Checking a stub code is a hash comparison against the stored
   * phone_verifications.code_hash, which the route owns (it has DB access;
   * this class deliberately does not). Always false here.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async check(phone: string, code: string): Promise<boolean> {
    return false;
  }
}

/** Production provider backed by Twilio Verify. Credentials read per call so
 * constructing the class never throws (getVerifier stays cheap and safe). */
export class TwilioVerifier implements PhoneVerifier {
  private credentials() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!accountSid || !authToken || !serviceSid) {
      throw new Error(
        "Twilio is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID (or unset PHONE_VERIFY_PROVIDER to use the stub)."
      );
    }
    return {
      serviceSid,
      authHeader: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString(
        "base64"
      )}`,
    };
  }

  private async post(
    path: "Verifications" | "VerificationCheck",
    form: Record<string, string>
  ): Promise<Response> {
    const { serviceSid, authHeader } = this.credentials();
    return fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      }
    );
  }

  async start(phone: string): Promise<{ devCode?: string }> {
    const res = await this.post("Verifications", { To: phone, Channel: "sms" });
    if (!res.ok) {
      throw new Error(`Twilio verification start failed (HTTP ${res.status})`);
    }
    return {};
  }

  async check(phone: string, code: string): Promise<boolean> {
    const res = await this.post("VerificationCheck", { To: phone, Code: code });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as {
      status?: string;
    } | null;
    return data?.status === "approved";
  }
}

/**
 * Pick the provider from PHONE_VERIFY_PROVIDER ('stub' by default).
 *
 * The stub surfaces the verification code to the caller, so it must never run
 * in production: outside dev/test we refuse to fall back to it unless the
 * operator has explicitly opted in with ALLOW_STUB_PHONE_VERIFY=true. Throwing
 * here (rather than silently stubbing) forces a misconfigured production
 * deploy to fail loudly instead of shipping a bypassable verification flow.
 */
export function getVerifier(): PhoneVerifier {
  if (process.env.PHONE_VERIFY_PROVIDER === "twilio") {
    return new TwilioVerifier();
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_STUB_PHONE_VERIFY !== "true"
  ) {
    throw new Error(
      "Phone verification is not configured for production: set PHONE_VERIFY_PROVIDER=twilio (with Twilio credentials) or, only for a non-public deploy, ALLOW_STUB_PHONE_VERIFY=true to permit the insecure stub."
    );
  }
  return new StubVerifier();
}
