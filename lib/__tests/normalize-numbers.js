import assert from 'assert';
import {
    parse,
    generate,
    walk,
    lexer,
    normalizeNumbers
} from 'css-tree';

// small in-memory fixtures for the conservative numeric normalization
const fixtures = {
    margin: 'a { margin: 0px 10px -0.0em 0pt; }',
    calc: 'a { width: calc(100% - -0px); top: calc(-0 * 1px); }',
    customProperty: 'a { --gap: 0px -0px calc(-0 * 1px); }'
};

describe('normalizeNumbers()', () => {
    it('should be an opt-in feature: parse/generate stay unchanged by default', () => {
        for (const css of Object.values(fixtures)) {
            assert.strictEqual(generate(parse(css)), generate(parse(css)));
        }
        // original interfaces keep zero units and negative zero as is
        assert.strictEqual(
            generate(parse(fixtures.margin)),
            'a{margin:0px 10px -0.0em 0pt}'
        );
    });

    it('should drop zero units in a regular margin when the syntax allows', () => {
        const result = normalizeNumbers(parse(fixtures.margin));

        assert.strictEqual(result, 'a{margin:0 10px 0 0}');

        // the result must stay syntactically valid
        const declaration = parse(result).children.first.block.children.first;
        assert.ok(lexer.matchDeclaration(declaration).matched);
    });

    it('should preserve negative zero in calc() and other math functions', () => {
        const result = normalizeNumbers(parse(fixtures.calc));

        // nothing inside math functions is rewritten
        assert.strictEqual(result, generate(parse(fixtures.calc)));
        assert.ok(result.includes('calc(100% - -0px)'));
        assert.ok(result.includes('calc(-0*1px)'));
    });

    it('should not rewrite custom properties (unparsed text)', () => {
        const result = normalizeNumbers(parse(fixtures.customProperty));

        assert.strictEqual(result, 'a{--gap: 0px -0px calc(-0 * 1px)}');
    });

    it('should not rewrite Raw (unparsed) values', () => {
        // parseValue: false keeps the declaration value as unparsed Raw text
        const ast = parse('margin: 0px -0px', { context: 'declaration', parseValue: false });

        assert.strictEqual(ast.value.type, 'Raw');
        assert.strictEqual(normalizeNumbers(ast), 'margin:0px -0px');
    });

    it('should keep zero units when the grammar requires them', () => {
        // <time> requires a unit, so 0s must stay; margin accepts a bare 0
        assert.strictEqual(
            normalizeNumbers(parse('a { transition-duration: 0s; margin: 0s; }')),
            'a{transition-duration:0s;margin:0}'
        );
    });

    it('should canonicalize zero numbers outside math functions', () => {
        assert.strictEqual(
            normalizeNumbers(parse('a { margin: -0; opacity: 0.0; }')),
            'a{margin:0;opacity:0}'
        );
    });

    it('should operate through the AST, not string replacement', () => {
        const ast = parse(fixtures.margin);
        const result = normalizeNumbers(ast, { output: 'ast' });

        assert.strictEqual(result, ast); // same AST, mutated in place

        const dimensions = [];
        walk(ast, node => {
            if (node.type === 'Dimension' && parseFloat(node.value) === 0) {
                dimensions.push(node);
            }
        });
        assert.strictEqual(dimensions.length, 0);
        assert.strictEqual(generate(ast), 'a{margin:0 10px 0 0}');
    });

    it('should not touch zero percentages', () => {
        assert.strictEqual(
            normalizeNumbers(parse('a { background-position: 0% 0%; }')),
            'a{background-position:0% 0%}'
        );
    });
});
