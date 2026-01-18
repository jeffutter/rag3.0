/**
 * Tests for the formatting utilities.
 */

import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  formatETA,
  formatNumber,
  formatRate,
  padLeft,
  padRight,
  renderBar,
  renderColoredBar,
  stripAnsi,
  truncate,
  visibleLength,
} from "./formatting";

describe("formatDuration", () => {
  test("formats milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  test("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(5400000)).toBe("1h 30m");
  });

  test("handles negative values", () => {
    expect(formatDuration(-100)).toBe("0ms");
  });
});

describe("formatRate", () => {
  test("formats zero rate", () => {
    expect(formatRate(0)).toBe("0/s");
    expect(formatRate(-1)).toBe("0/s");
  });

  test("formats rates less than 1/s as per minute", () => {
    expect(formatRate(0.5)).toBe("30.0/min");
    expect(formatRate(0.1)).toBe("6.0/min");
  });

  test("formats rates per second", () => {
    expect(formatRate(1)).toBe("1.0/s");
    expect(formatRate(50)).toBe("50.0/s");
    expect(formatRate(999)).toBe("999.0/s");
  });

  test("formats thousands per second", () => {
    expect(formatRate(1000)).toBe("1.0K/s");
    expect(formatRate(2500)).toBe("2.5K/s");
    expect(formatRate(999999)).toBe("1000.0K/s");
  });

  test("formats millions per second", () => {
    expect(formatRate(1000000)).toBe("1.0M/s");
    expect(formatRate(2500000)).toBe("2.5M/s");
  });
});

describe("formatNumber", () => {
  test("formats small numbers", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(500)).toBe("500");
    expect(formatNumber(999)).toBe("999");
  });

  test("formats thousands", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(2500)).toBe("2.5K");
    expect(formatNumber(999999)).toBe("1000.0K");
  });

  test("formats millions", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(2500000)).toBe("2.5M");
  });

  test("formats billions", () => {
    expect(formatNumber(1000000000)).toBe("1.0B");
  });

  test("formats negative numbers", () => {
    expect(formatNumber(-500)).toBe("-500");
    expect(formatNumber(-2500)).toBe("-2.5K");
  });

  test("respects decimal places", () => {
    expect(formatNumber(1234, 0)).toBe("1K");
    expect(formatNumber(1234, 2)).toBe("1.23K");
  });
});

describe("formatETA", () => {
  test("formats done state", () => {
    expect(formatETA(0)).toBe("done");
    expect(formatETA(-100)).toBe("done");
  });

  test("formats calculating state", () => {
    expect(formatETA(Number.POSITIVE_INFINITY)).toBe("calculating...");
    expect(formatETA(Number.NaN)).toBe("calculating...");
  });

  test("formats remaining time", () => {
    expect(formatETA(5000)).toBe("ETA 5.0s");
    expect(formatETA(90000)).toBe("ETA 1m 30s");
  });
});

describe("renderBar", () => {
  test("renders empty bar", () => {
    expect(renderBar(0, 12)).toBe("[----------]");
  });

  test("renders full bar", () => {
    expect(renderBar(1, 12)).toBe("[##########]");
  });

  test("renders partial bar", () => {
    // At exactly 0.5 with 10 inner chars, we get exactly 5 filled chars (no partial)
    expect(renderBar(0.5, 12)).toBe("[#####-----]");
    // At 0.55, we get 5 filled + partial indicator
    expect(renderBar(0.55, 12)).toBe("[#####>----]");
  });

  test("clamps ratio to 0-1 range", () => {
    expect(renderBar(-0.5, 12)).toBe("[----------]");
    expect(renderBar(1.5, 12)).toBe("[##########]");
  });

  test("shows percentage when requested", () => {
    expect(renderBar(0.5, 12, true)).toBe("[#####-----] 50%");
    expect(renderBar(0.75, 12, true)).toBe("[#######>--] 75%");
  });

  test("handles different widths", () => {
    expect(renderBar(0.5, 6)).toBe("[##--]");
    expect(renderBar(0.5, 22)).toBe("[##########----------]");
  });
});

describe("renderColoredBar", () => {
  test("renders bar with ANSI codes", () => {
    const bar = renderColoredBar(0.5, 12);
    // Should contain ANSI escape codes
    expect(bar).toContain("\x1b[");
    // When stripped, should have correct structure
    expect(stripAnsi(bar)).toBe("[#####-----]");
  });

  test("shows percentage with color", () => {
    const bar = renderColoredBar(0.5, 12, true);
    expect(stripAnsi(bar)).toBe("[#####-----] 50%");
  });
});

describe("truncate", () => {
  test("returns string if shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  test("handles edge case where maxWidth equals string length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("handles very short max width", () => {
    expect(truncate("hello", 3)).toBe("...");
    expect(truncate("hello", 2)).toBe("..");
  });

  test("uses custom ellipsis", () => {
    expect(truncate("hello world", 8, "~")).toBe("hello w~");
  });
});

describe("padRight", () => {
  test("pads string to target width", () => {
    expect(padRight("hi", 5)).toBe("hi   ");
  });

  test("returns original string if already at width", () => {
    expect(padRight("hello", 5)).toBe("hello");
  });

  test("returns original string if longer than width", () => {
    expect(padRight("hello world", 5)).toBe("hello world");
  });

  test("uses custom padding character", () => {
    expect(padRight("hi", 5, "-")).toBe("hi---");
  });
});

describe("padLeft", () => {
  test("pads string to target width", () => {
    expect(padLeft("hi", 5)).toBe("   hi");
  });

  test("returns original string if already at width", () => {
    expect(padLeft("hello", 5)).toBe("hello");
  });

  test("returns original string if longer than width", () => {
    expect(padLeft("hello world", 5)).toBe("hello world");
  });

  test("uses custom padding character", () => {
    expect(padLeft("42", 5, "0")).toBe("00042");
  });
});

describe("stripAnsi", () => {
  test("removes ANSI color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    expect(stripAnsi("\x1b[1m\x1b[32mbold green\x1b[0m")).toBe("bold green");
  });

  test("handles strings without ANSI codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  test("handles empty strings", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("visibleLength", () => {
  test("calculates length excluding ANSI codes", () => {
    expect(visibleLength("\x1b[31mred\x1b[0m")).toBe(3);
    expect(visibleLength("\x1b[1m\x1b[32mbold green\x1b[0m")).toBe(10);
  });

  test("handles strings without ANSI codes", () => {
    expect(visibleLength("plain text")).toBe(10);
  });
});
