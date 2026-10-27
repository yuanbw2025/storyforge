/** Pure exact-input parsing only; never stores hashes, authority or promises. */
export function createProductRuntimeHeadParsingV1<T>(
  parse: (json: string) => T,
  clone: (value: T) => T,
  limits = { maxEntries: 8, maxCodeUnits: 16 * 1024 * 1024 },
): (json: string) => T {
  if (
    !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1 ||
    !Number.isSafeInteger(limits.maxCodeUnits) || limits.maxCodeUnits < 1
  ) throw new Error("Invalid runtime parsing bounds");

  const entries = new Map<string, T>();
  let retained = 0;
  const remove = (json: string) => {
    if (entries.delete(json)) retained -= json.length;
  };
  return (json: string): T => {
    // Oversized heads keep their original full parser and admission behavior.
    if (json.length > limits.maxCodeUnits) return parse(json);
    let value: T;
    if (entries.has(json)) {
      value = entries.get(json)!;
      entries.delete(json);
      entries.set(json, value);
    } else {
      value = parse(json);
      while (
        entries.size >= limits.maxEntries ||
        retained + json.length > limits.maxCodeUnits
      ) remove(entries.keys().next().value!);
      entries.set(json, value);
      retained += json.length;
    }
    // Callers may mutate their returned state; the retained value stays private.
    try {
      return clone(value);
    } catch (error) {
      remove(json);
      throw error;
    }
  };
}
