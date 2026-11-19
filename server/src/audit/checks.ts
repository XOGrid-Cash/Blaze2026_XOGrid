import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { compileLockingBytecodeFromTemplateLockingScriptIdentifier } from '@xo-cash/engine';
import { secp256k1 } from '@bitauth/libauth';

export const CHECKER_VERSION = '2';

/** Above this size a template is rejected at publish time and fails the size check. */
export const MAX_TEMPLATE_BYTES = 256 * 1024;
const WARN_TEMPLATE_BYTES = 100 * 1024;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface CheckResult {
    id: string;
    title: string;
    status: CheckStatus;
    message: string;
    details?: string[];
}

export interface AuditContext {
    /** Canonical serialized template JSON as stored by the hub. */
    storedJson: string;
    /** The identifier the hub stored for this template. */
    storedIdentifier: string;
    /** Identifier of the submitted object before canonicalisation, when known (publish time only). */
    submittedIdentifier?: string;
}

// The template type is large and mostly irrelevant to these structural checks, so use a loose record shape here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseTemplate = Record<string, any>;

/** True for CashAssembly expressions such as $(<variable>), which are evaluated instead of looked up by name. */
function isExpression(value: string): boolean {
    return value.trimStart().startsWith('$(');
}

function asRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' ? (value as Record<string, any>) : {};
}

/** Check 1: the stored JSON parses as a valid XO template. */
export function checkSchema(ctx: AuditContext): { result: CheckResult; template?: LooseTemplate } {
    try {
        const template = parseTemplate(ctx.storedJson) as unknown as LooseTemplate;

        return {
            result: {
                id: 'schema',
                title: 'Template schema',
                status: 'pass',
                message: 'Parses as a valid XO template (@xo-cash/utils parseTemplate).',
            },
            template,
        };
    } catch (error) {
        return {
            result: {
                id: 'schema',
                title: 'Template schema',
                status: 'fail',
                message: `Not a valid XO template: ${firstLine(error)}`,
            },
        };
    }
}

/** Check 2: the identifier matches the canonical form; warn if the submitted key order differed. */
export function checkIdentifier(ctx: AuditContext, template: LooseTemplate): CheckResult {
    const recomputed = generateTemplateIdentifier(template as never);

    if (recomputed !== ctx.storedIdentifier) {
        return {
            id: 'identifier',
            title: 'Template identifier',
            status: 'fail',
            message: 'The stored identifier does not match the template content.',
            details: [`stored: ${ctx.storedIdentifier}`, `recomputed: ${recomputed}`],
        };
    }

    const reserialized = serializeTemplate(template as never);

    if (reserialized !== ctx.storedJson) {
        return {
            id: 'identifier',
            title: 'Template identifier',
            status: 'warn',
            message: 'The stored JSON is not in canonical form; serialize it with serializeTemplate before sharing.',
        };
    }

    if (ctx.submittedIdentifier && ctx.submittedIdentifier !== ctx.storedIdentifier) {
        return {
            id: 'identifier',
            title: 'Template identifier',
            status: 'warn',
            message:
                'Identifier matches the canonical form. The submitted JSON was not in canonical key order, so tools that hash it as-is get a different identifier.',
            details: [`canonical: ${ctx.storedIdentifier}`, `as submitted: ${ctx.submittedIdentifier}`],
        };
    }

    return {
        id: 'identifier',
        title: 'Template identifier',
        status: 'pass',
        message: 'Identifier matches the canonical template content.',
    };
}

/** Check 3: size limits. */
export function checkSize(ctx: AuditContext): CheckResult {
    const bytes = Buffer.byteLength(ctx.storedJson, 'utf8');

    if (bytes > MAX_TEMPLATE_BYTES) {
        return {
            id: 'size',
            title: 'Template size',
            status: 'fail',
            message: `${bytes} bytes exceeds the ${MAX_TEMPLATE_BYTES} byte limit.`,
        };
    }

    if (bytes > WARN_TEMPLATE_BYTES) {
        return { id: 'size', title: 'Template size', status: 'warn', message: `${bytes} bytes is unusually large.` };
    }

    return { id: 'size', title: 'Template size', status: 'pass', message: `${bytes} bytes.` };
}

