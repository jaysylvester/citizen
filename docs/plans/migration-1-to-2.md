# Plan: citizen 1.x to 2.x migration automation

Status: **Draft**

Companion guide: [Migrating citizen 1.x applications to 2.x](../../MIGRATION.md)

## Objective

Build a dry-run-first migration assistant that inventories a citizen 1.x
application, applies unambiguous 2.x rewrites, and produces a report for every
value or code path requiring a user decision.

An agent workflow should come first. A standalone migration command can follow
after the workflow has been exercised against representative applications and
its safe transformations are understood.

## Why not begin with a fully automatic script

The framework portion is deterministic, but a 1.x config may also contain:

- several files selected by hostname;
- arbitrary application nodes with no prescribed env names;
- secrets that must not be copied into committed output;
- executable startup expressions rather than serializable values;
- route-specific CORS policies that differ from a global baseline;
- aliases and dynamic property access that a text replacement cannot classify.

A script can identify these cases but cannot choose the correct deployment or
application design. The first version should automate only changes whose
meaning is preserved.

## Operating rules

1. Run from the application repository, never from the citizen package.
2. Default to analysis only. Require an explicit apply step before writing.
3. Refuse destructive cleanup when the worktree is dirty unless the user has
   explicitly accepted the overlapping changes.
4. Never print env values classified as secrets.
5. Never delete legacy config. Archive it recoverably only after validation.
6. Keep edits idempotent so a second run reports no new mechanical work.
7. Record every assumption and unresolved item in the migration report.

## Inputs to discover

- application root and citizen start file;
- installed citizen version and package manager;
- application Node.js engine declaration;
- every `app/config/*.json` file and its `host` value;
- configuration passed to every `app.start()` call;
- Git ignore rules and existing env/example files;
- JavaScript, template, deployment, and documentation references to old config;
- application test, lint, build, and start commands.

Only ask the user for information that cannot be discovered, principally:

- which host config represents each deployment;
- preferred names for application-owned env variables;
- which routes need to override or disable a global CORS policy;
- whether legacy files may be archived after verification.

## Analysis output

Produce both a readable report and structured data suitable for a later CLI:

```text
citizen-migration-report.md
.citizen-migration.json
```

The report groups findings into:

- safe automatic changes;
- proposed changes requiring approval;
- manual changes;
- blocked or unclassified values;
- secret-handling warnings;
- verification commands and results.

The structured file should record source file, source path, proposed target,
value type, confidence, secret classification, and status for every item. It
must not contain secret values.

## Transformation matrix

| Change | Automatic | Notes |
| --- | --- | --- |
| Require Node.js 22 | Yes | Preserve unrelated package metadata |
| Add `.env` to `.gitignore` | Yes | Do not duplicate an equivalent rule |
| Create `.env.example` | Yes, after classification | Use placeholders for secrets |
| Convert known `citizen.*` JSON leaves to `CITIZEN_*` | Yes | Use the framework's generated mapping and coercion rules |
| Drop JSON `host` | Yes, after deployment selection | Record the selected source |
| Rewrite `app.config.citizen.*` to `app.config.*` | Yes | AST member-expression rewrite |
| Rewrite `params.config.citizen.*` to `params.config.*` | Yes | AST member-expression rewrite |
| Rewrite view `config.citizen.*` to `config.*` | Usually | Limit to recognized citizen view files |
| Remove an empty `app.start()` object | Yes | Only when every property was migrated |
| Name application-owned env variables | No | Propose names and ask |
| Add application type coercion/validation | No | Application-specific behavior |
| Convert computed startup expressions | No | Preserve for manual refactoring |
| Convert global `citizen.cors` to `CITIZEN_CORS` | Yes | Preserve route-specific overrides |
| Resolve multiple host JSON files | No | Requires deployment knowledge |
| Remove or archive legacy JSON | Approval required | Archive recoverably; never silently delete |

## Agent workflow

### Phase 1: preflight

1. Confirm the repository root, worktree state, current branch, Node version,
   package manager, and citizen version.
2. Run the existing application tests or record why no baseline is available.
3. Discover the app directory from conventional layout and start/config code.
4. Create no files during this phase.

### Phase 2: inventory and classification

1. Parse every legacy JSON config without merging it.
2. Separate `host`, `citizen`, and application-owned roots.
3. Map known framework leaves using citizen's env-key generator.
4. Map global `cors`; flag route-specific policies and conflicting values.
5. Parse start files and classify literal, environment-derived, computed, and
   secret-like values.
6. Scan code semantically for old config member expressions; retain a text scan
   as a backstop for templates and documentation.
7. Present the report and obtain decisions before applying ambiguous changes.

### Phase 3: safe edits

1. Update Node engine metadata.
2. Add the Git ignore rule.
3. Generate `.env.example` and, only when requested, a local `.env` in the
   project root.
4. Apply AST-based framework member rewrites.
5. Simplify `app.start()` only after all arguments are accounted for.
6. Apply approved application env names and explicit coercion modules.
7. Convert global CORS settings to `CITIZEN_CORS` and retain approved
   controller/action overrides.
8. Format changed files using the application's existing tooling.

### Phase 4: validation

1. Validate all generated `CITIZEN_*` names and values with the 2.x resolver.
2. Confirm `.env` is ignored and no secret value appears in tracked output.
3. Search again for JSON loaders, start arguments, and `.citizen` runtime paths.
4. Run syntax checks, lint, tests, and build commands.
5. Boot once without `.env`, once with development values, and once with a
   process override; use disabled servers or an ephemeral port where possible.
6. Smoke-test representative routes, controller overrides, CORS, and HTTPS when
   the application uses them.
7. Compare results with the pre-migration baseline.

### Phase 5: cleanup and handoff

1. Show the complete diff and unresolved report items.
2. With approval, archive `app/config` outside the active directory so the 2.x
   migration guard no longer blocks startup.
3. Re-run validation after archival.
4. Hand off the commands run, results, manual follow-ups, and rollback path.

## Proposed CLI after the agent workflow stabilizes

```bash
npx citizen-migrate analyze --app ./app
npx citizen-migrate apply --app ./app
npx citizen-migrate verify --app ./app
```

Useful options may include:

```text
--config <file>       Select one legacy config explicitly
--report <path>       Set the report location
--no-env              Do not create a local project-root .env
--archive <path>      Archive legacy config after successful verification
--non-interactive     Apply safe transformations only and leave decisions open
```

Do not add a `--force` option that suppresses classification or verification.

## Implementation stages

1. Collect two or more real 1.x fixture applications, including one with
   multiple host configs and application-owned settings.
2. Implement the read-only analyzer and snapshot its reports in tests.
3. Implement package/Git edits and exact member-expression codemods.
4. Implement framework JSON-to-env conversion using citizen's actual mapping.
5. Add interactive decisions for application variables, hosts, and
   route-specific CORS overrides.
6. Add verification orchestration and secret scanning.
7. Run the agent workflow on real migrations before deciding which parts are
   stable enough for a published CLI.

## Acceptance criteria

- Analysis never mutates the application.
- Apply mode changes only classified or explicitly approved items.
- No secret value appears in the report, example env, console output, or diff.
- Known framework settings round-trip to the expected `app.config.*` paths.
- A second apply run is a no-op.
- Legacy config is never deleted automatically.
- The migrated application starts with `app.start()` and no arguments.
- The application's tests and selected endpoint checks pass under Node.js 22.
- Every unresolved item is visible and actionable in the final report.
