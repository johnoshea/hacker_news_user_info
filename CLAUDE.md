# Hacker News User Info - Development Guide

## Commands

- **Run Script**: Load the script in Tampermonkey, Violentmonkey, or another userscript manager
- **Lint**: `biome lint --write script.js`
- **Format**: `biome format --write script.js`

## Code Style Guidelines

- **Formatting**: 2-space indentation, semicolons required
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Functions**: Use arrow functions for callbacks, named functions for primary methods
- **Error Handling**: Try/catch blocks with specific error messages, error logging to console
- **Architecture**: Modular design with separate concerns (API, UI, Storage, Utils)
- **Promises**: Prefer async/await syntax, proper error handling with .catch()
- **DOM Manipulation**: Minimize reflows by using DocumentFragment
- **Comments**: JSDoc-style comments for functions, inline for complex logic
- **Dependencies**: Userscript runs in browser context with GM_* APIs from userscript manager

## Project Information

The script adds account information (age, karma), custom tags, and user ratings to Hacker News comment threads.

