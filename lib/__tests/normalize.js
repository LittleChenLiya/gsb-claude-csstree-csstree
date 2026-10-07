import assert from 'assert';
import {
    parse,
    generate,
    normalize,
    lexer
} from 'css-tree';

const normalizeCss = (css, options, parseOptions) =>
    generate(normalize(parse(css, parseOptions), options));

describe('normalize()', () => {
    describe('zeroUnit option (conservative numeric normalization)', () => {
        it('should drop zero units on a regular margin when the grammar allows it', () => {
            const input = '.a { margin: 0px 10px 0em 0px; }';
            const actual = normalizeCss(input, { zeroUnit: true });

            assert.strictEqual(actual, '.a{margin:0 10px 0 0}');

            // the result must stay valid for the property grammar
            const declaration = parse('margin: 0 10px 0 0', { context: 'declaration' });
            assert.strictEqual(lexer.matchDeclaration(declaration).matched !== null, true);
        });

        it('should keep zero units when the grammar does not allow a unitless zero', () => {
            const input = '.a { rotate: 0deg; transition-duration: 0s; }';

            assert.strictEqual(
                normalizeCss(input, { zeroUnit: true }),
                '.a{rotate:0deg;transition-duration:0s}'
            );
        });

        it('should keep negative zero and zero units inside calc() and other math functions', () => {
            const input = '.a { width: calc(100% - -0px); margin: calc(0px + 1em) min(0em, 2px); }';

            assert.strictEqual(
                normalizeCss(input, { zeroUnit: true }),
                '.a{width:calc(100% - -0px);margin:calc(0px + 1em) min(0em,2px)}'
            );
        });

        it('should keep a signed zero outside of math functions as is', () => {
            const input = '.a { margin: -0px 1px +0em; }';

            assert.strictEqual(
                normalizeCss(input, { zeroUnit: true }),
                '.a{margin:-0px 1px+0em}'
            );
        });

        it('should not rewrite unparsed custom property values', () => {
            const input = '.a { --x: 0px -0px ; margin: 0px; }';
            const ast = parse(input);

            normalize(ast, { zeroUnit: true });

            // the Raw value of the custom property must stay byte-for-byte intact
            let customPropertyValue = null;
            let regularDeclaration = null;
            ast.children.first.block.children.forEach(node => {
                if (node.property === '--x') {
                    customPropertyValue = node.value;
                } else {
                    regularDeclaration = node;
                }
            });

            assert.strictEqual(customPropertyValue.type, 'Raw');
            assert.strictEqual(customPropertyValue.value, ' 0px -0px ');
            assert.strictEqual(generate(ast), '.a{--x: 0px -0px ;margin:0}');
            assert.strictEqual(lexer.matchDeclaration(regularDeclaration).matched !== null, true);
        });

        it('should normalize a declaration parsed in declaration context', () => {
            assert.strictEqual(
                normalizeCss('margin: 0px 0.0em', { zeroUnit: true }, { context: 'declaration' }),
                'margin:0 0.0'
            );
        });
    });

    describe('when the option is not enabled', () => {
        const input = '.a { margin: 0px; width: calc(100% - -0px); --x: 0px -0px ; }';

        it('should be a no-op without options', () => {
            const ast = parse(input);

            assert.strictEqual(normalize(ast), ast);
            assert.strictEqual(generate(ast), '.a{margin:0px;width:calc(100% - -0px);--x: 0px -0px }');
        });

        it('should be a no-op with zeroUnit disabled', () => {
            const ast = parse(input);

            assert.strictEqual(normalize(ast, { zeroUnit: false }), ast);
            assert.strictEqual(generate(ast), '.a{margin:0px;width:calc(100% - -0px);--x: 0px -0px }');
        });

        it('should not affect the regular parse/generate interface', () => {
            assert.strictEqual(
                generate(parse(input)),
                '.a{margin:0px;width:calc(100% - -0px);--x: 0px -0px }'
            );
        });
    });
});