/** Check 4: every name used in the template must be defined in the template. */
export function checkReferences(template: LooseTemplate): CheckResult {
    const roles = asRecord(template.roles);
    const actions = asRecord(template.actions);
    const transactions = asRecord(template.transactions);
    const inputs = asRecord(template.inputs);
    const outputs = asRecord(template.outputs);
    const lockingScripts = asRecord(template.lockingScripts);
    const scripts = asRecord(template.scripts);
    const variables = asRecord(template.variables);
    const problems: string[] = [];

    for (const [actionId, action] of Object.entries(actions)) {
        const a = asRecord(action);

        if (typeof a.transaction === 'string' && !(a.transaction in transactions)) {
            problems.push(`action "${actionId}" uses undefined transaction "${a.transaction}"`);
        }

        for (const [roleId, role] of Object.entries(asRecord(a.roles))) {
            if (!(roleId in roles)) {
                problems.push(`action "${actionId}" uses undefined role "${roleId}"`);
            }

            const requirements = asRecord(asRecord(role).requirements);

            for (const key of ['variables', 'secrets'] as const) {
                for (const variableId of Array.isArray(requirements[key]) ? requirements[key] : []) {
                    if (typeof variableId === 'string' && !(variableId in variables)) {
                        problems.push(`action "${actionId}", role "${roleId}" requires undefined variable "${variableId}"`);
                    }
                }
            }
        }

        for (const participant of Array.isArray(asRecord(a.requirements).participants)
            ? asRecord(a.requirements).participants
            : []) {
            const roleId = asRecord(participant).role;

            if (typeof roleId === 'string' && !(roleId in roles)) {
                problems.push(`action "${actionId}" requires participant with undefined role "${roleId}"`);
            }
        }
    }

    for (const [transactionId, transaction] of Object.entries(transactions)) {
        const t = asRecord(transaction);

        for (const entry of Array.isArray(t.inputs) ? t.inputs : []) {
            const id = asRecord(entry).input;

            if (typeof id === 'string' && !(id in inputs)) {
                problems.push(`transaction "${transactionId}" uses undefined input "${id}"`);
            }
        }

        for (const entry of Array.isArray(t.outputs) ? t.outputs : []) {
            const id = asRecord(entry).output;

            if (typeof id === 'string' && !(id in outputs)) {
                problems.push(`transaction "${transactionId}" uses undefined output "${id}"`);
            }
        }
    }

    for (const [outputId, output] of Object.entries(outputs)) {
        const lockingScriptId = asRecord(output).lockingScript;

        // A value like $(<recipientLockingScript>) takes the script from a variable, so it is not a name to resolve.
        if (typeof lockingScriptId === 'string' && !isExpression(lockingScriptId) && !(lockingScriptId in lockingScripts)) {
            problems.push(`output "${outputId}" uses undefined locking script "${lockingScriptId}"`);
        }
    }

    for (const [inputId, input] of Object.entries(inputs)) {
        const unlockingScriptId = asRecord(input).unlockingScript;

        if (typeof unlockingScriptId === 'string' && !isExpression(unlockingScriptId) && !(unlockingScriptId in scripts)) {
            problems.push(`input "${inputId}" uses undefined script "${unlockingScriptId}"`);
        }
    }

    for (const [lockingScriptId, lockingScript] of Object.entries(lockingScripts)) {
        const l = asRecord(lockingScript);

        for (const key of ['lockingBytecode', 'unlockingBytecode'] as const) {
            if (typeof l[key] === 'string' && !(l[key] in scripts)) {
                problems.push(`locking script "${lockingScriptId}" uses undefined script "${l[key]}" as ${key}`);
            }
        }
    }

    if (problems.length > 0) {
        return {
            id: 'references',
            title: 'Internal references',
            status: 'fail',
            message: `${problems.length} undefined reference${problems.length === 1 ? '' : 's'}.`,
            details: problems,
        };
    }

    return {
        id: 'references',
        title: 'Internal references',
        status: 'pass',
        message: 'Every referenced role, variable, transaction, input, output and script is defined.',
    };
}

/** Sample values for each variable type, so locking scripts can be compiled offline. Secrets are never sampled. */
function sampleVariables(template: LooseTemplate): Record<string, unknown> {
    const p2pkh = new Uint8Array([0x76, 0xa9, 0x14, ...new Array<number>(20).fill(1), 0x88, 0xac]);
    const publicKey = secp256k1.derivePublicKeyCompressed(new Uint8Array(32).fill(7));
    const values: Record<string, unknown> = {};

    for (const [id, variable] of Object.entries(asRecord(template.variables))) {
        switch (asRecord(variable).type) {
            case 'integer':
                values[id] = 144n;
                break;
            case 'satoshis':
                values[id] = 10000n;
                break;
            case 'locking_script':
                values[id] = p2pkh;
                break;
            case 'public_key':
                if (typeof publicKey !== 'string') {
                    values[id] = publicKey;
                }

                break;
            case 'string':
                values[id] = 'sample';
                break;
            case 'bytes':
                // Hex text, the way invitations carry bytes. Raw Uint8Array values compile to a different script.
                values[id] = '11'.repeat(32);
                break;
            default:
                // private_key, signature and token_* values are skipped on purpose.
                break;
        }
    }

    return values;
}

