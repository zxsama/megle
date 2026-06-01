import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "tools", "dev", "artists-million-desktop-sweep.mjs");
const script = readFileSync(scriptPath, "utf8");

function fail(message) {
  console.error(`[validate-artists-sweep] ${message}`);
  process.exit(1);
}

for (const label of [
  "adaptive cross-tree folder switch",
  "waterfall cross-tree folder switch",
  "grid cross-tree folder switch",
  "list cross-tree folder switch",
  "adaptive deep scroll",
  "waterfall deep scroll",
  "grid deep scroll",
  "list deep scroll",
  "artists root recursive total deep scroll",
  "tree directory deep scroll and switch",
  "tree directory scrollbar drag",
  "subfolder hierarchy expand",
  "preview open clicked media",
  "preview close",
  "sort Name A-Z",
  "sort Name Z-A",
  "sort Newest first"
]) {
  if (!script.includes(label)) {
    fail(`missing required real-desktop operation family: ${label}`);
  }
}

if (!/async function setSort\(client,\s*label\)/.test(script)) {
  fail("sweep must exercise the real sort popover through a setSort helper");
}

if (!/selectedFolderKeys/.test(script) || !/selectedFolderLabels/.test(script) || !/layoutClasses/.test(script)) {
  fail("summary must report distinct folder and layout coverage");
}

if (!/clickedMediaLabels/.test(script) || !/clickedFolderLabels/.test(script) || !/maxSelectedDepth/.test(script)) {
  fail("summary must report clicked media/folder coverage and deepest selected tree depth");
}

if (!/validateCoverage\(coverage\)/.test(script) || !/coverageFailures/.test(script)) {
  fail("sweep must fail visibly when broad operation coverage is not achieved");
}

if (!/options\.requireAction\s*&&\s*\(\s*actionResult\?\.ok\s*===\s*false\s*\|\|\s*actionResult\?\.skipped\s*===\s*true\s*\)/.test(script)) {
  fail("requireAction operations must treat skipped actions as failures");
}

if (!/async function ensureArtistsRootSubfolderContext\(client\)/.test(script)) {
  fail("sweep must have a shared Artists root subfolder precondition helper");
}

if (
  !/async function ensureArtistsRootSubfolderContext\(client\)[\s\S]*?ensureLibrary\(client\)[\s\S]*?scrollGridToRatio\(client,\s*0\)[\s\S]*?rootLabel\.click\(\)[\s\S]*?document\.querySelector\("\.subfolder-strip"\)[\s\S]*?selected\s*&&\s*Boolean\(strip\)/.test(
    script
  )
) {
  fail("Artists root subfolder precondition must close preview, retry root selection, scroll to top, and verify the subfolder strip");
}

if (
  !/ensureArtistsRootSubfolderContext\(client\)[\s\S]*?setRecursiveChildContents\(client,\s*true\)[\s\S]*?artists root recursive total deep scroll/.test(
    script
  )
) {
  fail("Artists root recursive deep-scroll operations must wait for root subfolder cards before toggling recursive contents");
}

if (
  !/`subfolder hierarchy expand \$\{i\}`[\s\S]*?ensureArtistsRootSubfolderContext\(client\)[\s\S]*?\},\s*\{\s*requireAction:\s*true/.test(
    script
  )
) {
  fail("subfolder hierarchy expand must be a required action after the Artists root subfolder context is ready");
}

if (
  /subfolder hierarchy expand[\s\S]*?skipped:\s*true/.test(script) ||
  /expandSubfolderHierarchy[\s\S]*?ok:\s*true,\s*\n\s*skipped:\s*true/.test(script)
) {
  fail("subfolder hierarchy expand must fail instead of reporting skipped success");
}

if (!/slice\(0,\s*FETCH_REPORT_LIMIT\)/.test(script)) {
  fail("summary fetch problem lists must be bounded so 500-op reports remain inspectable");
}

if (!/last\.total\s*>\s*0\s*&&\s*last\.ready\s*>=\s*last\.total/.test(script)) {
  fail("visible-ready waits must not treat an empty media viewport as complete while media page requests are still pending");
}

if (!/tile-thumb-ready,\s*\.tile-thumb-image,\s*\.tile-thumb-failed,\s*img/.test(script)) {
  fail("visible-ready waits must treat explicit failed thumbnail tiles as resolved bad samples, not pending loading");
}

if (
  !/data-cover-status="ready"/.test(script) ||
  !/readyFolderCovers/.test(script) ||
  !/loadingFolderCovers/.test(script)
) {
  fail("visible-ready waits must include visible subfolder cover readiness, not only media tile thumbnails");
}

const clickVisibleTileMatch = script.match(
  /async function clickVisibleTile\(client,\s*offset[\s\S]*?\n\}\n\nasync function openVisibleTilePreview/
);
const clickVisibleTileSource = clickVisibleTileMatch?.[0] ?? "";
if (
  !/timeoutMs/.test(clickVisibleTileSource) ||
  !/while\s*\(Date\.now\(\)\s*-\s*startedAt\s*<\s*timeoutMs\)/.test(clickVisibleTileSource) ||
  !/await delay/.test(clickVisibleTileSource)
) {
  fail("clickVisibleTile must retry briefly because virtualized media can rerender between visible-ready and click");
}

const selectArtistsRootMatch = script.match(
  /async function selectArtistsRoot\(client\) \{[\s\S]*?\n\}/
);
const selectArtistsRootSource = selectArtistsRootMatch?.[0] ?? "";
if (
  !selectArtistsRootSource.includes("data-root-id") ||
  !selectArtistsRootSource.includes("data-folder-id") ||
  !selectArtistsRootSource.includes("lastSelection") ||
  !selectArtistsRootSource.includes("rootSelection")
) {
  fail(
    "selectArtistsRoot must retry and verify the selected top-level root by data-root-id/data-folder-id, not by label text alone"
  );
}

console.log("[validate-artists-sweep] ok");
