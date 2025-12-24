import { describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import { calculateGaussianDecayParams, processDateRange } from "./gaussian-decay";

describe("calculateGaussianDecayParams", () => {
  test("calculates correct parameters for a valid date range", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-31T00:00:00Z";

    const result = calculateGaussianDecayParams(start, end);

    // Should target the midpoint (Jan 16)
    const expectedTarget = DateTime.fromISO("2024-01-16T00:00:00.000Z", { zone: "utc" });
    expect(result.target).toBe(expectedTarget.toISO() as string);

    // Scale should be half the range (15 days = 1,296,000 seconds)
    expect(result.scale).toBe(1296000);

    // Metadata should match
    expect(result.metadata.rangeDays).toBeCloseTo(30, 0);
    expect(result.metadata.scaleMultiplier).toBe(1.0);
    expect(result.metadata.scaleDays).toBeCloseTo(15, 0);
  });

  test("applies scale multiplier correctly", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-31T00:00:00Z";

    const result = calculateGaussianDecayParams(start, end, 2.0);

    // Scale should be doubled (30 days = 2,592,000 seconds)
    expect(result.scale).toBe(2592000);
    expect(result.metadata.scaleMultiplier).toBe(2.0);
    expect(result.metadata.scaleDays).toBeCloseTo(30, 0);
  });

  test("throws error for invalid start date", () => {
    expect(() => {
      calculateGaussianDecayParams("invalid", "2024-01-31T00:00:00Z");
    }).toThrow("Invalid start date");
  });

  test("throws error for invalid end date", () => {
    expect(() => {
      calculateGaussianDecayParams("2024-01-01T00:00:00Z", "invalid");
    }).toThrow("Invalid end date");
  });

  test("throws error when end date is before start date", () => {
    expect(() => {
      calculateGaussianDecayParams("2024-01-31T00:00:00Z", "2024-01-01T00:00:00Z");
    }).toThrow("End date must be after start date");
  });

  test("throws error when dates are equal", () => {
    expect(() => {
      calculateGaussianDecayParams("2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z");
    }).toThrow("End date must be after start date");
  });
});

describe("processDateRange", () => {
  test("returns undefined when neither date is provided", () => {
    const result = processDateRange();
    expect(result).toBeUndefined();
  });

  test("uses default start date (2020) when only end date is provided", () => {
    const end = "2024-01-31T00:00:00Z";
    const result = processDateRange(undefined, end);

    expect(result).toBeDefined();
    expect(result?.metadata.rangeDays).toBeGreaterThan(1000); // More than 3 years
  });

  test("uses current time when only start date is provided", () => {
    const start = "2024-01-01T00:00:00Z";
    const result = processDateRange(start);

    expect(result).toBeDefined();
    // The range should be from start to now
    const expectedDays = DateTime.now().diff(DateTime.fromISO(start)).as("days");
    expect(result?.metadata.rangeDays).toBeCloseTo(expectedDays, 0);
  });

  test("calculates normally when both dates are provided", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-31T00:00:00Z";

    const result = processDateRange(start, end);

    expect(result).toBeDefined();
    expect(result?.metadata.rangeDays).toBeCloseTo(30, 0);
  });

  test("applies scale multiplier correctly", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-31T00:00:00Z";

    const result = processDateRange(start, end, 1.5);

    expect(result).toBeDefined();
    expect(result?.metadata.scaleMultiplier).toBe(1.5);
    expect(result?.metadata.scaleDays).toBeCloseTo(22.5, 0);
  });
});
