const fs = require("fs");
const path = require("path");

function collectModeDescriptors() {
  const modesDir = __dirname;
  const files = fs
    .readdirSync(modesDir)
    .filter((name) => name.endsWith(".js") && name !== "index.js")
    .sort((a, b) => a.localeCompare(b));

  const descriptors = [];

  for (const fileName of files) {
    const moduleExports = require(path.join(modesDir, fileName));
    if (!moduleExports || typeof moduleExports !== "object") {
      continue;
    }

    for (const [exportName, value] of Object.entries(moduleExports)) {
      if (!exportName.endsWith("_MODE_DESCRIPTOR")) {
        continue;
      }
      if (!value || typeof value !== "object") {
        continue;
      }
      descriptors.push(value);
    }
  }

  // Keep mode registration deterministic. Optional per-descriptor `priority`
  // allows future behavior ordering without central wiring edits.
  descriptors.sort((a, b) => {
    const priorityA = Number.isFinite(a?.priority) ? a.priority : 0;
    const priorityB = Number.isFinite(b?.priority) ? b.priority : 0;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    const keyA = typeof a?.key === "string" ? a.key : "";
    const keyB = typeof b?.key === "string" ? b.key : "";
    return keyA.localeCompare(keyB);
  });

  return Object.freeze(descriptors);
}

const MODE_DESCRIPTORS = collectModeDescriptors();

module.exports = {
  MODE_DESCRIPTORS,
};
