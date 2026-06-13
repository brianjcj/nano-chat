import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const SIZE_BUDGET_BYTES = 250 * 1024;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");

export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export async function buildSizeReport(projectRoot = defaultProjectRoot) {
  const assetsDirectory = path.join(projectRoot, "dist", "assets");
  let entries;

  try {
    entries = await readdir(assetsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { assets: [], totalBytes: 0 };
    }

    throw error;
  }

  const assetNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const assets = await Promise.all(
    assetNames.map(async (name) => {
      const contents = await readFile(path.join(assetsDirectory, name));
      return {
        gzipBytes: gzipSync(contents).byteLength,
        name,
      };
    }),
  );

  const totalBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);

  return { assets, totalBytes };
}

export async function reportSize({
  budgetBytes = SIZE_BUDGET_BYTES,
  log = console.log,
  projectRoot = defaultProjectRoot,
  warn = console.warn,
} = {}) {
  const report = await buildSizeReport(projectRoot);

  if (report.assets.length === 0) {
    log("No built JavaScript assets found in dist/assets.");
  } else {
    log("Gzipped JavaScript assets:");
    for (const asset of report.assets) {
      log(`- ${asset.name}: ${formatBytes(asset.gzipBytes)}`);
    }
  }

  log(`Total gzip: ${formatBytes(report.totalBytes)}`);

  if (report.totalBytes > budgetBytes) {
    warn(
      `Warning: total gzip size ${formatBytes(
        report.totalBytes,
      )} exceeds soft budget ${formatBytes(budgetBytes)}.`,
    );
  }

  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await reportSize();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