/**
 * Check 5: try to compile every locking script offline with sample values.
 * Scripts that need key data or secrets are reported as skipped, never as failures.
 */
export function checkCompile(template: LooseTemplate): CheckResult {
    const lockingScripts = Object.keys(asRecord(template.lockingScripts));
    const values = sampleVariables(template);
    const compiled: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];

    for (const id of lockingScripts) {
        try {
            const bytes = compileLockingBytecodeFromTemplateLockingScriptIdentifier(template as never, id, values as never);
            compiled.push(`${id}: compiled to ${bytes.length} bytes with sample values`);
        } catch (error) {
            const message = firstLine(error);

            if (/keys|secret|private|signature|token/i.test(message)) {
                skipped.push(`${id}: needs key, secret or token data (${message})`);
            } else {
                warnings.push(`${id}: could not compile with sample values (${message})`);
            }
        }
    }

    const details = [...compiled, ...skipped, ...warnings];

    if (lockingScripts.length === 0) {
        return { id: 'compile', title: 'Offline compile', status: 'skipped', message: 'No locking scripts to compile.' };
    }

    if (warnings.length > 0) {
        return {
            id: 'compile',
            title: 'Offline compile',
            status: 'warn',
            message: `${compiled.length} compiled, ${skipped.length} skipped, ${warnings.length} could not compile with sample values.`,
            details,
        };
    }

    if (compiled.length === 0) {
        return {
            id: 'compile',
            title: 'Offline compile',
            status: 'skipped',
            message: 'All locking scripts need key or secret data, so none were compiled.',
            details,
        };
    }

    return {
        id: 'compile',
        title: 'Offline compile',
        status: 'pass',
        message: `${compiled.length} compiled, ${skipped.length} skipped (sample values only; this does not prove the contract is correct).`,
        details,
    };
}

/** Check 6: scenarios are informational only. */
export function checkScenarios(template: LooseTemplate): CheckResult {
    const scenarios = Array.isArray(template.scenarios) ? template.scenarios : [];

    if (scenarios.length === 0) {
        return {
            id: 'scenarios',
            title: 'Test scenarios',
            status: 'warn',
            message: 'No scenarios included, so there is no golden example of expected behaviour.',
        };
    }

    return {
        id: 'scenarios',
        title: 'Test scenarios',
        status: 'pass',
        message: `${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} included. XO notes that scenarios are not suitable for providing trust, so this is informational.`,
    };
}

/**
 * Check 7: every resource link is a plain https address. The "resources" field is free text written by the publisher
 * and shown to people as links, so anything else (javascript:, data:, http:, an address with a login in it) is flagged.
 * This only ever warns: the page does not link such an address, so it cannot be clicked, but a person reading the
 * report should know the publisher wrote it.
 */
export function checkResources(template: LooseTemplate): CheckResult {
    const title = 'Resource links';
    const resources: unknown = template.resources;

    if (resources === undefined || (Array.isArray(resources) && resources.length === 0)) {
        return { id: 'resources', title, status: 'skipped', message: 'No resources (sources or credits) listed.' };
    }

    if (!Array.isArray(resources)) {
        return { id: 'resources', title, status: 'warn', message: 'The resources field is not a list, so no sources or credits are shown.' };
    }

    const problems: string[] = [];

    resources.forEach((entry: unknown, index: number) => {
        const item = asRecord(entry);
        const label = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, 60) : `Resource ${index + 1}`;
        const reason = resourceLinkProblem(item.url);

        if (reason) {
            problems.push(`${label}: ${reason}`);
        }
    });

    if (problems.length === 0) {
        return {
            id: 'resources',
            title,
            status: 'pass',
            message: `${resources.length} resource link${resources.length === 1 ? '' : 's'}, all plain https addresses.`,
        };
    }

    return {
        id: 'resources',
        title,
        status: 'warn',
        message: `${problems.length} of ${resources.length} resource link${resources.length === 1 ? ' is' : 's are'} not a plain https address. XOGrid does not make these clickable.`,
        details: problems.slice(0, 10),
    };
}

/** Why a resource address is not a plain https link, or undefined when it is one. */
function resourceLinkProblem(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
        return 'no address given';
    }

    let url: URL;

    try {
        url = new URL(value.trim());
    } catch {
        return 'not a valid address';
    }

    if (url.protocol === 'http:') {
        return 'uses http, not https';
    }

    if (url.protocol !== 'https:') {
        return `uses ${url.protocol.replace(':', '')}:, which is not a web link`;
    }

    if (url.username !== '' || url.password !== '') {
        return 'has a login embedded in the address';
    }

    if (value.length > 2000) {
        return 'address is unusually long';
    }

    return undefined;
}

function firstLine(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return (message.split('\n')[0] ?? message).slice(0, 240);
}
