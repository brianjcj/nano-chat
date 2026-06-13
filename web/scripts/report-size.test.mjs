import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
  SIZE_BUDGET_BYTES,
  buildSizeReport,
  reportSize,
} from "./report-size.mjs";

const temporaryProjectRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryProjectRoots.map((projectRoot) =>
      rm(projectRoot, { force: true, recursive: true }),
    ),
  );
  temporaryProjectRoots.length = 0;
});

async function createProjectWithAssets() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "nano-chat-size-"));
  temporaryProjectRoots.push(projectRoot);
  await mkdir(path.join(projectRoot, "dist", "assets"), { recursive: true });
  return projectRoot;
}

describe("report-size", () => {
  it("calculates gzip size for built JavaScript assets", async () => {
    const projectRoot = await createProjectWithAssets();
    const appSource = "console.log('app');\n";
    const vendorSource = "export const vendor = true;\n";
    await writeFile(path.join(projectRoot, "dist", "assets", "app.js"), appSource);
    await writeFile(
      path.join(projectRoot, "dist", "assets", "vendor.js"),
      vendorSource,
    );

    const report = await buildSizeReport(projectRoot);

    expect(report.assets).toEqual([
      { gzipBytes: gzipSync(Buffer.from(appSource)).byteLength, name: "app.js" },
      {
        gzipBytes: gzipSync(Buffer.from(vendorSource)).byteLength,
        name: "vendor.js",
      },
    ]);
    expect(report.totalBytes).toBe(
      gzipSync(Buffer.from(appSource)).byteLength +
        gzipSync(Buffer.from(vendorSource)).byteLength,
    );
  });

  it("prints totals and warns when the soft budget is exceeded", async () => {
    const projectRoot = await createProjectWithAssets();
    await writeFile(
      path.join(projectRoot, "dist", "assets", "large.js"),
      randomBytes(SIZE_BUDGET_BYTES + 1024),
    );
    const output = [];
    const warnings = [];

    const report = await reportSize({
      log: (line) => output.push(line),
      projectRoot,
      warn: (line) => warnings.push(line),
    });

    expect(report.totalBytes).toBeGreaterThan(SIZE_BUDGET_BYTES);
    expect(output.some((line) => line.includes("large.js"))).toBe(true);
    expect(output.at(-1)).toContain("Total gzip:");
    expect(warnings).toEqual([
      expect.stringContaining("exceeds soft budget"),
    ]);
  });
});
