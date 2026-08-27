import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    // *.eval.ts calls a real LLM over the network — an occasional slow/rate-limited response
    // hitting testTimeout is expected flakiness, not a content regression (a skill-evals case
    // timed out once in CI on 2026-08-26 with no prompt/model change, while its two sibling
    // cases in the same run passed cleanly). A deterministic src/**/*.test.ts failure retries
    // once too, but since it's deterministic that retry just fails again identically — it never
    // masks a real bug, only costs one extra run.
    retry: 1,
    reporters: ["default", new TrendReporter()],
  },
});
