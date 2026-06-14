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
  "src/shared/ui",
];
const userVisibleTextPattern = /[A-Za-z\u4e00-\u9fff]/u;
const userVisibleStringAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-valuetext",
  "placeholder",
  "title",
]);

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

  it("flags static user-facing JSX string attributes while ignoring structural attributes", () => {
    const violations = findHardCodedJsxTextInSource(
      path.join(webRoot, "src/shared/ui/example.tsx"),
      `
        export function Example() {
          return (
            <button
              aria-label="Close dialog"
              title={"Close sheet"}
              className="rounded text-sm"
              id="close-button"
              type="button"
              data-state="open"
            >
              {translated}
            </button>
          );
        }
      `,
    );

    expect(violations).toHaveLength(2);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('aria-label="Close dialog"'),
        expect.stringContaining('title="Close sheet"'),
      ]),
    );
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

  return findHardCodedJsxTextInSource(filePath, source);
}

function findHardCodedJsxTextInSource(filePath, source) {
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

      if (hasUserVisibleText(text)) {
        addViolation(node, JSON.stringify(text));
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      const attributeValue = getStaticStringAttributeValue(node);

      if (
        userVisibleStringAttributes.has(attributeName) &&
        attributeValue !== null &&
        hasUserVisibleText(attributeValue)
      ) {
        addViolation(
          node.name,
          `${attributeName}=${JSON.stringify(attributeValue)}`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  function addViolation(node, detail) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    violations.push(
      `${path.relative(webRoot, filePath)}:${line + 1}:${character + 1} ${detail}`,
    );
  }

  visit(sourceFile);
  return violations;
}

function getStaticStringAttributeValue(attribute) {
  const initializer = attribute.initializer;

  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return null;
  }

  if (
    ts.isStringLiteral(initializer.expression) ||
    ts.isNoSubstitutionTemplateLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }

  return null;
}

function hasUserVisibleText(value) {
  return userVisibleTextPattern.test(value);
}
