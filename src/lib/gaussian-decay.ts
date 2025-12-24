import { DateTime } from "luxon";

export interface GaussianDecayParams {
  target: string;
  scale: number;
  metadata: {
    rangeDays: number;
    scaleMultiplier: number;
    scaleDays: number;
  };
}

/**
 * Calculate Gaussian decay parameters for a date range.
 * Used to boost search results based on their timestamp proximity to a target date range.
 *
 * @param startDate - RFC3339/ISO 8601 datetime string
 * @param endDate - RFC3339/ISO 8601 datetime string
 * @param scaleMultiplier - Adjust curve width (1.0 = standard, 1.5 = wider, 0.5 = narrower)
 * @returns Parameters for Qdrant gauss_decay formula
 */
export function calculateGaussianDecayParams(
  startDate: string,
  endDate: string,
  scaleMultiplier = 1.0,
): GaussianDecayParams {
  const start = DateTime.fromISO(startDate, { zone: "utc" });
  const end = DateTime.fromISO(endDate, { zone: "utc" });

  // Validate inputs
  if (!start.isValid) {
    throw new Error(`Invalid start date: ${startDate} - ${start.invalidReason}`);
  }
  if (!end.isValid) {
    throw new Error(`Invalid end date: ${endDate} - ${end.invalidReason}`);
  }
  if (end <= start) {
    throw new Error("End date must be after start date");
  }

  // Calculate midpoint
  const rangeDuration = end.diff(start);
  const target = start.plus(rangeDuration.milliseconds / 2);

  // Calculate scale (half the range width in seconds)
  const scaleSeconds = Math.floor((rangeDuration.as("seconds") / 2) * scaleMultiplier);

  return {
    target: target.toISO() as string,
    scale: scaleSeconds,
    metadata: {
      rangeDays: rangeDuration.as("days"),
      scaleMultiplier,
      scaleDays: scaleSeconds / 86400,
    },
  };
}

/**
 * Process date range inputs and calculate gaussian decay parameters.
 * Handles cases where only one date is provided by filling in reasonable defaults.
 *
 * @param startDateTime - Optional RFC3339/ISO 8601 start datetime string
 * @param endDateTime - Optional RFC3339/ISO 8601 end datetime string
 * @param scaleMultiplier - Adjust curve width (1.0 = standard, 1.5 = wider, 0.5 = narrower)
 * @returns Gaussian decay parameters or undefined if no dates provided
 */
export function processDateRange(
  startDateTime?: string,
  endDateTime?: string,
  scaleMultiplier = 1.0,
): GaussianDecayParams | undefined {
  // If neither date is provided, return undefined
  if (!startDateTime && !endDateTime) {
    return undefined;
  }

  // If only end date is provided, use a default start date (2020-01-01 UTC)
  let start = startDateTime;
  if (!start && endDateTime) {
    start = DateTime.utc(2020).toISO() as string;
  }

  // If only start date is provided, use current time as end date
  let end = endDateTime;
  if (!end && start) {
    end = DateTime.now().toUTC().toISO() as string;
  }

  // Both dates should now be defined
  if (!start || !end) {
    return undefined;
  }

  return calculateGaussianDecayParams(start, end, scaleMultiplier);
}
