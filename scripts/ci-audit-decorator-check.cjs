#!/usr/bin/env node
/**
 * CI lint: every non-GET controller method under
 * glucose-admin-api/src/modules/(asterisk)(asterisk)/(asterisk).controller.ts MUST carry
 * either @Audit(action, entity) or @SkipAudit('non-empty reason').
 *
 * Implements AUTH-12 (Phase 2 Plan 01) — repudiation resistance for staff
 * mutations. Without this gate, a non-audited mutation could ship undetected
 * (T-02-01 in the plan's threat register).
 *
 * Detection rules:
 *   - Walk every method declaration on every class.
 *   - If a method is decorated with @Post / @Put / @Patch / @Delete, it MUST
 *     also be decorated with @Audit(...) or @SkipAudit(...).
 *   - @SkipAudit must receive a non-empty string literal as its first arg.
 *
 * Exits 0 if all good. Exits 1 with a per-file/line report on violation.
 *
 * Usage:
 *   node scripts/ci-audit-decorator-check.cjs                    # default scan: src/modules
 *   node scripts/ci-audit-decorator-check.cjs <path> [<path>...] # custom roots (used by self-tests)
 *
 * Each <path> may be a directory (walked recursively for .controller.ts) or
 * a single .controller.ts file (used directly).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const HTTP_METHOD_DECORATORS = new Set(['Post', 'Put', 'Patch', 'Delete']);
const AUDIT_DECORATORS = new Set(['Audit', 'SkipAudit']);

function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.controller.ts')) out.push(full);
    }
    return out;
}

function getDecoratorName(dec) {
    const expr = dec.expression;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
        return expr.expression.text;
    }
    if (ts.isIdentifier(expr)) return expr.text;
    return null;
}

function getSkipAuditReason(dec) {
    const expr = dec.expression;
    if (!ts.isCallExpression(expr)) return null;
    const arg = expr.arguments[0];
    if (arg && ts.isStringLiteral(arg)) return arg.text;
    return null;
}

function lint(filePath, violations) {
    const src = fs.readFileSync(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);

    function visit(node) {
        if (ts.isMethodDeclaration(node)) {
            const decorators = ts.getDecorators(node) || [];
            const names = decorators.map(getDecoratorName).filter(Boolean);

            const hasMutationDecorator = names.some((n) => HTTP_METHOD_DECORATORS.has(n));
            if (hasMutationDecorator) {
                const auditDec = decorators.find((d) => {
                    const n = getDecoratorName(d);
                    return n && AUDIT_DECORATORS.has(n);
                });

                const methodName =
                    node.name && ts.isIdentifier(node.name) ? node.name.text : '<anonymous>';

                if (!auditDec) {
                    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                    violations.push({
                        file: filePath,
                        line: line + 1,
                        method: methodName,
                        reason: 'missing @Audit(...) or @SkipAudit(...) on mutation handler',
                    });
                } else if (getDecoratorName(auditDec) === 'SkipAudit') {
                    const reason = getSkipAuditReason(auditDec);
                    if (!reason || reason.trim().length === 0) {
                        const { line } = sf.getLineAndCharacterOfPosition(auditDec.getStart(sf));
                        violations.push({
                            file: filePath,
                            line: line + 1,
                            method: methodName,
                            reason: '@SkipAudit reason must be a non-empty string',
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sf);
}

function main() {
    const args = process.argv.slice(2);
    const scanRoots = args.length > 0 ? args : [path.join('src', 'modules')];

    const files = [];
    for (const root of scanRoots) {
        try {
            const stat = fs.statSync(root);
            if (stat.isDirectory()) {
                walk(root, files);
            } else if (stat.isFile() && root.endsWith('.controller.ts')) {
                files.push(root);
            }
        } catch {
            // Missing path — silently skip (default scan root may not exist yet
            // in early-phase repos).
        }
    }

    const violations = [];
    for (const f of files) lint(f, violations);

    if (violations.length === 0) {
        console.log(`[audit-lint] OK -- scanned ${files.length} controller file(s).`);
        process.exit(0);
    }

    console.error(`[audit-lint] FAIL -- ${violations.length} violation(s):`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  ${v.method}  -- ${v.reason}`);
    }
    process.exit(1);
}

main();
