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

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Embed the current commit's short hash in @version so a glance at the
// userscript metadata in Tampermonkey/Violentmonkey is enough to tell
// which commit is loaded. Base version is bumped manually for releases;
// the hash is the per-commit fingerprint. Falls back to "unknown" if git
// isn't available (shouldn't happen during normal use, but the build
// shouldn't crash on it). execFileSync (not execSync) so no shell is
// involved — args are hardcoded, but the no-shell habit is cheap.
function gitShortHash() {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch (_e) {
		return "unknown";
	}
}

const BASE_VERSION = "0.10";
const VERSION = `${BASE_VERSION}+${gitShortHash()}`;

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
	"src/features/click-indent-toggle.js",
	"src/features/collapse-root-comment.js",
	"src/features/backticks-to-monospace.js",
	"src/features/toggle-all-comments.js",
	"src/features/highlight-unread-comments.js",
	"src/features/hover-popup.js",
	"src/features/user-info-hover.js",
	"src/features/item-info-hover.js",
	"src/features/linkify-user-about.js",
	"src/features/sort-stories.js",
	"src/features/reply-inline.js",
	"src/features/user-render.js",
	"src/features/tag-manager.js",
	"src/features/toolbar.js",
	"src/main.js",
];

const HEADER = `// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      ${VERSION}
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

// Surface duplicate top-level `function name(...)` declarations across
// modules. Each src/ file is its own ES module so collisions go unnoticed
// in tests, but the build concatenates everything into one IIFE — same-name
// function declarations silently override each other in that scope, and
// the symptom (caller invokes a function with a wrong signature, gets
// surprise behaviour) is hard to debug. A name-clash here happened once;
// the next-best place to catch it is at build time.
function checkForDuplicateTopLevelFunctions(modules) {
	// Match `function foo(` at the start of a line so we only see top-level
	// declarations, not nested ones inside a closure body. Stripping the
	// `export ` prefix has already happened by the time we look.
	const declRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
	const seen = new Map(); // name -> [ relPath, ... ]
	for (const { path, body } of modules) {
		for (const m of body.matchAll(declRe)) {
			const name = m[1];
			if (!seen.has(name)) seen.set(name, []);
			seen.get(name).push(path);
		}
	}
	const collisions = [...seen.entries()].filter(
		([, paths]) => paths.length > 1,
	);
	if (collisions.length === 0) return;
	const lines = collisions.map(
		([name, paths]) => `  ${name}: ${paths.join(", ")}`,
	);
	throw new Error(
		`build: duplicate top-level function declarations across modules ` +
			`(later definitions silently override earlier ones in the bundled IIFE):\n${lines.join("\n")}`,
	);
}

function buildBody() {
	const modules = SOURCES.map((rel) => ({
		path: rel,
		body: stripModuleSyntax(readFileSync(join(repoRoot, rel), "utf8")),
	}));
	checkForDuplicateTopLevelFunctions(modules);
	const parts = [];
	for (const { path, body } of modules) {
		parts.push(`// ===== ${path} =====`);
		parts.push(body);
	}
	return parts.join("\n\n");
}

const body = buildBody();
const out = `${HEADER}\n(function () {\n"use strict";\n\n${body}\n\n})();\n`;

const outPath = join(repoRoot, "script.js");
writeFileSync(outPath, out, "utf8");
console.log(`built ${outPath} (${out.length} bytes)`);
