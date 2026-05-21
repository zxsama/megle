import assert from "node:assert/strict";
import { inspectNativeBrowserWindowOptions } from "./native-browser-window-options.mjs";

const commentAndStringOnly = `
  const deadString = 'new BrowserWindow({ backgroundMaterial: "acrylic", transparent: true, backgroundColor: "#00000000", frame: false })';
  // new BrowserWindow({ backgroundMaterial: "acrylic", transparent: true, backgroundColor: "#00000000", frame: false })
  /*
    new BrowserWindow({ backgroundMaterial: "acrylic", transparent: true, backgroundColor: "#00000000", frame: false })
  */
  const win = new BrowserWindow({
    width: 1200,
    backgroundMaterial: "none",
    transparent: false,
    backgroundColor: "#11111111",
    frame: true,
    webPreferences: {
      preload: "backgroundMaterial: \\"acrylic\\""
    }
  });
`;

const rejected = inspectNativeBrowserWindowOptions(commentAndStringOnly);
assert.equal(rejected.backgroundMaterial, "none");
assert.equal(rejected.backgroundMaterialSource, 'backgroundMaterial: "none"');
assert.equal(rejected.frameFalse, false);
assert.equal(rejected.transparent, false);
assert.equal(rejected.transparentBackgroundColor, false);
assert.equal(rejected.disablesNativeMaterial, true);
assert.deepEqual(rejected.missingRequiredProperties, [
  'backgroundMaterial: "acrylic"',
  "transparent: true",
  'backgroundColor: "#00000000"',
  "frame: false"
]);

const valid = inspectNativeBrowserWindowOptions(`
  const win = new BrowserWindow({
    title: "literal with frame: true",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: "backgroundMaterial: \\"none\\""
    }
  });
`);

assert.equal(valid.backgroundMaterial, "acrylic");
assert.equal(valid.backgroundMaterialSource, 'backgroundMaterial: "acrylic"');
assert.equal(valid.frameFalse, true);
assert.equal(valid.transparent, true);
assert.equal(valid.transparentBackgroundColor, true);
assert.equal(valid.disablesNativeMaterial, false);
assert.deepEqual(valid.missingRequiredProperties, []);

const notFound = inspectNativeBrowserWindowOptions("const value = 1;");
assert.equal(notFound.browserWindowOptionsFound, false);
assert.deepEqual(notFound.missingRequiredProperties, [
  'backgroundMaterial: "acrylic"',
  "transparent: true",
  'backgroundColor: "#00000000"',
  "frame: false"
]);

const topLevelSpread = inspectNativeBrowserWindowOptions(`
  const win = new BrowserWindow({
    ...windowOptions,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: preloadPath
    }
  });
`);

assert.equal(topLevelSpread.browserWindowOptionsFound, true);
assert.equal(topLevelSpread.frameFalse, true);
assert.equal(topLevelSpread.transparent, true);
assert.equal(topLevelSpread.transparentBackgroundColor, true);
assert.equal(topLevelSpread.backgroundMaterial, "acrylic");
assert.deepEqual(topLevelSpread.unsafeTopLevelSpreads.map((spread) => spread.source), [
  "...windowOptions"
]);
assert.deepEqual(topLevelSpread.missingRequiredProperties, [
  "no top-level spread in BrowserWindow options"
]);

const multipleWindows = inspectNativeBrowserWindowOptions(`
  const main = new BrowserWindow({
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic"
  });
  const utility = new BrowserWindow({
    frame: true,
    transparent: false,
    backgroundColor: "#111111",
    backgroundMaterial: "none"
  });
`);

assert.equal(multipleWindows.browserWindowCount, 2);
assert.equal(multipleWindows.backgroundMaterial, "none");
assert.equal(multipleWindows.frameFalse, false);
assert.equal(multipleWindows.transparent, false);
assert.equal(multipleWindows.transparentBackgroundColor, false);
assert.equal(multipleWindows.disablesNativeMaterial, true);
assert.deepEqual(multipleWindows.missingRequiredProperties, [
  'backgroundMaterial: "acrylic"',
  "transparent: true",
  'backgroundColor: "#00000000"',
  "frame: false"
]);

const nestedSpread = inspectNativeBrowserWindowOptions(`
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    webPreferences: {
      ...webPreferences,
      preload: preloadPath
    }
  });
`);

assert.equal(nestedSpread.browserWindowOptionsFound, true);
assert.deepEqual(nestedSpread.unsafeTopLevelSpreads, []);
assert.deepEqual(nestedSpread.missingRequiredProperties, []);
