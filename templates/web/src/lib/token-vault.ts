/**
 * Token Vault tools bound to the committed token-vault/template.json (see token-vault-core.ts).
 */
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import templateText from '../../../token-vault/template.json?raw';
import { createTokenVaultTools } from './token-vault-core';

/** The template exactly as committed, for the page's download button (import it into the XO wallet). */
export const tokenVaultTemplateText = templateText;
export const tokenVaultTemplate = parseTemplate(templateText);
export const tokenVault = createTokenVaultTools(tokenVaultTemplate, generateTemplateIdentifier(tokenVaultTemplate));
export * from './token-vault-core';
