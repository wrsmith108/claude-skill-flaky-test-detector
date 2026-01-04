#!/usr/bin/env npx tsx

/**
 * Flaky Test Detector - Main Entry Point
 *
 * Usage:
 *   npx tsx ~/.claude/skills/flaky-test-detector/scripts/index.ts [dir] [options]
 *
 * Options:
 *   --json     Output as JSON instead of markdown
 *   --ci       CI mode: exit with code 1 if high-severity issues found
 *   --help     Show help
 */

import * as path from "path";
import {
  scanDirectory,
  formatAsMarkdown,
  formatAsJson,
  type ScanResult,
} from "./detect-flaky.js";

function printHelp(): void {
  console.log(`
Flaky Test Detector - Find patterns that cause intermittent test failures

Usage:
  npx tsx index.ts [directory] [options]

Arguments:
  directory    Directory to scan (default: current directory)

Options:
  --json       Output results as JSON
  --ci         CI mode: exit with code 1 if HIGH severity issues found
  --quiet      Suppress output except errors (for CI)
  --help       Show this help message

Examples:
  # Scan current directory
  npx tsx index.ts

  # Scan specific directory
  npx tsx index.ts ./src/tests

  # CI pipeline usage
  npx tsx index.ts --ci

  # JSON output for tooling
  npx tsx index.ts --json > flaky-report.json
`);
}

function main(): void {
  const args = process.argv.slice(2);

  // Parse flags
  const jsonOutput = args.includes("--json");
  const ciMode = args.includes("--ci");
  const quiet = args.includes("--quiet");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    printHelp();
    process.exit(0);
  }

  // Get directory (first non-flag argument)
  const dirArg = args.find((arg) => !arg.startsWith("--"));
  const targetDir = dirArg ? path.resolve(dirArg) : process.cwd();

  if (!quiet) {
    console.error(`Scanning for flaky test patterns in: ${targetDir}\n`);
  }

  // Run scan
  const result: ScanResult = scanDirectory(targetDir);

  // Output results
  if (jsonOutput) {
    console.log(formatAsJson(result));
  } else if (!quiet) {
    console.log(formatAsMarkdown(result));
  }

  // CI mode: exit with error if high-severity issues
  if (ciMode && result.bySeverity.high.length > 0) {
    if (!quiet) {
      console.error(
        `\nCI Check Failed: ${result.bySeverity.high.length} high-severity flaky patterns found.`
      );
    }
    process.exit(1);
  }

  // Report summary to stderr (doesn't interfere with JSON output)
  if (!quiet) {
    console.error(`\nScan complete: ${result.scannedFiles} files, ${result.totalDetections} patterns found.`);
  }
}

main();
