import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const [, , inputPath, baseUrlArg] = process.argv;

  if (!inputPath) {
    throw new Error("Usage: node scripts/import-knowledge.mjs <json-file> [worker-base-url]");
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The input JSON file must contain a non-empty array of documents.");
  }

  const baseUrl = baseUrlArg ?? "http://127.0.0.1:8787";
  const response = await fetch(`${baseUrl}/api/admin/knowledge/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ documents: parsed })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Import failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
