import * as fs from "fs";
import * as path from "path";

/**
 * Flaky Test Pattern Detector
 * Scans test files for patterns known to cause intermittent failures
 */

export type Severity = "high" | "medium" | "low";

export interface FlakyPattern {
  name: string;
  regex: RegExp;
  severity: Severity;
  risk: string;
  fix: string;
}

export interface Detection {
  file: string;
  line: number;
  pattern: string;
  matchedText: string;
  severity: Severity;
  risk: string;
  fix: string;
  context: string[];
}

export interface ScanResult {
  scannedFiles: number;
  totalDetections: number;
  detections: Detection[];
  byFile: Map<string, Detection[]>;
  bySeverity: {
    high: Detection[];
    medium: Detection[];
    low: Detection[];
  };
}

// Patterns that cause flaky tests
const FLAKY_PATTERNS: FlakyPattern[] = [
  // HIGH severity - almost always causes flakiness
  {
    name: "1-second TTL",
    regex: /ttl[Ss]?econds?\s*[=:]\s*1\b/g,
    severity: "high",
    risk: "1-second TTL causes second-boundary race conditions. Tests may pass or fail depending on when they cross the second boundary.",
    fix: "Use vi.useFakeTimers() to control time, or increase TTL to 5+ seconds for real-time tests.",
  },
  {
    name: "Second truncation",
    regex: /Math\.floor\s*\(\s*Date\.now\s*\(\s*\)\s*\/\s*1000\s*\)/g,
    severity: "high",
    risk: "Second truncation creates edge cases at second boundaries. A test starting at X.999s may see different values than expected.",
    fix: "Mock Date.now() with vi.useFakeTimers() and vi.setSystemTime() for deterministic timestamps.",
  },
  {
    name: "Very short setTimeout",
    regex: /setTimeout\s*\([^,]+,\s*(\d{1,2})\s*\)/g,
    severity: "high",
    risk: "Timeouts under 100ms are unreliable across different machines and CI environments.",
    fix: "Use vi.useFakeTimers() and vi.advanceTimersByTime() instead of real timeouts.",
  },
  {
    name: "Short delay/sleep",
    regex: /(?:delay|sleep|wait)\s*\(\s*(\d{1,2})\s*\)/g,
    severity: "high",
    risk: "Very short delays are unreliable and cause race conditions.",
    fix: "Use vi.useFakeTimers() or await specific conditions instead of arbitrary delays.",
  },

  // MEDIUM severity - likely to cause issues
  {
    name: "Unmocked Date.now()",
    regex: /Date\.now\s*\(\s*\)/g,
    severity: "medium",
    risk: "Real time in tests causes non-determinism. Tests may fail near second/minute boundaries.",
    fix: "Mock with vi.useFakeTimers() and vi.setSystemTime(new Date('2024-01-01T12:00:00Z')).",
  },
  {
    name: "Unmocked new Date()",
    regex: /new\s+Date\s*\(\s*\)/g,
    severity: "medium",
    risk: "Real date creates non-deterministic behavior. Timezone and time-of-day can affect results.",
    fix: "Mock with vi.useFakeTimers() or pass explicit date values to constructors.",
  },
  {
    name: "Low timeout value",
    regex: /timeout\s*[=:]\s*([1-9]0?)\b/g,
    severity: "medium",
    risk: "Low timeout values (under 100ms) cause race conditions in CI environments with variable load.",
    fix: "Increase timeout to 1000+ ms or use vi.useFakeTimers() for timeout-dependent logic.",
  },
  {
    name: "setInterval without cleanup",
    regex: /setInterval\s*\([^-]+\)/g,
    severity: "medium",
    risk: "Intervals without cleanup can leak between tests and cause interference.",
    fix: "Store interval ID and call clearInterval in afterEach/cleanup, or use vi.useFakeTimers().",
  },
  {
    name: "Promise.race without timeout",
    regex: /Promise\.race\s*\(\s*\[[^\]]*\]\s*\)/g,
    severity: "medium",
    risk: "Promise.race can hang indefinitely if no timeout promise is included.",
    fix: "Always include a timeout promise: Promise.race([operation(), timeout(5000)]).",
  },

  // LOW severity - potential issues
  {
    name: "Unseeded Math.random()",
    regex: /Math\.random\s*\(\s*\)/g,
    severity: "low",
    risk: "Random values without seeding cause non-reproducible test behavior.",
    fix: "Use a seeded random generator or mock Math.random with vi.spyOn(Math, 'random').",
  },
  {
    name: "process.nextTick in tests",
    regex: /process\.nextTick\s*\(/g,
    severity: "low",
    risk: "Timing-dependent assertions using nextTick can be order-dependent.",
    fix: "Use await flushPromises() or explicit async/await patterns.",
  },
  {
    name: "Hardcoded port numbers",
    regex: /(?:port|PORT)\s*[=:]\s*(\d{4,5})\b/g,
    severity: "low",
    risk: "Hardcoded ports can conflict when tests run in parallel.",
    fix: "Use port 0 for random available port, or use getPort() utility.",
  },
  {
    name: "File system temp paths",
    regex: /['`"]\/tmp\/[^'`"]+['`"]/g,
    severity: "low",
    risk: "Shared temp paths can conflict between parallel test runs.",
    fix: "Use os.tmpdir() with unique subdirectories, or use tmp-promise package.",
  },
];

/**
 * Find all test files in a directory recursively
 */
export function findTestFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip common non-test directories
    if (entry.isDirectory()) {
      if (
        ["node_modules", "dist", "build", ".git", "coverage"].includes(
          entry.name
        )
      ) {
        continue;
      }
      findTestFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".spec.ts") ||
        entry.name.endsWith(".test.tsx") ||
        entry.name.endsWith(".spec.tsx") ||
        entry.name.endsWith(".test.js") ||
        entry.name.endsWith(".spec.js"))
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract context lines around a match
 */
