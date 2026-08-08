/**
 * @oakoliver/bubbletea — Elm Architecture TUI framework for TypeScript
 *
 * Zero-dependency port of Charmbracelet's Bubbletea (Go).
 * Build rich terminal user interfaces with the Elm Architecture pattern.
 *
 * @module
 */

export * from './types.js';
export * from './commands.js';
export * as ansi from './ansi.js';
export { InputDecoder, parseInput } from './input.js';
export * from './renderer.js';
export * from './program.js';
