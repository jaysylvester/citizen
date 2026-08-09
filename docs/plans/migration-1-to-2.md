# Plan: Citizen 1.x to 2.x migration automation

Status: **Draft**

Companion guide: [Migrating Citizen 1.x applications to 2.x](../../MIGRATION.md)

## Objective

Build a dry-run-first migration assistant that inventories a Citizen 1.x application, applies only meaning-preserving 2.x rewrites, and reports every value or code path requiring a user decision.

Start with an agent workflow. Consider a standalone command only after the workflow has been exercised against representative applications and its safe transformations are understood.

## Why migration cannot be fully automatic

A legacy application may contain multiple hostname-selected files, arbitrary application nodes, committed secrets, executable startup expressions, aliases, dynamic property access, and route-specific CORS policies. A tool can identify these cases but cannot safely choose a deployment, secret store, variable name, or application design.

## Operating rules

1. Run from the application repository, never from the Citizen package.
2. Default to analysis only and require explicit approval before writing.
3. Record the baseline worktree and avoid overlapping user changes.
4. Never print or copy values classified as secrets into reports or committed examples.
5. Never delete legacy config automatically; archive it recoverably only after validation and approval.
6. Keep edits idempotent so a second run reports no new mechanical work.
7. Record every assumption and unresolved item.

## Discovery

Inspect:

- the project root, app directory, start file, Citizen version, Node engine, and package manager;
- every `app/config/*.json` file and `host` value;
- every argument passed to `app.start()`;
- existing env files, examples, ignore rules, and deployment configuration;
- JavaScript, templates, docs, and scripts that reference old config paths;
- application test, lint, build, and start commands.

Ask the user only for choices that cannot be discovered: which host config represents each deployment, names for application-owned variables, secret destinations, route-specific CORS intent, and permission to archive legacy files.

## Analysis output

Produce a readable `citizen-migration-report.md` plus structured `.citizen-migration.json`. The structured report records source file, source path, proposed target, value type, confidence, secret classification, and status, but never the secret value.

Group findings into safe automatic edits, proposals requiring approval, manual work, blocked/unclassified values, secret warnings, and verification commands.

## Transformation matrix

| Change | Automatic | Notes |
| --- | --- | --- |
| Require Node.js 22 | Yes | Preserve unrelated package metadata. |
| Add `.env` to Git ignore rules | Yes | Do not duplicate an equivalent rule. |
| Create `.env.example` | After classification | Use placeholders for application values and secrets. |
| Convert a selected `citizen` JSON object | Yes | Default-export it directly from `citizen.config.js`; preserve JavaScript types. |
| Drop `host` | After deployment selection | Record the selected source; there is no runtime selector. |
| Rewrite `app.config.citizen.*` | Yes | Use an AST member-expression rewrite to `app.config.*`. |
| Rewrite `params.config.citizen.*` | Yes | Use an AST member-expression rewrite to `params.config.*`. |
| Rewrite view `config.citizen.*` | Usually | Limit to recognized Citizen views. |
| Remove an empty `app.start()` argument | Yes | Only after every property has been classified. |
| Move application values to env names | No | Propose names and obtain approval. |
| Add application coercion/validation | No | Behavior is application-specific. |
| Convert computed startup expressions | No | Preserve for manual refactoring. |
| Move global `citizen.cors` | Yes | Put it at config-module root and preserve route overrides. |
| Resolve multiple host files | No | Requires deployment knowledge. |
| Archive legacy JSON | Approval required | Never silently delete it. |

## Workflow

### 1. Preflight

Confirm the repository root, branch, worktree, Node version, package manager, installed Citizen version, app layout, and baseline tests. Make no changes.

### 2. Inventory and classification

Parse every JSON file independently. Separate `host`, `citizen`, and application-owned roots. Parse startup calls and classify literals, environment-derived values, computed expressions, and secret-like values. Scan code semantically for config member expressions and retain text search as a template/documentation backstop.

Present the report and resolve ambiguous deployments and application variable names before editing.

### 3. Safe edits

1. Update the Node engine and Citizen dependency.
2. Add `.env` to ignore rules and generate a safe example.
3. Create `citizen.config.js` from the selected framework object.
4. Apply AST-based flat framework member rewrites.
5. Move approved application settings to explicit environment reads.
6. Simplify `app.start()` only when every argument is accounted for.
7. Consolidate approved global CORS while retaining route exceptions.
8. Format changed files with the application's existing tools.

### 4. Validation

Confirm the config module default-exports a plain object, no application secret is exported through `app.config`, `.env` is ignored, and no secret appears in tracked output or the report. Search again for JSON loaders, `.citizen` paths, and start arguments.

Run syntax checks, lint, tests, and builds. Boot without `.env` when supported, with development values, and with deployment overrides. Smoke-test representative routes, config overrides, CORS, HTTPS, watchers, and public exports.

### 5. Cleanup and handoff

Show the diff and unresolved report. With explicit approval, archive `app/config` outside the active directory and re-run validation. Hand off the commands run, results, remaining manual decisions, and rollback path.

## Possible CLI after the workflow stabilizes

```bash
npx citizen-migrate analyze --app ./app
npx citizen-migrate apply --app ./app
npx citizen-migrate verify --app ./app
```

Potential options include an explicit legacy config source, report path, suppression of local `.env` creation, an archive destination, and a non-interactive safe-edits-only mode. Do not add a force option that bypasses classification or verification.

## Acceptance criteria

- Analysis never mutates the application.
- Apply mode changes only classified or explicitly approved items.
- No secret value appears in reports, examples, output, or diffs.
- The generated config module preserves known framework values and types.
- A second apply run is a no-op.
- Legacy config is never deleted automatically.
- The migrated app starts with no `app.start()` arguments.
- Tests and selected endpoint checks pass under Node.js 22.
- Every unresolved item is visible and actionable.