function extractContext(
  lines: string[],
  lineIndex: number,
  contextSize: number = 3
): string[] {
  const start = Math.max(0, lineIndex - contextSize);
  const end = Math.min(lines.length, lineIndex + contextSize + 1);

  return lines.slice(start, end).map((line, idx) => {
    const actualLineNum = start + idx + 1;
    const marker = actualLineNum === lineIndex + 1 ? ">" : " ";
    return marker + " " + actualLineNum.toString().padStart(4) + ": " + line;
  });
}

/**
 * Check if a line is likely mocked (has vi.useFakeTimers or jest.useFakeTimers nearby)
 */
function isLikelyMocked(content: string, matchIndex: number): boolean {
  // Look for fake timer setup within 50 lines before the match
  const beforeContent = content.substring(
    Math.max(0, matchIndex - 2000),
    matchIndex
  );

  const mockPatterns = [
    /vi\.useFakeTimers/,
    /jest\.useFakeTimers/,
    /vi\.setSystemTime/,
    /jest\.setSystemTime/,
    /vi\.spyOn\s*\(\s*Date/,
    /jest\.spyOn\s*\(\s*Date/,
    /mockDate/i,
    /MockDate/,
  ];

  return mockPatterns.some((pattern) => pattern.test(beforeContent));
}

/**
 * Scan a single file for flaky patterns
 */
export function scanFile(filePath: string): Detection[] {
  const detections: Detection[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const pattern of FLAKY_PATTERNS) {
      // Reset regex lastIndex
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(content)) !== null) {
        // Skip if likely mocked
        if (
          pattern.severity !== "high" &&
          isLikelyMocked(content, match.index)
        ) {
          continue;
        }

        // Calculate line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split("\n").length;
        const lineIndex = lineNumber - 1;

        // Extract context
        const context = extractContext(lines, lineIndex);

        detections.push({
          file: filePath,
          line: lineNumber,
          pattern: pattern.name,
          matchedText: match[0],
          severity: pattern.severity,
          risk: pattern.risk,
          fix: pattern.fix,
          context,
        });
      }
    }
  } catch (error) {
    console.error("Error scanning " + filePath + ":", error);
  }

  return detections;
}

/**
 * Scan directory for flaky test patterns
 */
