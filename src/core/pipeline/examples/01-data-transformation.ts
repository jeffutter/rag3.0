/**
 * Example 1: Data Transformation with Map/Filter
 *
 * This example demonstrates the new list operations for data transformation:
 * - map(): Transform each element in an array
 * - filter(): Remove elements that don't match a predicate
 * - Parallel execution for performance
 *
 * Use case: Processing and cleaning a list of user records.
 */

import { Pipeline } from "../builder";
import { createStep } from "../steps";

// Types for our example
interface RawUser {
	id: number;
	name: string;
	email: string;
	age: number;
	active: boolean;
}

interface EnrichedUser {
	id: number;
	name: string;
	email: string;
	age: number;
	active: boolean;
	displayName: string;
	emailDomain: string;
	category: "young" | "adult" | "senior";
}

interface UserSummary {
	totalUsers: number;
	activeUsers: number;
	averageAge: number;
	categories: Record<string, number>;
}

/**
 * Example: Data transformation pipeline
 *
 * This pipeline:
 * 1. Starts with raw user data
 * 2. Filters out inactive users
 * 3. Enriches each user with computed fields (parallel processing)
 * 4. Generates a summary of the enriched users
 */
export function createDataTransformationPipeline() {
	return (
		Pipeline.start<RawUser[]>()
			// Step 1: Filter to only active users
			.filter("activeUsers", (user) => user.active)

			// Step 2: Enrich each user with additional computed fields
			// Uses parallel execution for better performance
			.map(
				"enrichedUsers",
				createStep<RawUser, EnrichedUser, { activeUsers: RawUser[] }>(
					"enrichUser",
					async ({ input }) => {
						// Simulate some async processing (e.g., API call, database lookup)
						await Bun.sleep(10);

						const emailDomain = input.email.split("@")[1] || "unknown";
						const displayName = input.name
							.split(" ")
							.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
							.join(" ");

						let category: "young" | "adult" | "senior";
						if (input.age < 30) {
							category = "young";
						} else if (input.age < 60) {
							category = "adult";
						} else {
							category = "senior";
						}

						return {
							...input,
							displayName,
							emailDomain,
							category,
						};
					},
				),
				{ parallel: true, concurrencyLimit: 5 }, // Process 5 users at a time
			)

			// Step 3: Generate summary statistics
			.add(
				"summary",
				createStep<
					EnrichedUser[],
					UserSummary,
					{
						activeUsers: RawUser[];
						enrichedUsers: EnrichedUser[];
					}
				>("summarize", async ({ input, state }) => {
					const totalUsers = state.activeUsers.length;
					const activeUsers = input.filter((u) => u.active).length;
					const averageAge =
						input.reduce((sum, u) => sum + u.age, 0) / input.length;

					const categories: Record<string, number> = {};
					for (const user of input) {
						categories[user.category] = (categories[user.category] || 0) + 1;
					}

					return {
						totalUsers,
						activeUsers,
						averageAge,
						categories,
					};
				}),
			)
	);
}

/**
 * Example data for testing
 */
export const exampleUsers: RawUser[] = [
	{
		id: 1,
		name: "john doe",
		email: "john@example.com",
		age: 25,
		active: true,
	},
	{
		id: 2,
		name: "jane smith",
		email: "jane@example.com",
		age: 35,
		active: true,
	},
	{
		id: 3,
		name: "bob wilson",
		email: "bob@oldmail.net",
		age: 45,
		active: false,
	},
	{
		id: 4,
		name: "alice johnson",
		email: "alice@newmail.org",
		age: 28,
		active: true,
	},
	{
		id: 5,
		name: "charlie brown",
		email: "charlie@example.com",
		age: 65,
		active: true,
	},
	{
		id: 6,
		name: "diana prince",
		email: "diana@example.com",
		age: 32,
		active: false,
	},
	{
		id: 7,
		name: "edward norton",
		email: "ed@techcorp.com",
		age: 55,
		active: true,
	},
	{
		id: 8,
		name: "fiona apple",
		email: "fiona@musicmail.com",
		age: 22,
		active: true,
	},
];

/**
 * Run the example
 */
export async function runDataTransformationExample() {
	console.log("=== Data Transformation Example ===\n");

	const pipeline = createDataTransformationPipeline();
	const result = await pipeline.execute(exampleUsers);

	if (result.success) {
		console.log("Summary:", result.data);
		console.log("\nPipeline completed in:", result.metadata.durationMs, "ms");

		// Access intermediate results from the pipeline execution
		// In a real scenario, you might log or store these
		return result.data;
	}

	console.error("Pipeline failed:", result.error);
	return null;
}

// Export types for documentation
export type { RawUser, EnrichedUser, UserSummary };
