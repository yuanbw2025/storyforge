/** Stable bytes for existing runtime comparison and fingerprint contracts. */
export function stableRuntimeJsonV1(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRuntimeJsonV1).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, child]) => `${JSON.stringify(field)}:${stableRuntimeJsonV1(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
