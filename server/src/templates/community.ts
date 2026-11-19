import { COMMUNITY_TEMPLATE_JSON } from './community-data.js';

/**
 * The XO templates written for XOGrid in the repo's templates/ folder, each wrapping a contract that already exists.
 * `identifier` is what the template's README records; the test suite fails if a template stops matching it.
 */
export interface CommunityTemplate {
    slug: string;
    identifier: string;
    json: string;
}

const IDENTIFIERS: Record<string, string> = {
    'badgers-stake': '991a7bbd2337748e5537850eef69fe34b88b5ad29b3d8de26a1156df2b4c66e7',
    'block-points': '9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a',
    'drip-mine': '346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185',
    'revenue-split': 'b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e',
    'token-burner': '1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0',
};

export const COMMUNITY_TEMPLATES: CommunityTemplate[] = Object.entries(COMMUNITY_TEMPLATE_JSON).map(([slug, json]) => ({
    slug,
    identifier: IDENTIFIERS[slug] ?? '',
    json,
}));
