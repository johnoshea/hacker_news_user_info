#!/usr/bin/env node
// Build the ViolentMonkey userscript by concatenating src/ modules.
//
// Strips ES module `import` and `export` syntax (we only use the simple
// declaration forms - `import { x } from "./y.js";` and `export function`,
// `export const`). The resulting body is wrapped in an IIFE and prefixed
// with the userscript metadata block.
//
// Mirrors the build approach used by ../url_destination_checker so the two
// repos stay structurally consistent.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Order matters: dependencies first.
const SOURCES = [
	"src/config.js",
	"src/parsing.js",
	"src/state.js",
	"src/dom.js",
	"src/styles.js",
	"src/api.js",
	"src/features/legibility.js",
	"src/features/comment-box-toggle.js",
	"src/features/user-render.js",
	"src/features/tag-manager.js",
	"src/features/toolbar.js",
	"src/main.js",
];

const HEADER = `// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.5
// @description  Inline account info, custom tags and ratings on comment pages, plus site-wide legibility tweaks (quote rendering, downvote contrast, font/layout cleanup, optional comment-box toggle)
// @author       You
// @match        https://news.ycombinator.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ycombinator.com
// ==/UserScript==
`;

function stripModuleSyntax(src) {
	// Remove import statements (single-line or multi-line up to the closing
	// semicolon on its own line). Non-greedy so it stops at the first ; not
	// the file's last one.
	let out = src.replace(/^import\b[\s\S]*?;\s*$/gm, "");
	// Strip leading `export ` from declarations.
	out = out.replace(
		/^\s*export\s+(const|let|var|function|class|async\s+function)/gm,
		"$1",
	);
	return out;
}

function buildBody() {
	const parts = [];
	for (const rel of SOURCES) {
		const src = readFileSync(join(repoRoot, rel), "utf8");
		parts.push(`// ===== ${rel} =====`);
		parts.push(stripModuleSyntax(src));
	}
	return parts.join("\n\n");
}

const body = buildBody();
const out = `${HEADER}\n(function () {\n"use strict";\n\n${body}\n\n})();\n`;

const outPath = join(repoRoot, "script.js");
writeFileSync(outPath, out, "utf8");
console.log(`built ${outPath} (${out.length} bytes)`);
