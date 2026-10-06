import fs from 'fs';
import assert from 'assert';
import { parse, tokenize, tokenNames, tokenReplace } from 'css-tree';

const {
    TokenReplacementError,
    createReplacementPlan,
    applyReplacementPlan,
    replaceTokens,
    fingerprint
} = tokenReplace;

function tokenTexts(css) {
    const tokens = [];

    tokenize(css, (type, start, end) => tokens.push(`${tokenNames[type]}:${css.slice(start, end)}`));

    return tokens;
}

describe('token-replace', () => {
    describe('createReplacementPlan() + applyReplacementPlan()', () => {
        it('should replace a dimension by exact lexer range', () => {
            const css = 'a { width: 10px; }';
            const { css: result, edits } = replaceTokens(css, [
                { start: 11, end: 15, value: '20px' }
            ]);

            assert.strictEqual(result, 'a { width: 20px; }');
            assert.strictEqual(edits.length, 1);
            assert.deepStrictEqual(
                edits.map(({ start, end }) => [start, end]),
                [[11, 15]]
            );
        });

        it('should resolve a token by any offset inside it', () => {
            const css = 'a { width: 10px; }';

            assert.strictEqual(
                replaceTokens(css, [{ offset: 13, value: '20px' }]).css,
                'a { width: 20px; }'
            );
        });

        it('should keep unselected tokens and comments byte for byte', () => {
            const css = 'a { width: 10px; /* keep me */ content: "10px"; }';
            const { css: result } = replaceTokens(css, [
                { start: 11, end: 15, value: '20px' }
            ]);

            assert.strictEqual(result, 'a { width: 20px; /* keep me */ content: "10px"; }');
            assert.ok(result.includes('/* keep me */'));
            assert.ok(result.includes('"10px"'));
        });

        it('should apply several edits in one plan', () => {
            const css = 'a { width: 10px; border: solid red; }';
            const { css: result } = replaceTokens(css, [
                { offset: css.indexOf('10px'), value: '20px' },
                { offset: css.indexOf('solid'), value: 'dashed' }
            ]);

            assert.strictEqual(result, 'a { width: 20px; border: dashed red; }');
        });

        it('should accept a replacement that matches the declaration syntax', () => {
            assert.strictEqual(
                replaceTokens('a{width:10px}', [{ offset: 8, value: '20px' }]).css,
                'a{width:20px}'
            );
            assert.strictEqual(
                replaceTokens('a{width:10px}', [{ offset: 8, value: 'auto' }]).css,
                'a{width:auto}'
            );
        });

        it('should reject a replacement that breaks the declaration syntax', () => {
            assert.throws(
                () => replaceTokens('a{width:10px}', [{ offset: 8, value: 'red' }]),
                error => error instanceof TokenReplacementError && error.code === 'syntax-mismatch'
            );
        });

        it('should not replace look-alike words inside strings', () => {
            const css = 'a { content: "10px"; }';

            assert.throws(
                () => replaceTokens(css, [{ offset: css.indexOf('10px'), value: '20px' }]),
                error => error instanceof TokenReplacementError && error.code === 'not-replaceable'
            );
            // the source is untouched
            assert.strictEqual(css, 'a { content: "10px"; }');
        });

        it('should not replace comments', () => {
            const css = 'a { /* 10px */ width: 10px; }';

            assert.throws(
                () => replaceTokens(css, [{ offset: css.indexOf('10px'), value: '20px' }]),
                error => error instanceof TokenReplacementError && error.code === 'not-replaceable'
            );
        });

        it('should reject a range that matches no token exactly', () => {
            assert.throws(
                () => replaceTokens('a{width:10px}', [{ start: 8, end: 10, value: '2' }]),
                error => error instanceof TokenReplacementError && error.code === 'token-not-found'
            );
        });

        it('should reject overlapping edits up front', () => {
            assert.throws(
                () => createReplacementPlan('a{width:10px}', [
                    { start: 8, end: 12, value: '20px' },
                    { offset: 9, value: '30px' }
                ]),
                error => error instanceof TokenReplacementError && error.code === 'overlap'
            );
        });

        it('should reject a value that encodes to more than one token', () => {
            for (const value of ['10 px', 'solid red', '1,2']) {
                assert.throws(
                    () => replaceTokens('a{--x:one}', [{ offset: 6, value }]),
                    error => error instanceof TokenReplacementError && error.code === 'bad-value-encoding',
                    `value ${JSON.stringify(value)} should be rejected`
                );
            }
        });

        it('should reject a value of a non-replaceable token type', () => {
            for (const value of ['"str"', '#fff', 'url(x)', ';']) {
                assert.throws(
                    () => replaceTokens('a{--x:one}', [{ offset: 6, value }]),
                    error => error instanceof TokenReplacementError &&
                        (error.code === 'bad-value-encoding' || error.code === 'bad-value'),
                    `value ${JSON.stringify(value)} should be rejected`
                );
            }
        });

        it('should reject a value that would merge with a neighbour into another token', () => {
            // tokens: number "1", number "-2"; replacing "-2" with "3"
            // would produce the single number "13"
            assert.throws(
                () => replaceTokens('a{--x:1-2}', [{ offset: 7, value: '3' }]),
                error => error instanceof TokenReplacementError && error.code === 'token-stream-changed'
            );
        });

        it('should keep adjacent idents separated', () => {
            const { css } = replaceTokens('a{--gap: one two}', [
                { offset: 10, value: 'three' }
            ]);

            assert.strictEqual(css, 'a{--gap: three two}');
            assert.deepStrictEqual(
                tokenTexts(css).filter(text => text.startsWith('ident')),
                ['ident-token:a', 'ident-token:--gap', 'ident-token:three', 'ident-token:two']
            );
        });

        it('should reject a stale plan when the source changed', () => {
            const plan = createReplacementPlan('a{width:10px}', [
                { offset: 8, value: '20px' }
            ]);

            // same source still works
            assert.strictEqual(
                applyReplacementPlan('a{width:10px}', plan).css,
                'a{width:20px}'
            );

            // changed source rejects the old plan
            assert.throws(
                () => applyReplacementPlan('a{width:11px}', plan),
                error => error instanceof TokenReplacementError && error.code === 'stale-plan'
            );
            assert.throws(
                () => applyReplacementPlan('a { width:10px}', plan),
                error => error instanceof TokenReplacementError && error.code === 'stale-plan'
            );
        });

        it('should not mutate a source AST', () => {
            const css = 'a { width: 10px; }';
            const ast = parse(css, { positions: true });
            const snapshot = JSON.stringify(ast);

            replaceTokens(css, [{ start: 11, end: 15, value: '20px' }]);

            assert.strictEqual(JSON.stringify(ast), snapshot);
        });
    });

    describe('fingerprint()', () => {
        it('should change with the source', () => {
            assert.notStrictEqual(fingerprint('a{width:10px}'), fingerprint('a{width:11px}'));
            assert.strictEqual(fingerprint('a{width:10px}'), fingerprint('a{width:10px}'));
        });
    });

    describe('fixtures', () => {
        it('before.css + plan.json should produce after.css', () => {
            const before = fs.readFileSync('fixtures/token-replace/before.css', 'utf-8');
            const after = fs.readFileSync('fixtures/token-replace/after.css', 'utf-8');
            const plan = JSON.parse(fs.readFileSync('fixtures/token-replace/plan.json', 'utf-8'));

            assert.strictEqual(applyReplacementPlan(before, plan).css, after);
        });

        it('plan-invalid.json should be rejected', () => {
            const before = fs.readFileSync('fixtures/token-replace/before.css', 'utf-8');
            const plan = JSON.parse(fs.readFileSync('fixtures/token-replace/plan-invalid.json', 'utf-8'));

            assert.throws(
                () => replaceTokens(before, plan.edits),
                error => error instanceof TokenReplacementError && error.code === 'syntax-mismatch'
            );
        });
    });
});
