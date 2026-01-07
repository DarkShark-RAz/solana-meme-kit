import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getJitoTipFloor } from "../src/utils/jitoTools";
import { MemeKit } from "../src/core/MemeKit";

const realFetch = globalThis.fetch;

describe("jitoTools.getJitoTipFloor", () => {
  beforeEach(() => {
    (globalThis as any).fetch = undefined;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("should return 95th percentile value when API succeeds", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => [
          {
            time: "2024-09-01T12:58:00Z",
            landed_tips_95th_percentile: 0.0014479055,
          },
        ],
      } as any;
    }) as any;

    const tip = await getJitoTipFloor({ fallbackSol: 0.123 });
    expect(tip).toBeCloseTo(0.0014479055, 12);
  });

  it("should fallback when fetch fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as any;

    const tip = await getJitoTipFloor({ fallbackSol: 0.002 });
    expect(tip).toBe(0.002);
  });
});

describe("MemeKit.getSmartTip", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("should return value from getJitoTipFloor", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => [
          {
            time: "2024-09-01T12:58:00Z",
            landed_tips_95th_percentile: 0.0042,
          },
        ],
      } as any;
    }) as any;

    const tip = await MemeKit.getSmartTip();
    expect(tip).toBeCloseTo(0.0042, 12);
  });
});
