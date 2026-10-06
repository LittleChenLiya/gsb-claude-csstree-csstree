import assert from 'assert';
import { lexer } from 'css-tree';

describe('lexer match report', () => {
    it('should locate an extra tail token in a margin value', () => {
        const value = '1px 2px 3px 4px 5px';
        const result = lexer.matchPropertyReport('margin', value);

        // a matched prefix must not be reported as a full value match
        assert.strictEqual(result.status, 'mismatch');
        assert.strictEqual(result.matched, null);
        assert(result.error instanceof Error);

        // the report points to the tail token, offset is in the original CSS source
        assert.strictEqual(result.report.position.token, '5px');
        assert.strictEqual(result.report.position.offset, value.indexOf('5px'));
        assert(result.report.expected.some(entry => entry.category === 'end'));
    });

    it('should merge expectations of two candidate branches and keep sources', () => {
        const result = lexer.matchReport('<length> | <percentage>', 'red');

        assert.strictEqual(result.status, 'mismatch');
        assert.strictEqual(result.report.position.offset, 0);
        assert.strictEqual(result.report.position.token, 'red');

        const expected = result.report.expected.map(entry => entry.value).sort();
        assert.deepStrictEqual(expected, ['length', 'percentage']);

        for (const entry of result.report.expected) {
            assert(entry.sources.some(source => source.includes(entry.value)));
        }
    });

    it('should keep every source when the same expectation comes from different branches', () => {
        const result = lexer.matchReport('<length> | <length-percentage>', 'red');
        const length = result.report.expected.find(entry => entry.value === 'length');

        assert.deepStrictEqual(length.sources.slice().sort(), [
            '<length>',
            '<length-percentage> > <length>'
        ].sort());
    });

    it('should report a value with var() as undecided, not as passed', () => {
        const result = lexer.matchPropertyReport('margin', 'var(--gap) 1px');

        assert.strictEqual(result.status, 'undecided');
        assert.strictEqual(result.matched, null);
        assert(/var\(\)/.test(result.reason));
    });

    it('should report a fully matched value as matched', () => {
        const result = lexer.matchPropertyReport('margin', '1px 2px');

        assert.strictEqual(result.status, 'matched');
        assert(result.matched !== null);
        assert.strictEqual(result.error, null);
        assert.strictEqual(result.report, null);
    });

    it('should not build a detailed report for large values', () => {
        const value = new Array(300).fill('1px').join(' ');
        const result = lexer.matchPropertyReport('margin', value);

        assert.strictEqual(result.report, null);
        assert(/too large/.test(result.note));
    });

    it('should not change the default match output', () => {
        const match = lexer.matchProperty('margin', '1px 2px');

        assert.deepStrictEqual(Object.keys(match).sort(), [
            'error',
            'getTrace',
            'isKeyword',
            'isProperty',
            'isType',
            'iterations',
            'matched'
        ].sort());

        const mismatch = lexer.matchProperty('margin', '1px 2px 3px 4px 5px');

        assert.strictEqual(mismatch.matched, null);
        assert.strictEqual(mismatch.error.name, 'SyntaxMatchError');
        assert(!('report' in mismatch));
        assert(!('status' in mismatch));
    });
});
