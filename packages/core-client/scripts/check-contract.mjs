import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function dereference(value) {
  if (!value?.$ref) return value;
  const parts = value.$ref.replace(/^#\//, "").split("/");
  let current = contract;
  for (const part of parts) {
    current = current?.[part];
  }
  return current;
}

function schemaAllowsNull(schema) {
  const value = dereference(schema);
  return (
    value?.nullable === true ||
    value?.type === "null" ||
    (Array.isArray(value?.type) && value.type.includes("null")) ||
    value?.anyOf?.some(schemaAllowsNull) ||
    value?.oneOf?.some(schemaAllowsNull)
  );
}

function schemaTsType(schema) {
  if (schema?.$ref) return schema.$ref.split("/").at(-1);
  const value = dereference(schema);
  if (!value) return "unknown";
  if (value.anyOf || value.oneOf) {
    const variants = [...(value.anyOf ?? []), ...(value.oneOf ?? [])]
      .filter((variant) => dereference(variant)?.type !== "null")
      .map(schemaTsType);
    return [...new Set(variants)].join(" | ") || "null";
  }
  if (value.$ref) return value.$ref.split("/").at(-1);
  if (value.type === "array") return `${schemaTsType(value.items)}[]`;
  if (value.enum) return value.enum.map((item) => JSON.stringify(item)).join(" | ");
  if (value.type === "integer" || value.type === "number") return "number";
  if (value.type === "string") return "string";
  if (value.type === "boolean") return "boolean";
  return "unknown";
}

function expectedPropertyLine(name, schema, required) {
  const optional = required ? "" : "?";
  const nullable = schemaAllowsNull(schema) ? " | null" : "";
  return `${name}${optional}: ${schemaTsType(schema)}${nullable};`;
}

function interfaceBody(name) {
  const pattern = new RegExp(`export\\s+interface\\s+${name}(?:<[^>]+>)?\\s*{([\\s\\S]*?)\\n}`);
  const match = generated.match(pattern);
  return match?.[1] ?? "";
}

function requireLine(body, line, context) {
  if (!body.includes(line)) {
    fail(`${context} must include '${line}'`);
  }
}

function requireNotLine(body, line, context) {
  if (body.includes(line)) {
    fail(`${context} must not include '${line}'`);
  }
}

function schema(name) {
  const value = schemas[name];
  if (!value) {
    fail(`OpenAPI contract missing schema ${name}`);
  }
  return value;
}

function assertInterfaceMatchesSchema(name) {
  const openApiSchema = schema(name);
  const body = interfaceBody(name);
  if (!body) {
    fail(`generated-contract.ts missing interface ${name}`);
    return;
  }

  const required = new Set(openApiSchema.required ?? []);
  for (const [propertyName, propertySchema] of Object.entries(openApiSchema.properties ?? {})) {
    const expected = expectedPropertyLine(propertyName, propertySchema, required.has(propertyName));
    requireLine(body, expected, `generated-contract.ts ${name}`);

    if (!required.has(propertyName)) {
      requireNotLine(
        body,
        expectedPropertyLine(propertyName, propertySchema, true),
        `generated-contract.ts ${name}`
      );
    }
  }
}

function parameterName(parameter) {
  return dereference(parameter)?.name;
}

function operation(operationId) {
  for (const [route, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, candidate] of Object.entries(pathItem ?? {})) {
      if (candidate?.operationId === operationId) {
        return { route, method, operation: candidate };
      }
    }
  }
  fail(`OpenAPI contract missing operation ${operationId}`);
  return null;
}

function assertOperationParameters(operationId, names) {
  const found = operation(operationId);
  if (!found) return;
  const actual = (found.operation.parameters ?? []).map(parameterName);
  for (const name of names) {
    if (!actual.includes(name)) {
      fail(`OpenAPI operation ${operationId} missing parameter ${name}`);
    }
  }
}

function operationParameter(operationId, name) {
  const found = operation(operationId);
  return (found?.operation.parameters ?? [])
    .map(dereference)
    .find((parameter) => parameter?.name === name);
}

function assertParamLine(interfaceName, parameterName, line) {
  const parameter = operationParameter(
    interfaceName === "ListMediaParams" ? "listMedia" : "listFolderChildren",
    parameterName
  );
  if (!parameter) {
    fail(`OpenAPI parameter ${parameterName} missing for ${interfaceName}`);
    return;
  }
  requireLine(interfaceBody(interfaceName), line, `generated-contract.ts ${interfaceName}`);
}

const contract = parse(read("contracts/core-api/openapi.yaml"));
const generated = read("packages/core-client/src/generated-contract.ts");
const client = read("packages/core-client/src/client.ts");

const schemas = contract.components?.schemas ?? {};

