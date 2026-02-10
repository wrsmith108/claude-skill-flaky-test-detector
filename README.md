# Flaky Test Detector

A Claude Code skill for detecting flaky test patterns that cause intermittent CI failures.

## Installation

### As a Claude Code Skill

```bash
# Clone to your Claude skills directory
git clone https://github.com/wrsmith108/claude-skill-flaky-test-detector.git ~/.claude/skills/flaky-test-detector
```

### Standalone Usage

```bash
# Run directly with npx
npx tsx scripts/index.ts [directory] [options]
```

## Trigger Phrases

This skill activates when you mention:
- "flaky test"
- "intermittent failure"
- "test sometimes fails"
- "race condition in test"
- "timing issue in test"
- "test passes locally but fails in CI"
- "non-deterministic test"

## Pattern Detection

Scans `*.test.ts` and `*.spec.ts` files to detect:

| Severity | Pattern | Risk |
|----------|---------|------|
| HIGH | 1-second TTL | Second-boundary race conditions |
| HIGH | `Math.floor(Date.now() / 1000)` | Second truncation timing edge cases |
| HIGH | Very short setTimeout (<100ms) | Unreliable timeouts |
| MEDIUM | `Date.now()` without mocking | Real time causes non-determinism |
| MEDIUM | `new Date()` without mocking | Real date causes flakiness |
| MEDIUM | Low timeout values | Race conditions in CI |
| LOW | `Math.random()` without seeding | Non-reproducible behavior |
| LOW | `process.nextTick` in assertions | Timing-dependent assertions |

## Usage

### Scan Current Directory

```bash
# Run the detector on all test files
npx tsx scripts/index.ts

# Scan specific directory
npx tsx scripts/index.ts ./src/tests

# Output as JSON
npx tsx scripts/index.ts --json

# CI mode: exit with code 1 if HIGH severity issues found
npx tsx scripts/index.ts --ci
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | Output results as JSON |
| `--ci` | CI mode: exit with code 1 if HIGH severity issues found |
| `--quiet` | Suppress output except errors |
| `--help` | Show help message |

## Output Example

```markdown
## Flaky Test Analysis

Scanned 94 test files, found 15 potential flaky patterns.

### High Risk
**cache.test.ts:119**
- Pattern: `ttlSeconds: 1`
- Risk: Second boundary crossing causes race condition
- Fix: Use vi.useFakeTimers() or increase TTL to 5+

### Medium Risk
**utils.spec.ts:45**
- Pattern: `Date.now()`
- Risk: Real time creates non-determinism
- Fix: Mock with vi.useFakeTimers() and vi.setSystemTime()
```

## CI Integration

Add to your CI pipeline to catch flaky patterns before merge:

```yaml
- name: Check for flaky test patterns
  run: npx tsx scripts/index.ts --ci
```

## Fix Suggestions

The skill provides actionable fix suggestions:
- `vi.useFakeTimers()` for time-based flakiness
- TTL increase recommendations
- Mock injection patterns
- Deterministic alternatives

## Requirements

- Node.js 18+
- TypeScript (tsx for execution)

## Changelog

### 1.0.1 (2026-02-10)

- **Fixed**: Replaced hardcoded `~/.claude/skills/` paths with relative paths for portability across different install locations

## License

MIT

## Related Skills

- [ci-doctor](https://github.com/wrsmith108/claude-skill-ci-doctor) - Diagnose CI/CD pipeline issues
- [version-sync](https://github.com/wrsmith108/claude-skill-version-sync) - Sync Node.js versions
- [docker-optimizer](https://github.com/wrsmith108/claude-skill-docker-optimizer) - Optimize Dockerfiles
- [security-auditor](https://github.com/wrsmith108/claude-skill-security-auditor) - Security audits

## References

- [Vitest Fake Timers](https://vitest.dev/guide/mocking.html#timers)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
