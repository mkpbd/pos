---
name: ponytail-help
description: Quick reference for Ponytail levels, skills, commands, configuration, and usage. Use when the user invokes /ponytail-help or asks how to use Ponytail.
---

# Ponytail Help

Display this reference card when invoked.

This is a one-shot informational skill.

Do not:
- Change the active Ponytail mode.
- Modify configuration files.
- Create or delete files.
- Run project audits.
- Modify source code.
- Persist any settings.

## 1. Ponytail Modes

| Mode | Command | Behavior |
|---|---|---|
| Lite | `/ponytail lite` | Implement the requested task and mention a simpler alternative. |
| Full | `/ponytail` | Smallest complete solution with necessary checks. Default mode. |
| Ultra | `/ponytail ultra` | Challenge unnecessary requirements and prefer maximum simplification. |
| Off | `/ponytail off` | Disable Ponytail behavior. |

The selected mode remains active until changed or the session ends.

To return to normal mode, say:
- `stop ponytail`
- `normal mode`

Resume with:

`/ponytail`

## 2. Available Ponytail Skills

| Skill | Command | Purpose |
|---|---|---|
| Ponytail | `/ponytail` | Minimal coding and YAGNI principles. |
| Ponytail Review | `/ponytail-review` | Review code changes for bugs, security, performance, tests and unnecessary complexity. |
| Ponytail Audit | `/ponytail-audit` | Audit the repository and prioritize findings. |
| Ponytail Debt | `/ponytail-debt` | Collect `shortcut:` comments into a tracked technical-debt ledger. |
| Ponytail Gain | `/ponytail-gain` | Display measured benchmark savings. |
| Ponytail Help | `/ponytail-help` | Display this reference guide. |

## 3. Recommended Workflow

For enterprise software development:

1. `/ponytail` – Implement the smallest complete solution.
2. `/ponytail-review` – Review the changed code.
3. `/ponytail-audit` – Investigate broader project risks.
4. `/ponytail-debt` – Collect documented shortcuts and technical debt.
5. `/ponytail-gain` – View the published efficiency benchmark.
6. `/ponytail-help` – Display available commands.

For Healthcare ERP, always prioritize:
- Data integrity.
- Security.
- Financial correctness.
- Stock consistency.
- Audit logging.
- Regression testing.

Never remove essential business validations to reduce code.

## 4. Claude Code Commands

| Command | Purpose |
|---|---|
| `/context` | Inspect context usage. |
| `/clear` | Start a fresh conversation context. |
| `/compact` | Compress the current conversation context. |
| `/model` | Select the model. |
| `/effort` | Configure reasoning effort. |
| `/mcp` | Manage MCP servers. |
| `/plugin` | Manage plugins. |
| `/reload-plugins` | Reload plugins. |
| `/agents` | Inspect available agents. |
| `/skills` | Inspect available skills. |

## 5. Ponytail Band (Claude Code)

Use:

`/ponytail band`

Toggle the Ponytail status band.

Other options:
- `/ponytail band on`
- `/ponytail band off`
- `/ponytail band import`

The import command adds supported historical Claude Code session usage to the Ponytail board.

## 6. Configure Default Mode

Default mode is Full.

Configuration file:

`%APPDATA%\ponytail\config.json`

Example:

```json
{
  "defaultMode": "full"
}
```

Supported values:
- `lite`
- `full`
- `ultra`
- `off`

PowerShell environment variable:

```powershell
$env:PONYTAIL_DEFAULT_MODE = "full"
```

Environment variable takes precedence over the configuration file.

Configuration changes should be performed only when explicitly requested.

## 7. Updating Ponytail

In Claude Code:

1. Run `/plugin`.
2. Open Marketplaces.
3. Select Ponytail.
4. Enable auto-update.

Manual update:

```text
/plugin marketplace update ponytail
/reload-plugins
```

If plugin commands are unavailable, verify the Claude Code version and installed plugin configuration.

## 8. Important Usage Rules

- Use Full mode for normal development.
- Use Lite for small bug fixes.
- Use Ultra when requirements appear unnecessarily complex.
- Use Review after meaningful code changes.
- Use Audit for broader repository inspection.
- Never sacrifice security, database integrity or required testing for shorter code.
- Do not assume published benchmark savings represent actual project savings.

## 9. Official Resources

Repository:
https://github.com/DietrichGebert/ponytail

Installation:
https://github.com/DietrichGebert/ponytail#install

Skill documentation:
https://github.com/DietrichGebert/ponytail/tree/main/skills

Final principle:

Use the right skill for the right task. Keep code simple, preserve functionality, and verify important changes.