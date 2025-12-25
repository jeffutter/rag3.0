/**
 * Formats an OpenAI API request as a curl command for debugging purposes.
 */
export function formatAsCurl(options: {
  baseURL: string;
  apiKey?: string;
  endpoint?: string;
  body: Record<string, unknown>;
}): string {
  const { baseURL, apiKey, endpoint = "/chat/completions", body } = options;

  // Construct the full URL
  const url = `${baseURL.replace(/\/$/, "")}${endpoint}`;

  // Build curl command parts
  const parts: string[] = ["curl", `'${url}'`];

  // Add headers
  parts.push("-H 'Content-Type: application/json'");

  if (apiKey) {
    parts.push(`-H 'Authorization: Bearer ${apiKey}'`);
  }

  // Add method
  parts.push("-X POST");

  // Add JSON body with proper formatting
  const jsonBody = JSON.stringify(body, null, 2);
  // Escape single quotes in the JSON for shell safety
  const escapedBody = jsonBody.replace(/'/g, "'\\''");
  parts.push(`-d '${escapedBody}'`);

  // Join with backslash continuation for readability
  return parts.join(" \\\n  ");
}
