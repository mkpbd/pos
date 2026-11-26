---
name: ponytail-gain
description: Display Ponytail's published benchmark results as a compact scoreboard showing reductions in code, output tokens, cost and execution time. One-shot informational skill. Does not analyze the current repository, modify files, or change Ponytail mode.
---

# Ponytail Gain – Efficiency Scoreboard

When invoked, display the published Ponytail benchmark results as a compact, readable ASCII scoreboard.

This is a one-shot informational skill.

Do not:
- Modify source code.
- Modify configuration.
- Change Ponytail mode.
- Create or update files.
- Run a project audit.
- Claim that benchmark savings were achieved in the current repository.
- Invent token or cost savings for the user's project.

## 1. Benchmark Information

Use the published Ponytail 5 benchmark:

- Model: Claude Code Opus 5.5
- Effort: Default
- Tasks: 39
- Runs: 5 per task
- Benchmark type: Real-world coding, bug fixing, security, privacy and feature tasks.
- Comparison: Same agent with Ponytail versus without Ponytail.

Source:
https://github.com/DietrichGebert/ponytail

## 2. Display Scoreboard

Render this compact ASCII scoreboard:

```text
PONYTAIL GAIN
Benchmark: 39 tasks × 5 runs · Opus 5.5

                    No Skill     Ponytail
Lines of Code         100%          47%
Output Tokens         100%          55%
Cost                  100%          74%
Execution Time        100%          59%

Measured Reduction:
Lines of Code         53%
Output Tokens         45%
Cost                  26%
Execution Time        41%

Hidden Checks Passed:
Ponytail              97%
No Skill              96%

Tests where logic needs one:
Ponytail              98%
No Skill              68%
```

## 3. Honesty Rules

These figures represent published benchmark measurements.

They are NOT measurements of the user's current project.

Never claim:
- The current project saved 45% tokens.
- The user's last migration saved 53% code.
- The user's Claude Pro usage decreased by 26%.
- Any specific repository achieved the benchmark results.

Never calculate fictional savings against an implementation that was never created.

For actual project-specific simplification opportunities, direct the user to:

- `/ponytail-debt` – Technical debt and simplification analysis.
- `/ponytail-audit` – Code and complexity audit.

## 4. Display Format

Keep the output short.

Use:
- ASCII comparison bars.
- Exact benchmark percentages.
- Clear benchmark attribution.
- A short explanation of the measurement limitations.

## 5. Execution Boundaries

- Display the scoreboard once.
- Do not activate or deactivate Ponytail.
- Do not persist any mode.
- Do not edit any files.
- Do not run unnecessary tools.
- Do not scan the repository.

Final principle:

Show measured results honestly. Never confuse benchmark performance with actual project savings.