# Agent Instructions

This file contains mandatory instructions for ALL agents working on this project. Every agent MUST follow these guidelines.

## Branch Strategy

**NEVER commit directly to `main`.** Always create a feature branch for your work.

### Branch Naming Convention
```
<agent-type>/<issue-number>-<short-description>
```

Examples:
- `database-engineer/22-prisma-setup`
- `backend-engineer/21-project-scaffolding`
- `ml-ai-engineer/25-llm-prompts`
- `security-engineer/security-review`

### Creating Your Branch
```bash
git checkout main
git pull origin main
git checkout -b <your-branch-name>
```

## Commit Guidelines

### Commit Often
- Make small, focused commits
- Commit after completing each logical unit of work
- Don't bundle unrelated changes in a single commit

### Commit Message Format
```
<type>(<scope>): <short description>

<optional body with more details>

🤖 Generated with Claude Code

Co-Authored-By: <Agent Name> <noreply@anthropic.com>
```

### Commit Types
- `feat`: New feature or functionality
- `fix`: Bug fix
- `refactor`: Code restructuring without behavior change
- `test`: Adding or updating tests
- `docs`: Documentation changes
- `chore`: Build, config, or tooling changes
- `security`: Security-related changes

### Examples
```
feat(webhook): implement HubSpot webhook endpoint

- Add POST /webhook/hubspot route
- Implement X-Webhook-Token validation
- Add fast-ack response pattern

🤖 Generated with Claude Code

Co-Authored-By: Backend Engineer <noreply@anthropic.com>
```

```
feat(db): add Prisma schema for idempotency store

🤖 Generated with Claude Code

Co-Authored-By: Database Engineer <noreply@anthropic.com>
```

## Code Review Process

### Before Pushing Code

1. **Self-review your changes**
   ```bash
   git diff
   ```

2. **Request code-reviewer agent review**
   - Before pushing, have the `code-reviewer` agent review your work
   - Address any issues or suggestions raised
   - Make revision commits as needed

3. **Ensure code quality**
   - Code compiles/builds without errors
   - Linting passes (if configured)
   - Tests pass (if applicable)
   - No secrets or credentials in code

## Creating Pull Requests

### When to Create a PR
- After code-reviewer agent has approved your changes
- When your feature/task is complete and tested
- When you need human review for a significant decision

### PR Title Format
```
[<Agent>] <Issue Reference>: <Short Description>
```

Examples:
- `[Database Engineer] #22: PostgreSQL + Prisma Setup`
- `[Backend Engineer] #21: Project Scaffolding with Fastify`
- `[ML/AI Engineer] #25: LLM System Prompt Engineering`

### PR Description Template
```markdown
## Summary
Brief description of what this PR accomplishes.

## Related Issues
Closes #<issue-number>

## Changes Made
- Change 1
- Change 2
- Change 3

## Testing Done
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Code Review
- [x] Reviewed by code-reviewer agent
- [ ] Revision commits made (if applicable)

## Checklist
- [ ] Code follows project conventions
- [ ] No secrets or credentials committed
- [ ] Documentation updated (if needed)
- [ ] All CI checks pass

---
🤖 Generated with Claude Code
```

### After Creating a PR
- The user will monitor PR comments
- If comments are made, the user will notify you
- Address all PR comments with additional commits
- Do NOT force-push or rebase after PR is open (unless requested)

## Handling PR Comments

When notified of PR comments:

1. **Read all comments carefully**
2. **Make necessary code changes**
3. **Commit with reference to the feedback**
   ```
   fix(webhook): address PR feedback - add rate limiting

   Addresses review comment about missing rate limiting
   on the webhook endpoint.

   🤖 Generated with Claude Code

   Co-Authored-By: Backend Engineer <noreply@anthropic.com>
   ```
4. **Reply to comments** (if using GitHub CLI)
   ```bash
   gh pr comment <pr-number> --body "Addressed in commit <sha>"
   ```
5. **Request re-review if needed**

## Agent Coordination

### Avoid Conflicts
- Check if other agents are working on related files
- Communicate dependencies clearly
- Pull latest changes before starting new work

### Handoff Protocol
When your work depends on another agent's work:
1. Wait for their PR to be merged
2. Pull the latest `main` branch
3. Create your branch from updated `main`

### Shared Files
If multiple agents need to modify the same file:
- Coordinate through the user
- One agent completes their changes first
- Other agents rebase after merge

## File Ownership Guidelines

| Agent | Primary Files/Directories |
|-------|--------------------------|
| database-engineer | `prisma/`, `src/db/` |
| backend-engineer | `src/`, `package.json`, `tsconfig.json` |
| ml-ai-engineer | `src/llm/`, `src/prompts/`, `src/validation/` |
| security-engineer | `src/security/`, `src/middleware/auth*` |
| devsecops-engineer | `.github/`, `railway.toml`, `Dockerfile`, CI configs |
| qa-engineer | `tests/`, `*.test.ts`, `*.spec.ts` |

## Summary Checklist

Before considering your work complete:

- [ ] Created feature branch (not working on main)
- [ ] Made atomic commits with clear messages
- [ ] Code-reviewer agent has reviewed the code
- [ ] All revision commits made
- [ ] Code builds and tests pass
- [ ] PR created with proper description
- [ ] Ready to address any PR comments from user
