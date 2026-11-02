// Python reference data written by scripts/make_fixtures.py (loaded once, shared by the test files).
import { loadJSON } from "./harness.js";

export const F = await loadJSON("./fixtures/parity.json");

/** A Python Question dict (dataclasses.asdict) with the JS field names. */
export function fromPython(q) {
  const { from_ratio: fromRatio, is_retry: isRetry, ...rest } = q;
  return { ...rest, fromRatio, isRetry };
}
