import assert from 'assert';
import {
    parse,
    generate,
    walk,
    tokenize,
    tokenNames,
    tokenReplace
} from 'css-tree';

const BS = String.fromCharCode(92); // backslash

function declarationOf(source) {
    const ast = parse(source, { positions: true });
    let declaration = null;

    walk(ast, node => {
        if (node.type === 'Declaration') {
            declaration = node;
        }
    });

    return declaration;
}

function valueTokens(source, declaration) {
    return tokenReplace.tokenizeValue(
        source,
        declaration.value.loc.start.offset,
        declaration.value.loc.end.offset
    );
}

function tokenByText(tokens, text) {
    const token = tokens.find(t => t.text === text);

    assert(token, 'token "' + text + '" should exist');

    return token;
}

function replaceInDeclaration(source, pickEdits) {
    const declaration = declarationOf(source);
    const tokens = valueTokens(source, declaration);

    return tokenReplace.replaceDeclaration(source, declaration, pickEdits(tokens));
}

describe('tokenReplace', () => {
    describe('tokenizeValue()', () => {
        it('should locate tokens by real lexer ranges', () => {
            const source = 'a { width: 10px /* keep */ solid }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);

            for (const token of tokens) {
                assert.strictEqual(source.slice(token.start, token.end), token.text);
            }

            assert.deepStrictEqual(
                tokens.map(t => t.name),
                ['dimension-token', 'whitespace-token', 'comment-token', 'whitespace-token', 'ident-token', 'whitespace-token']
            );
            assert.strictEqual(tokens[0].replaceable, true);   // dimension
            assert.strictEqual(tokens[1].replaceable, false);  // whitespace
            assert.strictEqual(tokens[2].replaceable, false);  // comment
            assert.strictEqual(tokens[4].replaceable, true);   // ident
        });

        it('should mark string tokens as non-replaceable', () => {
            const source = 'a { content: "10px" }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);
            const string = tokenByText(tokens, '"10px"');

            assert.strictEqual(string.name, 'string-token');
            assert.strictEqual(string.replaceable, false);
        });
    });

    describe('createReplacementPlan() / applyReplacementPlan()', () => {
        it('should replace a dimension (width: 10px -> 20px)', () => {
            const result = replaceInDeclaration('a { width: 10px }', tokens => [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }]);

            assert.strictEqual(result.source, 'a { width: 20px }');
        });

        it('should reject a value that does not match the declaration grammar', () => {
            assert.throws(
                () => replaceInDeclaration('a { width: 10px }', tokens => [{
                    token: tokenByText(tokens, '10px'),
                    value: 'red'
                }]),
                /TokenReplaceError: Replacement doesn't match the grammar of "width"/
            );
        });

        it('should reject an invalid color', () => {
            assert.throws(
                () => replaceInDeclaration('a { color: red }', tokens => [{
                    token: tokenByText(tokens, 'red'),
                    value: '#xyz'
                }]),
                /Replacement doesn't match the grammar of "color"/
            );
        });

        it('should accept a valid color', () => {
            const result = replaceInDeclaration('a { color: red }', tokens => [{
                token: tokenByText(tokens, 'red'),
                value: 'rebeccapurple'
            }]);

            assert.strictEqual(result.source, 'a { color: rebeccapurple }');
        });

        it('should keep unselected tokens and comments byte for byte', () => {
            const source = 'a { width: /* before */ 10px  /* after */ }';
            const result = replaceInDeclaration(source, tokens => [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }]);

            assert.strictEqual(result.source, 'a { width: /* before */ 20px  /* after */ }');

            // every comment of the new source is byte identical to the original ones
            const comments = text => {
                const list = [];
                tokenize(text, (type, start, end) => {
                    if (tokenNames[type] === 'comment-token') {
                        list.push(text.slice(start, end));
                    }
                });
                return list;
            };

            assert.deepStrictEqual(comments(result.source), comments(source));
        });

        it('should not touch look-alike words inside strings', () => {
            const source = 'a { content: "10px"; width: 10px }';
            const result = replaceInDeclaration(source, tokens => [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }]);

            assert.strictEqual(result.source, 'a { content: "10px"; width: 20px }');
        });

        it('should refuse to target a range inside a string', () => {
            const source = 'a { content: "10px" }';
            const declaration = declarationOf(source);
            const start = source.indexOf('10px');

            assert.throws(
                () => tokenReplace.replaceDeclaration(source, declaration, [{
                    start,
                    end: start + 4,
                    value: '20px'
                }]),
                /No replaceable token/
            );
        });

        it('should reject overlapping plans up front', () => {
            const source = 'a { width: 10px }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);
            const dimension = tokenByText(tokens, '10px');

            assert.throws(
                () => tokenReplace.replaceDeclaration(source, declaration, [
                    { token: dimension, value: '20px' },
                    { token: dimension, value: '30px' }
                ]),
                /Overlapping replacement ranges/
            );
        });

        it('should apply several edits in one plan', () => {
            const result = replaceInDeclaration('a { border: 1px solid }', tokens => [
                { token: tokenByText(tokens, '1px'), value: '2px' },
                { token: tokenByText(tokens, 'solid'), value: 'dashed' }
            ]);

            assert.strictEqual(result.source, 'a { border: 2px dashed }');
        });

        it('should replace percentages and numbers', () => {
            assert.strictEqual(
                replaceInDeclaration('a { width: 50% }', tokens => [{
                    token: tokenByText(tokens, '50%'),
                    value: '75%'
                }]).source,
                'a { width: 75% }'
            );
            assert.strictEqual(
                replaceInDeclaration('a { z-index: 1 }', tokens => [{
                    token: tokenByText(tokens, '1'),
                    value: '2'
                }]).source,
                'a { z-index: 2 }'
            );
        });

        it('should keep !important and the rest of the declaration intact', () => {
            const result = replaceInDeclaration('a { width: 10px !important }', tokens => [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }]);

            assert.strictEqual(result.source, 'a { width: 20px !important }');
        });

        it('should reject a plan created for a different (stale) source', () => {
            const source = 'a { width: 10px }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);
            const dimension = tokenByText(tokens, '10px');
            const plan = tokenReplace.createReplacementPlan(source, [{
                token: dimension,
                value: '20px'
            }], {
                property: 'width',
                value: {
                    start: declaration.value.loc.start.offset,
                    end: declaration.value.loc.end.offset
                }
            });

            // the plan applies to the source it was created from
            assert.strictEqual(
                tokenReplace.applyReplacementPlan(plan, source),
                'a { width: 20px }'
            );

            // ... but is rejected once the original text has changed
            assert.throws(
                () => tokenReplace.applyReplacementPlan(plan, 'a { width: 11px }'),
                /Stale plan/
            );
            assert.throws(
                () => tokenReplace.applyReplacementPlan(plan, source + ' '),
                /Stale plan/
            );
        });

        it('should reject unknown properties since the result cannot be validated', () => {
            const source = 'a { unknown-prop: 1 }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);

            assert.throws(
                () => tokenReplace.replaceDeclaration(source, declaration, [{
                    token: tokenByText(tokens, '1'),
                    value: '2'
                }]),
                /TokenReplaceError/
            );
        });

        it('should produce a frozen plan', () => {
            const source = 'a { width: 10px }';
            const declaration = declarationOf(source);
            const tokens = valueTokens(source, declaration);
            const plan = tokenReplace.createReplacementPlan(source, [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }], {
                property: 'width',
                value: {
                    start: declaration.value.loc.start.offset,
                    end: declaration.value.loc.end.offset
                }
            });

            assert.strictEqual(Object.isFrozen(plan), true);
            assert.strictEqual(Object.isFrozen(plan.edits), true);
            assert.strictEqual(Object.isFrozen(plan.edits[0]), true);
        });
    });

    describe('encoding', () => {
        it('should separate adjacent identifiers in a list value', () => {
            const result = replaceInDeclaration('a { font-family: foo }', tokens => [{
                token: tokenByText(tokens, 'foo'),
                value: ['hello', 'world']
            }]);

            // a naive concatenation would produce a single "helloworld" identifier
            assert.strictEqual(result.source, 'a { font-family: hello world }');

            const tokensAfter = valueTokens(result.source, declarationOf(result.source))
                .filter(t => t.name === 'ident-token');

            assert.deepStrictEqual(tokensAfter.map(t => t.text), ['hello', 'world']);
        });

        it('should encode an identifier so it does not turn into another token', () => {
            const result = replaceInDeclaration('a { font-family: foo }', tokens => [{
                token: tokenByText(tokens, 'foo'),
                value: ['2px'] // as raw text this would be a dimension token
            }]);

            assert.strictEqual(result.source, 'a { font-family: ' + BS + '32 px }');

            const idents = valueTokens(result.source, declarationOf(result.source))
                .filter(t => t.name === 'ident-token');

            assert.strictEqual(idents.length, 1);
        });

        it('should separate an identifier that would merge with a following parenthesis', () => {
            // `1(2)` tokenizes as number, `(`, number, `)`;
            // replacing the number with `url` would produce a single url/function-token,
            // so the replacement is encoded with a separating whitespace
            const source = 'x: 1(2)';
            const tokens = tokenReplace.tokenizeValue(source, 3, 7);
            const number = tokenByText(tokens, '1');
            const plan = tokenReplace.createReplacementPlan(source, [{
                token: number,
                value: 'url'
            }], { value: { start: 3, end: 7 } });
            const result = tokenReplace.applyReplacementPlan(plan, source);

            assert.strictEqual(result, 'x: url (2)');

            const names = [];
            tokenize(result.slice(3), type => names.push(tokenNames[type]));
            assert.deepStrictEqual(names, [
                'ident-token',
                'whitespace-token',
                '(-token',
                'number-token',
                ')-token'
            ]);
        });

        it('should pad a value that would merge with a neighbour', () => {
            // `.foo` tokenizes as delim `.` + ident; replacing the ident
            // with `1` would produce a single number token `.1`
            const source = 'x: .foo';
            const tokens = tokenReplace.tokenizeValue(source, 3, 7);
            const ident = tokenByText(tokens, 'foo');
            const plan = tokenReplace.createReplacementPlan(source, [{
                token: ident,
                value: '1'
            }], { value: { start: 3, end: 7 } });

            assert.strictEqual(plan.edits[0].replacement, ' 1');
            assert.strictEqual(
                tokenReplace.applyReplacementPlan(plan, source),
                'x: . 1'
            );
        });
    });

    describe('replaceDeclaration()', () => {
        it('should not mutate the source AST', () => {
            const source = 'a { width: 10px; color: red }';
            const ast = parse(source, { positions: true });
            const snapshot = JSON.stringify(ast);
            const generated = generate(ast);
            let declaration = null;

            walk(ast, node => {
                if (node.type === 'Declaration' && node.property === 'width') {
                    declaration = node;
                }
            });

            const tokens = valueTokens(source, declaration);
            const result = tokenReplace.replaceDeclaration(source, declaration, [{
                token: tokenByText(tokens, '10px'),
                value: '20px'
            }]);

            assert.strictEqual(result.source, 'a { width: 20px; color: red }');
            assert.strictEqual(JSON.stringify(ast), snapshot);
            assert.strictEqual(generate(ast), generated);
        });

        it('should require a declaration parsed with positions', () => {
            const ast = parse('a { width: 10px }'); // no positions: true
            let declaration = null;

            walk(ast, node => {
                if (node.type === 'Declaration') {
                    declaration = node;
                }
            });

            assert.throws(
                () => tokenReplace.replaceDeclaration('a { width: 10px }', declaration, [{
                    start: 11,
                    end: 15,
                    value: '20px'
                }]),
                /positions: true/
            );
        });
    });
});
