#!/usr/bin/env node
// One-off cleanup for exported state JSON files. Drops every entry from
// `customTags` whose name is not carried by any user in the export. The
// input file is never mutated; a cleaned copy is written to a sibling
// path.
//
// Usage:
//   node scripts/clean-orphan-tags.js <input.json> [<output.json>]
//
// Flow: Save state via the userscript toolbar -> run this script against
// the downloaded JSON -> Restore state from the cleaned file.

const fs = require("node:fs");
const path = require("node:path");
const { parseImport, stateToExport } = require("../script.js");

function cleanOrphans(exported) {
	const state = parseImport(exported);
	const usedTags = new Set();
	for (const tags of Object.values(state.tags)) {
		for (const t of tags) usedTags.add(t);
	}
	const cleanedColors = {};
	const removed = [];
	for (const [name, info] of Object.entries(state.colors)) {
		if (usedTags.has(name)) {
			cleanedColors[name] = info;
		} else {
			removed.push(name);
		}
	}
	state.colors = cleanedColors;
	return { cleaned: stateToExport(state), removed };
}

function defaultOutputPath(inputPath) {
	const ext = path.extname(inputPath);
	const dir = path.dirname(inputPath);
	const base = path.basename(inputPath, ext);
	return path.join(dir, `${base}.cleaned${ext || ".json"}`);
}

function runCli(argv) {
	const [inputPath, outputPath] = argv;
	if (!inputPath) {
		console.error(
			"Usage: node scripts/clean-orphan-tags.js <input.json> [<output.json>]",
		);
		process.exit(1);
	}
	const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
	const { cleaned, removed } = cleanOrphans(raw);
	const outPath = outputPath || defaultOutputPath(inputPath);
	fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2));

	console.log(`Removed ${removed.length} orphan tag(s):`);
	for (const name of removed.sort()) console.log(`  - ${name}`);
	console.log(`\nWrote cleaned export to ${outPath}`);
}

if (require.main === module) runCli(process.argv.slice(2));

module.exports = { cleanOrphans, defaultOutputPath };
