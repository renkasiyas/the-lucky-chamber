# Pre-Commit Hook Setup

**Date**: 2026-02-03
**Status**: Active

---

## Overview

This project uses **Husky** and **lint-staged** to run automated checks before every commit. This ensures code quality and prevents broken code from being committed.

## What Runs on Pre-Commit

### Backend TypeScript Files (`backend/**/*.{ts,tsx}`)
- ✅ **Type Checking**: `tsc --noEmit` validates all TypeScript types
- Runs on ANY backend TypeScript file change

### Backend Test Files (`backend/**/*.test.ts`)
- ✅ **Test Execution**: Runs tests for modified test files
- Uses `vitest run` with verbose output
- Ensures tests pass before committing changes

### Frontend TypeScript Files (`frontend/**/*.{ts,tsx}`)
- ✅ **Type Checking**: Next.js linter validates types and code quality
- ✅ **Import Sorting**: Auto-sorts imports and exports using `eslint-plugin-simple-import-sort`
- ✅ **Auto-Fix**: ESLint automatically fixes issues when possible
- Runs `next lint --fix` on staged files

### Frontend Test Files (`frontend/**/*.test.{ts,tsx}`)
- ✅ **Test Execution**: Runs tests for modified test files
- Uses `vitest run` with verbose output
- Ensures tests pass before committing changes

---

## Installation

The pre-commit hook is automatically set up when you run `npm install` in the root directory due to the `"prepare": "husky"` script.

### Manual Setup (if needed)

```bash
# From project root
npm install

# Husky will initialize automatically via the prepare script
```

---

## Configuration Files

### `.husky/pre-commit`
```bash
npx lint-staged
```

### `package.json` - lint-staged configuration
```json
{
  "lint-staged": {
    "backend/**/*.{ts,tsx}": [
      "cd backend && npm run lint"
    ],
    "backend/**/*.test.ts": [
      "cd backend && npm run test -- --run --reporter=verbose"
    ],
    "frontend/**/*.{ts,tsx}": [
      "cd frontend && npm run lint -- --fix"
    ],
    "frontend/**/*.test.{ts,tsx}": [
      "cd frontend && npm run test -- --run --reporter=verbose"
    ]
  }
}
```

### `frontend/.eslintrc.json` - Import sorting
```json
{
  "extends": "next/core-web-vitals",
  "plugins": ["simple-import-sort"],
  "rules": {
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error"
  }
}
```

---

## How It Works

1. **You stage files**: `git add <files>`
2. **You attempt to commit**: `git commit -m "message"`
3. **Husky triggers**: Pre-commit hook runs automatically
4. **Lint-staged executes**:
   - Identifies staged files by type
   - Runs appropriate checks based on file patterns
   - Only processes staged files (fast!)
5. **Commit proceeds if**:
   - All type checks pass
   - All linting passes (or auto-fixed)
   - All tests pass
6. **Commit is blocked if**:
   - Type errors exist
   - Linting errors can't be auto-fixed
   - Any test fails

---

## Bypassing the Hook (Emergency Only)

⚠️ **Use sparingly** - bypassing quality checks defeats the purpose!

```bash
# Skip pre-commit hook
git commit --no-verify -m "Emergency fix"
```

**When to bypass**:
- Critical production hotfix (fix quality issues in next commit)
- CI/CD is broken and you need to push a config fix
- Working on experimental branch with intentionally broken code

**Never bypass for**:
- "I'm in a hurry"
- "Tests are slow"
- "I'll fix it later"

---

## Testing the Hook

```bash
# Make a change to a TypeScript file
echo "// test comment" >> frontend/hooks/useKNS.ts

# Stage the file
git add frontend/hooks/useKNS.ts

# Try to commit - hook will run
git commit -m "Test pre-commit hook"

# Hook will:
# 1. Run type checking
# 2. Run Next.js linter with auto-fix
# 3. Sort imports/exports
# 4. Show results

# Restore the file if just testing
git checkout frontend/hooks/useKNS.ts
```

---

## Troubleshooting

### Hook not running
```bash
# Re-initialize husky
npm run prepare

# Check hook exists and is executable
ls -la .husky/pre-commit
```

### Slow commits
The hook only runs on **staged files**, so it should be fast. If slow:
- Check if you're committing hundreds of files at once
- Consider committing in smaller batches
- Verify tests aren't running the entire suite

### Import sorting conflicts
If import sorting creates merge conflicts:
1. Accept incoming changes
2. Run `npm run lint -- --fix` in frontend
3. Review the sorted imports
4. Commit the fix

### Type errors on commit
```bash
# Run type check manually to see full errors
cd backend && npm run lint
cd frontend && npm run lint

# Fix the errors, then commit
```

---

## NPM Scripts Reference

From project root:

```bash
# Run all linters (type checking)
npm run lint

# Run all tests
npm run test

# Run backend tests only
npm run test:backend

# Run frontend tests only
npm run test:frontend

# Reinstall dependencies (triggers husky setup)
npm run install:all
```

---

## Import/Export Sorting Example

**Before** (unsorted):
```typescript
import { useState } from 'react'
import QRCode from 'qrcode'
import { useEffect } from 'react'
import config from '../lib/config'
```

**After** (auto-sorted by pre-commit):
```typescript
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import config from '../lib/config'
```

Sorting rules:
1. React/framework imports first
2. External packages second
3. Internal imports last
4. Blank line between groups

---

## Dependencies

- **husky** (^9.1.7): Git hooks made easy
- **lint-staged** (^16.2.7): Run linters on staged files
- **eslint-plugin-simple-import-sort** (frontend only): Auto-sort imports/exports

---

## Maintenance

### Adding new checks

Edit `package.json` lint-staged configuration:

```json
{
  "lint-staged": {
    "backend/**/*.{ts,tsx}": [
      "cd backend && npm run lint",
      "cd backend && npm run format"  // Add new check
    ]
  }
}
```

### Disabling the hook

```bash
# Remove the prepare script from package.json
# OR delete .husky directory
rm -rf .husky
```

### Updating hook dependencies

```bash
npm install --save-dev husky@latest lint-staged@latest
```

---

## Benefits

✅ **Catches errors early**: Type errors and test failures detected before push
✅ **Consistent code style**: Auto-sorted imports, enforced linting rules
✅ **Fast**: Only runs on changed files
✅ **Automatic**: No manual steps to remember
✅ **Prevents broken commits**: Can't commit code that doesn't compile
✅ **Improves code review**: Reviewers don't waste time on style issues

---

## Related Documentation

- [Frontend Test Coverage](./frontend-test-coverage-summary.md)
- [Backend Test Setup](../backend/README.md)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/okonet/lint-staged)