export function scanDirectory(dir: string): ScanResult {
  const testFiles = findTestFiles(dir);
  const allDetections: Detection[] = [];
  const byFile = new Map<string, Detection[]>();

  for (const file of testFiles) {
    const fileDetections = scanFile(file);
    if (fileDetections.length > 0) {
      allDetections.push(...fileDetections);
      byFile.set(file, fileDetections);
    }
  }

  // Sort by severity
  const bySeverity = {
    high: allDetections.filter((d) => d.severity === "high"),
    medium: allDetections.filter((d) => d.severity === "medium"),
    low: allDetections.filter((d) => d.severity === "low"),
  };

  return {
    scannedFiles: testFiles.length,
    totalDetections: allDetections.length,
    detections: allDetections,
    byFile,
    bySeverity,
  };
}

/**
 * Format results as markdown
 */
export function formatAsMarkdown(result: ScanResult): string {
  const lines: string[] = [];

  lines.push("## Flaky Test Analysis\n");
  lines.push(
    "Scanned **" + result.scannedFiles + "** test files, found **" + result.totalDetections + "** potential flaky patterns.\n"
  );

  if (result.totalDetections === 0) {
    lines.push("No flaky patterns detected. Your tests look deterministic!\n");
    return lines.join("\n");
  }

  // Summary
  lines.push("### Summary\n");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  lines.push("| High | " + result.bySeverity.high.length + " |");
  lines.push("| Medium | " + result.bySeverity.medium.length + " |");
  lines.push("| Low | " + result.bySeverity.low.length + " |");
  lines.push("");

  // High severity
  if (result.bySeverity.high.length > 0) {
    lines.push("### High Risk\n");
    for (const detection of result.bySeverity.high) {
      lines.push("**" + path.basename(detection.file) + ":" + detection.line + "**");
      lines.push("- Pattern: `" + detection.matchedText + "`");
      lines.push("- Risk: " + detection.risk);
      lines.push("- Fix: " + detection.fix);
      lines.push("\n```typescript");
      lines.push(detection.context.join("\n"));
      lines.push("```\n");
    }
  }

  // Medium severity
  if (result.bySeverity.medium.length > 0) {
    lines.push("### Medium Risk\n");
    for (const detection of result.bySeverity.medium) {
      lines.push("**" + path.basename(detection.file) + ":" + detection.line + "**");
      lines.push("- Pattern: `" + detection.matchedText + "`");
      lines.push("- Risk: " + detection.risk);
      lines.push("- Fix: " + detection.fix + "\n");
    }
  }

  // Low severity (collapsed)
  if (result.bySeverity.low.length > 0) {
    lines.push("### Low Risk\n");
    lines.push(
      "<details><summary>Show " +
        result.bySeverity.low.length +
        " low-risk patterns</summary>\n"
    );
    for (const detection of result.bySeverity.low) {
      lines.push("- **" + path.basename(detection.file) + ":" + detection.line + "**: `" + detection.matchedText + "`");
    }
    lines.push("\n</details>\n");
  }

  // Recommendations
  lines.push("### Recommended Actions\n");
  if (result.bySeverity.high.length > 0) {
    lines.push(
      "1. **Immediate**: Fix all HIGH severity issues before merging"
    );
    lines.push("2. Add `vi.useFakeTimers()` in `beforeEach` for time-dependent tests");
    lines.push("3. Use `vi.setSystemTime()` for deterministic date/time");
  }
  if (result.bySeverity.medium.length > 0) {
    lines.push("4. Review MEDIUM severity patterns for potential issues");
  }
  lines.push(
    "5. Consider adding this check to CI to prevent new flaky patterns\n"
  );

  return lines.join("\n");
}

/**
 * Format results as JSON
 */
export function formatAsJson(result: ScanResult): string {
  return JSON.stringify(
    {
      scannedFiles: result.scannedFiles,
      totalDetections: result.totalDetections,
      summary: {
        high: result.bySeverity.high.length,
        medium: result.bySeverity.medium.length,
        low: result.bySeverity.low.length,
      },
      detections: result.detections.map((d) => ({
        file: d.file,
        line: d.line,
        pattern: d.pattern,
        matchedText: d.matchedText,
        severity: d.severity,
        risk: d.risk,
        fix: d.fix,
      })),
    },
    null,
    2
  );
}
