import {
    CHECKER_VERSION,
    checkCompile,
    checkIdentifier,
    checkReferences,
    checkResources,
    checkScenarios,
    checkSchema,
    checkSize,
    type AuditContext,
    type CheckResult,
} from './checks.js';

export { CHECKER_VERSION, MAX_TEMPLATE_BYTES } from './checks.js';
export type { AuditContext, CheckResult, CheckStatus } from './checks.js';

export interface AuditReport {
    checkerVersion: string;
    results: CheckResult[];
}

/**
 * Runs every audit check against a stored template. Never throws: a check that cannot run is reported as a failure
 * of that check. "No fail" means "passed the automated checks", not "safe".
 */
export function runAudit(ctx: AuditContext): AuditReport {
    const results: CheckResult[] = [];
    const schema = checkSchema(ctx);

    results.push(schema.result);
    results.push(checkSize(ctx));

    if (schema.template) {
        const template = schema.template;

        results.push(guard('identifier', 'Template identifier', () => checkIdentifier(ctx, template)));
        results.push(guard('references', 'Internal references', () => checkReferences(template)));
        results.push(guard('compile', 'Offline compile', () => checkCompile(template)));
        results.push(guard('scenarios', 'Test scenarios', () => checkScenarios(template)));
        results.push(guard('resources', 'Resource links', () => checkResources(template)));
    }

    return { checkerVersion: CHECKER_VERSION, results };
}

function guard(id: string, title: string, run: () => CheckResult): CheckResult {
    try {
        return run();
    } catch (error) {
        return {
            id,
            title,
            status: 'fail',
            message: `Check crashed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        };
    }
}

/** True when the report contains no failing check. */
export function hasNoFailures(report: Pick<AuditReport, 'results'>): boolean {
    return report.results.every((result) => result.status !== 'fail');
}