for (const name of [
  "AcceptedRootResponse",
  "ScanSummary",
  "RootRecord",
  "RootListResponse",
  "FolderRecord",
  "FolderListResponse",
  "MediaRecord",
  "MediaListResponse",
  "TaskRecord",
  "TaskListResponse"
]) {
  schema(name);
}

assertInterfaceMatchesSchema("ScanSummary");
assertInterfaceMatchesSchema("AcceptedRootResponse");
assertInterfaceMatchesSchema("RootRecord");
assertInterfaceMatchesSchema("FolderRecord");
assertInterfaceMatchesSchema("MediaRecord");
assertInterfaceMatchesSchema("TaskRecord");

const pageBody = interfaceBody("Page");
for (const line of ["items: T[];", "nextCursor: string | null;"]) {
  requireLine(pageBody, line, "generated-contract.ts Page");
}

const listMediaBody = interfaceBody("ListMediaParams");
for (const [name, line] of [
  ["rootId", "rootId?: number;"],
  ["folderId", "folderId?: number;"],
  ["limit", "limit?: number;"],
  ["cursor", "cursor?: string;"],
  ["sort", `sort?: ${operationParameter("listMedia", "sort")?.schema?.enum.map((item) => JSON.stringify(item)).join(" | ")};`],
  ["kind", `kind?: ${operationParameter("listMedia", "kind")?.schema?.enum.map((item) => JSON.stringify(item)).join(" | ")};`]
]) {
  assertParamLine("ListMediaParams", name, line);
}

const listFolderChildrenBody = interfaceBody("ListFolderChildrenParams");
if (!listFolderChildrenBody) {
  fail("generated-contract.ts missing ListFolderChildrenParams");
}
for (const [name, line] of [
  ["limit", "limit?: number;"],
  ["cursor", "cursor?: string;"]
]) {
  assertParamLine("ListFolderChildrenParams", name, line);
}

assertOperationParameters("listFolderChildren", ["folderId", "limit", "cursor"]);
assertOperationParameters("listMedia", ["rootId", "folderId", "limit", "cursor", "sort", "kind"]);
assertOperationParameters("getMedia", ["fileId"]);

for (const method of ["listRoots", "addRoot", "listFolderChildren", "listMedia", "getMedia", "listTasks"]) {
  if (!client.includes(`${method}:`)) {
    fail(`client.ts missing operation ${method}`);
  }
}

const taskBody = interfaceBody("TaskRecord");
for (const line of [
  "itemsSeen: number;",
  "itemsTotal: number | null;",
  "foldersSeen: number;",
  "mediaFilesSeen: number;",
  "skippedFiles: number;"
]) {
  requireLine(taskBody, line, "generated-contract.ts TaskRecord");
}

if (!/listTasks:\s*\(\)\s*=>\s*request<Page<TaskRecord>>\("\/tasks"\)/.test(client)) {
  fail("client.ts listTasks must request typed task pages");
}

if (!/listFolderChildren:\s*\(folderId:\s*number,\s*params:\s*ListFolderChildrenParams\s*=\s*{}\)\s*=>\s*request<Page<FolderRecord>>\(`\/folders\/\$\{folderId\}\/children\$\{query\(params\)\}`\)/.test(client)) {
  fail("client.ts listFolderChildren must accept typed limit/cursor params and serialize them");
}

if (!/listMedia:\s*\(params:\s*ListMediaParams\s*=\s*{}\)\s*=>\s*request<Page<MediaRecord>>\(`\/media\$\{query\(params\)\}`\)/.test(client)) {
  fail("client.ts listMedia must serialize typed query params");
}

if (!/async function readResponseBody\(response:\s*Response\):\s*Promise<unknown>/.test(client)) {
  fail("client.ts must parse response bodies without leaking JSON.parse errors on non-OK responses");
}

if (!/async function readResponseBody[\s\S]*?try\s*{[\s\S]*?JSON\.parse\(text\)[\s\S]*?}\s*catch\s*{[\s\S]*?return text;[\s\S]*?}/.test(client)) {
  fail("client.ts readResponseBody must return raw text for malformed JSON error bodies");
}

if (!/if \(!response\.ok\)\s*{[\s\S]*?const body = await readResponseBody\(response\);[\s\S]*?throw new CoreApiError\(response\.status, body\);[\s\S]*?}\s*const body = await readJson\(response\);/.test(client)) {
  fail("client.ts must use tolerant body parsing only for non-OK CoreApiError responses");
}

if (!client.includes("x-megle-session")) {
  fail("client.ts must send x-megle-session when configured");
}

if (!generated.includes("Generated-client boundary placeholder")) {
  fail("generated-contract.ts must mark the generated-client boundary");
}

if (!process.exitCode) {
  console.log("PASS: core-client contract boundary");
}
