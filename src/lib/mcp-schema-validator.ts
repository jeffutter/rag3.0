import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types.js";
import { createLogger } from "../core/logging/logger";

const logger = createLogger("mcp-schema-validator");

/**
 * Normalizes JSON Schema to use standard formats.
 * Replaces non-standard formats like "uint" with standard JSON Schema types.
 */
function normalizeSchemaForValidation(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  // Handle arrays
  if (Array.isArray(schema)) {
    return schema.map(normalizeSchemaForValidation);
  }

  // Clone to avoid mutation
  const normalized = { ...schema };

  // Replace non-standard "uint" format with standard integer + minimum constraint
  if (normalized.format === "uint") {
    delete normalized.format;
    if (!normalized.type) {
      normalized.type = "integer";
    }
    if (normalized.minimum === undefined) {
      normalized.minimum = 0;
    }
  }

  // Recursively normalize all nested objects
  for (const key in normalized) {
    if (typeof normalized[key] === "object" && normalized[key] !== null) {
      normalized[key] = normalizeSchemaForValidation(normalized[key]);
    }
  }

  return normalized;
}

/**
 * Custom JSON Schema validator that normalizes schemas before validation.
 * This allows us to handle non-standard format types like "uint".
 */
export class NormalizingJsonSchemaValidator implements jsonSchemaValidator {
  private innerValidator: jsonSchemaValidator;

  constructor(innerValidator: jsonSchemaValidator) {
    this.innerValidator = innerValidator;
  }

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    // Normalize the schema to handle non-standard formats
    const normalizedSchema = normalizeSchemaForValidation(schema);

    logger.debug({
      event: "creating_validator_with_normalized_schema",
      hasUintFormat: JSON.stringify(schema).includes('"uint"'),
      normalizedHasUint: JSON.stringify(normalizedSchema).includes('"uint"'),
    });

    // Get the inner validator with the normalized schema
    return this.innerValidator.getValidator<T>(normalizedSchema);
  }
}
