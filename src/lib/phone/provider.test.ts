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
  const original = process.env.PHONE_VERIFY_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.PHONE_VERIFY_PROVIDER;
    else process.env.PHONE_VERIFY_PROVIDER = original;
  });

  it("defaults to the stub provider", () => {
    delete process.env.PHONE_VERIFY_PROVIDER;
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
});

describe("sha256Hex", () => {
  it("is deterministic, 64 hex chars, and input-sensitive", () => {
    expect(sha256Hex("123456")).toBe(sha256Hex("123456"));
    expect(sha256Hex("123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("123456")).not.toBe(sha256Hex("654321"));
  });
});
