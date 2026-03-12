import fs from "node:fs/promises";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

function inferSourceType(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();

  if (normalized.includes("sample resumes")) {
    return "expert_resume";
  }

  if (normalized.includes("job descriptions")) {
    return "jd_template";
  }

  return "resume_guide";
}

function titleFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim();
}

async function collectFiles(rootDir) {
  const results = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

async function loadDocumentsFromFile(rootDir, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const relativePath = path.relative(rootDir, filePath);
  const sourceType = inferSourceType(relativePath);

  if (extension === ".json") {
    const rawJson = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(rawJson);

    if (!Array.isArray(parsed)) {
      throw new Error(`JSON file must contain an array: ${relativePath}`);
    }

    return parsed.map((document, index) => ({
      id: document.id ?? `${relativePath}:${index}`,
      title: document.title ?? `${titleFromPath(filePath)} ${index + 1}`,
      text: document.text ?? "",
      sourceType: document.sourceType ?? sourceType,
      qualityScore: document.qualityScore ?? 1
    }));
  }

  const text = (await fs.readFile(filePath, "utf8")).trim();
  if (!text) {
    return [];
  }

  return [
    {
      id: relativePath,
      title: titleFromPath(filePath),
      text,
      sourceType,
      qualityScore: 1
    }
  ];
}

async function main() {
  const [, , folderArg, baseUrlArg] = process.argv;
  const folderPath = path.resolve(process.cwd(), folderArg ?? "knowledge materials");
  const baseUrl = baseUrlArg ?? "http://127.0.0.1:8787";

  const files = await collectFiles(folderPath);
  if (files.length === 0) {
    throw new Error(`No supported knowledge files found in ${folderPath}`);
  }

  const documentGroups = await Promise.all(files.map((filePath) => loadDocumentsFromFile(folderPath, filePath)));
  const documents = documentGroups.flat().filter((document) => document.text && document.title);

  if (documents.length === 0) {
    throw new Error("No importable documents were found after parsing the folder.");
  }

  const response = await fetch(`${baseUrl}/api/admin/knowledge/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ documents })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Folder import failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(JSON.stringify({ importedFiles: files.length, importedDocuments: documents.length, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
