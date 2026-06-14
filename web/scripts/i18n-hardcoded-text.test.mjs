import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannedRoots = [
  "src/features/auth",
  "src/features/shell",
  "src/features/im",
];
const userVisibleTextPattern = /[A-Za-z\u4e00-\u9fff]/u;

describe("core UI i18n coverage", () => {
  it("does not leave obvious user-facing JSX text outside translation resources", async () => {
    const componentFiles = (
      await Promise.all(
        scannedRoots.map((root) => listTsxFiles(path.join(webRoot, root))),
      )
    ).flat();

    const violations = (
      await Promise.all(componentFiles.map(findHardCodedJsxText))
    ).flat();

    expect(violations).toEqual([]);
  });
});

async function listTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listTsxFiles(entryPath);
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".tsx") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        return [entryPath];
      }

      return [];
    }),
  );

  return nestedFiles.flat();
}

async function findHardCodedJsxText(filePath) {
  const source = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];

  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = node.getFullText(sourceFile).replace(/\s+/g, " ").trim();

      if (userVisibleTextPattern.test(text)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        violations.push(
          `${path.relative(webRoot, filePath)}:${line + 1}:${character + 1} ${JSON.stringify(text)}`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
