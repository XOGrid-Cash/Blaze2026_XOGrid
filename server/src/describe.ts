/**
 * Turns a parsed XO template into plain English for people who do not read JSON. It only restates what the template
 * itself says (names, descriptions, who must provide what), so it can never claim more than the template contains.
 */

type Json = Record<string, any>;

const list = (items: string[]): string => {
    if (items.length <= 1) {
        return items[0] ?? '';
    }

    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/**
 * Templates write amounts and values as $(<fundSatoshis>) or $(<masterSatoshis> stakeFee OP_ADD), XO's fill-in syntax.
 * A person reading the description should see what is being filled in, so each one becomes [the variable's name], or
 * [calculated from: a, b] when it is a small calculation. Only names the template itself defines are used.
 */
export function readable(text: string, variables: Json = {}): string {
    return text.replace(/\$\(([^)]*)\)/g, (_match, inner: string) => {
        const names = [...new Set((inner.match(/(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((token) => !token.startsWith('OP_')))].map((id) =>
            typeof variables[id]?.name === 'string' ? variables[id].name.toLowerCase() : id,
        );

        if (names.length === 0) {
            return '[a value]';
        }

        return names.length === 1 ? `[${names[0]}]` : `[calculated from: ${names.join(', ')}]`;
    });
}

const sentence = (text: string): string => {
    const trimmed = text.trim();

    return trimmed === '' || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

export interface PlainEnglish {
    summary: string;
    steps: string[];
    whoDoesWhat: string[];
    youWillNeed: string[];
}

export function describeTemplate(template: unknown): PlainEnglish | null {
    if (typeof template !== 'object' || template === null) {
        return null;
    }

    const t = template as Json;
    const roles: Json = t.roles ?? {};
    const actions: Json = t.actions ?? {};
    const variables: Json = t.variables ?? {};
    const roleName = (id: string): string => String(roles[id]?.name ?? id);
    const variableName = (id: string): string => String(variables[id]?.name ?? id).toLowerCase();

    const roleIds = Object.keys(roles);
    const actionIds = Object.keys(actions);
    const name = String(t.name ?? 'This template');
    const parts = [`${name} is a template for ${roleIds.length === 1 ? 'one role' : `${roleIds.length} roles`}${roleIds.length > 0 ? `: ${list(roleIds.map(roleName))}` : ''}.`];

    if (typeof t.description === 'string' && t.description.trim() !== '') {
        parts.push(sentence(readable(t.description, variables)));
    }

    // Steps follow the template's start actions first, then the rest in the order they are declared.
    const starts: string[] = Array.isArray(t.start) ? t.start.map((entry: Json) => String(entry.action)) : [];
    const ordered = [...starts.filter((id) => id in actions), ...actionIds.filter((id) => !starts.includes(id))];
    const steps = ordered.map((id, index) => {
        const action = actions[id] as Json;
        const who = Object.keys(action.roles ?? {}).map(roleName);

        return `${index + 1}. ${action.name ?? id}${who.length > 0 ? ` (${list(who)})` : ''}${action.description ? `: ${sentence(readable(String(action.description), variables))}` : ''}`;
    });

    const whoDoesWhat = roleIds.map((id) => {
        const mine = ordered.filter((actionId) => id in ((actions[actionId] as Json).roles ?? {})).map((actionId) => String(actions[actionId].name ?? actionId));

        return `${roleName(id)}${roles[id]?.description ? `: ${sentence(readable(String(roles[id].description), variables))}` : ''}${mine.length > 0 ? ` Takes part in: ${list(mine)}.` : ''}`;
    });

    const needed = new Set<string>();

    for (const action of Object.values(actions) as Json[]) {
        for (const role of Object.values(action.roles ?? {}) as Json[]) {
            for (const variable of (role.requirements?.variables ?? []) as string[]) {
                needed.add(variable);
            }
        }
    }

    return {
        summary: parts.join(' '),
        steps,
        whoDoesWhat,
        youWillNeed: [...needed].map((id) => `${variableName(id)}${variables[id]?.description ? ` - ${sentence(readable(String(variables[id].description), variables))}` : ''}`),
    };
}
