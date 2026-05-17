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
  "ScanTaskRequest",
  "ScanSummary",
  "RootRecord",
  "RootListResponse",
  "FolderRecord",
  "FolderListResponse",
  "MediaRecord",
  "MediaListResponse",
  "ThumbnailAsset",
  "ThumbnailResponse",
  "TaskKind",
  "TaskStatus",
  "TaskRecord",
  "TaskListResponse",
  "TagRecord",
  "TagListResponse",
  "CreateTagRequest",
  "DeleteTagResponse",
  "UserMetadataRecord",
  "UserMetadataUpdate",
  "FileTagsResponse",
  "AddFileTagRequest",
  "SetFileTagsRequest",
  "FileOperationRecord",
  "FileOperationsResponse",
  "FileOperationListResponse",
  "RenameRequest",
  "MoveRequest",
  "DeleteRequest"
]) {
  schema(name);
}

assertInterfaceMatchesSchema("ScanSummary");
assertInterfaceMatchesSchema("AcceptedRootResponse");
assertInterfaceMatchesSchema("ScanTaskRequest");
assertInterfaceMatchesSchema("RootRecord");
assertInterfaceMatchesSchema("FolderRecord");
assertInterfaceMatchesSchema("MediaRecord");
assertInterfaceMatchesSchema("ThumbnailAsset");
assertInterfaceMatchesSchema("ThumbnailResponse");
assertInterfaceMatchesSchema("TaskRecord");
assertInterfaceMatchesSchema("TagRecord");
assertInterfaceMatchesSchema("CreateTagRequest");
assertInterfaceMatchesSchema("DeleteTagResponse");
assertInterfaceMatchesSchema("UserMetadataRecord");
assertInterfaceMatchesSchema("FileTagsResponse");
assertInterfaceMatchesSchema("AddFileTagRequest");
assertInterfaceMatchesSchema("SetFileTagsRequest");
assertInterfaceMatchesSchema("FileOperationRecord");
assertInterfaceMatchesSchema("FileOperationsResponse");
assertInterfaceMatchesSchema("FileOperationListResponse");
assertInterfaceMatchesSchema("RenameRequest");
assertInterfaceMatchesSchema("MoveRequest");
assertInterfaceMatchesSchema("DeleteRequest");

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
assertOperationParameters("getThumbnail", ["fileId", "profile"]);

for (const method of [
  "listRoots",
  "addRoot",
  "removeRoot",
  "enqueueScan",
  "listFolderChildren",
  "listMedia",
  "getMedia",
  "getThumbnail",
  "listTasks",
  "cancelTask",
  "retryTask",
  "listTags",
  "createTag",
  "deleteTag",
  "getUserMetadata",
  "updateUserMetadata",
  "setFileTags",
  "addFileTag",
  "removeFileTag",
  "searchMedia",
  "renameFileOp",
  "moveFileOps",
  "deleteFileOps",
  "listFileOperations"
]) {
  if (!client.includes(`${method}:`)) {
    fail(`client.ts missing operation ${method}`);
  }
}

const thumbnailBody = interfaceBody("ThumbnailResponse");
for (const line of [
  'profile: "grid_320";',
  'state: "pending" | "queued" | "ready" | "failed" | "skipped_small";',
  'shortSidePx: number;',
  'outputFormat: "image/webp";',
  "asset: ThumbnailAsset | null;",
  "error: string | null;"
]) {
  requireLine(thumbnailBody, line, "generated-contract.ts ThumbnailResponse");
}

const thumbnailAssetBody = interfaceBody("ThumbnailAsset");
for (const line of [
  "cacheKey: string;",
  "width: number;",
  "height: number;",
  "byteSize: number;"
]) {
  requireLine(thumbnailAssetBody, line, "generated-contract.ts ThumbnailAsset");
}

const taskBody = interfaceBody("TaskRecord");
for (const line of [
  "kind: TaskKind;",
  "status: TaskStatus;",
  "itemsSeen: number;",
  "itemsTotal: number | null;",
  "foldersSeen: number;",
  "mediaFilesSeen: number;",
  "skippedFiles: number;"
]) {
  requireLine(taskBody, line, "generated-contract.ts TaskRecord");
}

for (const line of [
  'export type TaskKind = "root_scan" | "thumbnail";',
  'export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";'
]) {
  if (!generated.includes(line)) {
    fail(`generated-contract.ts missing '${line}'`);
  }
}

for (const line of [
  'export type FileOperationKind =',
  '  | "rename"',
  '  | "move"',
  '  | "delete_recycle"',
  '  | "delete_permanent";',
  'export type FileOperationStatus = "succeeded" | "failed";'
]) {
  if (!generated.includes(line)) {
    fail(`generated-contract.ts missing '${line}'`);
  }
}

if (!/listTasks:\s*\(\)\s*=>\s*request<Page<TaskRecord>>\("\/tasks"\)/.test(client)) {
  fail("client.ts listTasks must request typed task pages");
}

if (!/cancelTask:\s*\(taskId:\s*number\)\s*=>\s*request<AcceptedRootResponse>\(`\/tasks\/\$\{taskId\}\/cancel`,\s*{\s*method:\s*"POST"\s*}\)/.test(client)) {
  fail("client.ts cancelTask must call POST /tasks/{taskId}/cancel");
}

if (!/retryTask:\s*\(taskId:\s*number\)\s*=>\s*request<AcceptedRootResponse>\(`\/tasks\/\$\{taskId\}\/retry`,\s*{\s*method:\s*"POST"\s*}\)/.test(client)) {
  fail("client.ts retryTask must call POST /tasks/{taskId}/retry");
}

if (!/listFolderChildren:\s*\(folderId:\s*number,\s*params:\s*ListFolderChildrenParams\s*=\s*{}\)\s*=>\s*request<Page<FolderRecord>>\(`\/folders\/\$\{folderId\}\/children\$\{query\(params\)\}`\)/.test(client)) {
  fail("client.ts listFolderChildren must accept typed limit/cursor params and serialize them");
}

if (!/listMedia:\s*\(params:\s*ListMediaParams\s*=\s*{}\)\s*=>\s*request<Page<MediaRecord>>\(`\/media\$\{query\(params\)\}`\)/.test(client)) {
  fail("client.ts listMedia must serialize typed query params");
}

if (!/getThumbnail:\s*\(fileId:\s*number,\s*profile:\s*"grid_320"\s*=\s*"grid_320"\)\s*=>\s*request<ThumbnailResponse>\(`\/media\/\$\{fileId\}\/thumbnail\$\{query\(\{\s*profile\s*}\)\}`\)/.test(client)) {
  fail("client.ts getThumbnail must request typed thumbnail state with default grid_320 profile");
}

if (!/removeRoot:\s*\(rootId:\s*number\)\s*=>\s*request<AcceptedRootResponse>\(`\/roots\/\$\{rootId\}`,\s*{\s*method:\s*"DELETE"\s*}\)/.test(client)) {
  fail("client.ts removeRoot must call DELETE /roots/{rootId}");
}

if (!/ScanTaskRequest/.test(client)) {
  fail("client.ts enqueueScan must use the typed ScanTaskRequest body");
}

if (!/enqueueScan:\s*\(rootId:\s*number\)\s*=>\s*request<AcceptedRootResponse>\("\/tasks\/scan",\s*{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\([\s\S]*rootId[\s\S]*\)\s*}\)/.test(client)) {
  fail("client.ts enqueueScan must call POST /tasks/scan with typed rootId body");
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
