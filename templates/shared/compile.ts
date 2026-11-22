/**
 * Compiles every contract system's .cash files into committed artifacts, and prints bytecode size and op count.
 *
 *     npm run compile                    # all systems
 *     npm run compile -- revenue-split   # one system
 *
 * Each file is compiled with the cashc version its `pragma cashscript` asks for, so contracts adopted from other
 * projects are rebuilt with their original compiler and keep their deployed bytecode (and address). Artifacts are
 * committed so reviewers can diff the exact bytecode a template embeds. `updatedAt` is dropped so recompiling
 * unchanged code leaves the file unchanged.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import * as cashc014 from 'cashc';
import * as cashc09 from 'cashc-0.9';
import * as cashc010 from 'cashc-0.10';

/** Supported compilers, matched against the version range in a file's pragma. */
const COMPILERS = [
    { pragma: /^\^0\.9\.\d+$/, version: '0.9.3', compileString: cashc09.compileString },
    // The prerelease BadgerStake was built with; it reproduces the deployed bytecode.
    { pragma: /^\^0\.10\.\d+$/, version: '0.10.0-next.4', compileString: cashc010.compileString },
    { pragma: /^\^0\.14\.\d+$/, version: '0.14.0', compileString: cashc014.compileString },
];

/**
 * Adopted files kept verbatim and pinned to the compiler that reproduces their deployed bytecode: files with no pragma,
 * or with an open-ended one (`>=0.9.3`). Keys are paths relative to templates/, with forward slashes.
 */
const PINNED: Record<string, (typeof COMPILERS)[number]['version']> = {
    // Uses tx.age, which cashc 0.14 removed; 0.9.3 compiles it to the live Drip Mine redeem script.
    'drip-mine/drip-mine.cash': '0.9.3',
    // `pragma cashscript >=0.9.3`, built upstream with 0.10.0-next.5; 0.10.0-next.4 reproduces that bytecode exactly.
    // cashc 0.14 rejects its bytes8(int) casts.
    'token-vault/TokenVault_Release.cash': '0.10.0-next.4',
};

const root = join(import.meta.dirname, '..');
const only = process.argv[2];
const systems = readdirSync(root).filter(
    (name) => !name.startsWith('_') && !['node_modules', 'shared'].includes(name) && statSync(join(root, name)).isDirectory(),
);

function compilerFor(file: string): (typeof COMPILERS)[number] {
    const pragma = /pragma\s+cashscript\s+([^;]+);/.exec(readFileSync(file, 'utf8'))?.[1]?.trim();
    const pinned = PINNED[relative(root, file).replaceAll('\\', '/')];
    const compiler = COMPILERS.find((candidate) => (pinned ? candidate.version === pinned : pragma && candidate.pragma.test(pragma)));

    if (!compiler) {
        throw new Error(`${file}: no compiler configured for pragma "${pragma ?? '(none)'}". Add one to COMPILERS in shared/compile.ts.`);
    }

    return compiler;
}

for (const system of systems.filter((name) => !only || name === only)) {
    for (const file of readdirSync(join(root, system)).filter((name) => name.endsWith('.cash'))) {
        const source = join(root, system, file);
        const compiler = compilerFor(source);
        // LF line endings, so the artifact's `source` is the same whether git checked the file out with LF or CRLF.
        const code = readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
        const artifact = compiler.compileString(code) as { contractName: string; bytecode: string; updatedAt?: string; debug?: { bytecode: string } };
        const { updatedAt: _ignored, ...stable } = artifact;
        const outDir = join(root, system, 'artifact');
        const opcodes = artifact.bytecode.split(' ').filter((token) => token.startsWith('OP_')).length;

        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, `${artifact.contractName}.json`), `${JSON.stringify(stable, null, 2)}\n`);
        console.log(`${system}/${file} (cashc ${compiler.version}): ${artifact.contractName}, ${opcodes} opcodes${artifact.debug ? `, ${artifact.debug.bytecode.length / 2} bytes` : ''}`);
    }
}
