// Token-level replacement demo: prints before/after examples.
// Run: node scripts/token-replace.js   (or: npm run example:token-replace)
import {
    parse,
    walk,
    tokenReplace
} from '../lib/index.js';

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

function tokensOf(source, declaration) {
    return tokenReplace.tokenizeValue(
        source,
        declaration.value.loc.start.offset,
        declaration.value.loc.end.offset
    );
}

function example(title, fn) {
    console.log('## ' + title);

    try {
        fn();
    } catch (e) {
        console.log('   REJECTED: ' + e.message.split('\n')[0]);
    }

    console.log('');
}

function replace(source, pickEdits) {
    const declaration = declarationOf(source);
    const result = tokenReplace.replaceDeclaration(
        source,
        declaration,
        pickEdits(tokensOf(source, declaration))
    );

    console.log('   before: ' + source);
    console.log('   after:  ' + result.source);

    return result;
}

const byText = (tokens, text) => tokens.find(t => t.text === text);

console.log('Token-level replacement examples (css-tree tokenReplace)\n');

example('1. Legal numeric replacement: width 10px -> 20px', () => {
    replace('a { width: 10px }', tokens => [{
        token: byText(tokens, '10px'),
        value: '20px'
    }]);
});

example('2. Illegal replacement is rejected: width 10px -> red (not a <length>)', () => {
    replace('a { width: 10px }', tokens => [{
        token: byText(tokens, '10px'),
        value: 'red'
    }]);
});

example('3. Invalid color is rejected: color red -> #xyz', () => {
    replace('a { color: red }', tokens => [{
        token: byText(tokens, 'red'),
        value: '#xyz'
    }]);
});

example('4. Comments and unselected tokens stay byte for byte', () => {
    replace('a { width: /* min */ 10px  /* max */ }', tokens => [{
        token: byText(tokens, '10px'),
        value: '20px'
    }]);
});

example('5. Look-alike words inside strings are never touched', () => {
    replace('a { content: "10px"; width: 10px }', tokens => [{
        token: byText(tokens, '10px'),
        value: '20px'
    }]);
});

example('6. Adjacent identifiers are separated when encoded', () => {
    replace('a { font-family: foo }', tokens => [{
        token: byText(tokens, 'foo'),
        value: ['hello', 'world'] // not "helloworld"
    }]);
});

example('7. New value is encoded so it does not turn into another token', () => {
    replace('a { font-family: foo }', tokens => [{
        token: byText(tokens, 'foo'),
        value: ['2px'] // stays an identifier: \32 px, not a dimension
    }]);
});

example('8. Overlapping plans are rejected up front', () => {
    const source = 'a { width: 10px }';
    const declaration = declarationOf(source);
    const dimension = byText(tokensOf(source, declaration), '10px');

    tokenReplace.replaceDeclaration(source, declaration, [
        { token: dimension, value: '20px' },
        { token: dimension, value: '30px' }
    ]);
});

example('9. A plan is bound to its source: stale plans are rejected', () => {
    const source = 'a { width: 10px }';
    const declaration = declarationOf(source);
    const dimension = byText(tokensOf(source, declaration), '10px');
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

    console.log('   before: ' + source);
    console.log('   after:  ' + tokenReplace.applyReplacementPlan(plan, source));
    console.log('   applying the same plan to "a { width: 11px }":');

    tokenReplace.applyReplacementPlan(plan, 'a { width: 11px }'); // throws
});

example('10. The source AST is never mutated in place', () => {
    const source = 'a { width: 10px }';
    const ast = parse(source, { positions: true });
    let declaration = null;

    walk(ast, node => {
        if (node.type === 'Declaration') {
            declaration = node;
        }
    });

    const result = tokenReplace.replaceDeclaration(source, declaration, [{
        token: byText(tokensOf(source, declaration), '10px'),
        value: '20px'
    }]);

    console.log('   before:        ' + source);
    console.log('   after:         ' + result.source);
    console.log('   AST unchanged: ' + (JSON.stringify(ast) === JSON.stringify(parse(source, { positions: true }))));
});
