import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "tests/**/*.spec.ts",
      "tests/**/*.test.ts",
    ],
    testTimeout: 20_000,
    reporters: ["default"],
  },
});
