import { afterEach, describe, expect, it } from "vitest";
import {
  getVerifier,
  sha256Hex,
  StubVerifier,
  TwilioVerifier,
} from "@/lib/phone/provider";

describe("StubVerifier", () => {
  it("generates a 6-digit code as devCode", async () => {
    const stub = new StubVerifier();
    for (let i = 0; i < 25; i++) {
      const { devCode } = await stub.start("+14155551234");
      expect(devCode).toMatch(/^\d{6}$/);
    }
  });

  it("never approves via check — hash comparison lives in the route", async () => {
    const stub = new StubVerifier();
    await expect(stub.check("+14155551234", "123456")).resolves.toBe(false);
  });
});

describe("getVerifier", () => {
  const originalProvider = process.env.PHONE_VERIFY_PROVIDER;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowStub = process.env.ALLOW_STUB_PHONE_VERIFY;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    restore("PHONE_VERIFY_PROVIDER", originalProvider);
    restore("NODE_ENV", originalNodeEnv);
    restore("ALLOW_STUB_PHONE_VERIFY", originalAllowStub);
  });

  it("defaults to the stub provider in dev/test", () => {
    delete process.env.PHONE_VERIFY_PROVIDER;
    // NODE_ENV is 'test' under vitest — the stub must remain the default.
    expect(getVerifier()).toBeInstanceOf(StubVerifier);
  });

  it("ignores unknown provider names", () => {
    process.env.PHONE_VERIFY_PROVIDER = "carrier-pigeon";
    expect(getVerifier()).toBeInstanceOf(StubVerifier);
  });

  it("returns the Twilio provider when configured (no network involved)", () => {
    process.env.PHONE_VERIFY_PROVIDER = "twilio";
    expect(getVerifier()).toBeInstanceOf(TwilioVerifier);
  });

  it("refuses the stub in production without an explicit opt-in", () => {
    delete process.env.PHONE_VERIFY_PROVIDER;
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_STUB_PHONE_VERIFY;
    expect(() => getVerifier()).toThrow();
  });

  it("allows the stub in production only when explicitly opted in", () => {
    delete process.env.PHONE_VERIFY_PROVIDER;
    process.env.NODE_ENV = "production";
    process.env.ALLOW_STUB_PHONE_VERIFY = "true";
    expect(getVerifier()).toBeInstanceOf(StubVerifier);
  });

  it("still uses Twilio in production regardless of the stub opt-in", () => {
    process.env.PHONE_VERIFY_PROVIDER = "twilio";
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_STUB_PHONE_VERIFY;
    expect(getVerifier()).toBeInstanceOf(TwilioVerifier);
  });
});

describe("sha256Hex", () => {
  it("is deterministic, 64 hex chars, and input-sensitive", () => {
    expect(sha256Hex("123456")).toBe(sha256Hex("123456"));
    expect(sha256Hex("123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("123456")).not.toBe(sha256Hex("654321"));
  });
});
