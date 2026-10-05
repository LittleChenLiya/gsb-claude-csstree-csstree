import assert from 'assert';
import { lexer } from 'css-tree';

describe('Lexer match failure report', () => {
    it('should not change default match output', () => {
        const mismatch = lexer.matchProperty('margin', '1px 2px 3px 4px 5px');
        const match = lexer.matchProperty('margin', '1px 2px');

        assert.strictEqual('report' in mismatch, false);
        assert.strictEqual('report' in match, false);
        assert.strictEqual(mismatch.matched, null);
        assert.strictEqual(mismatch.error.name, 'SyntaxMatchError');
        assert.strictEqual(mismatch.error.mismatchOffset, 16);
        assert.notStrictEqual(match.matched, null);
        assert.strictEqual(match.error, null);
    });

    it('should locate an extra trailing token by a CSS byte offset', () => {
        const { matched, error, report } = lexer.matchProperty('margin', '1px 2px 3px 4px 5px', { report: true });

        // a matched prefix must not be reported as a full value match
        assert.strictEqual(matched, null);
        assert.strictEqual(error.name, 'SyntaxMatchError');

        assert.strictEqual(report.status, 'mismatch');
        assert.strictEqual(report.offset, 16); // byte offset of "5px" in the original CSS
        assert.strictEqual(report.token, '5px');
        assert.strictEqual(report.matchedPrefix, '1px 2px 3px 4px ');
        assert.strictEqual(report.rest, '5px');
        assert.deepStrictEqual(report.expected, [
            { token: 'end of value', kind: 'end', via: ['<\'margin\'>'] }
        ]);
    });

    it('should keep offsets in original CSS bytes', () => {
        const { report } = lexer.matchProperty('margin', '1px  2px   3px 4px 5px', { report: true });

        assert.strictEqual(report.offset, 19);
        assert.strictEqual(report.css.slice(report.offset), '5px');
        assert.strictEqual(report.token, '5px');
    });

    it('should merge expectations of branches probed at the same furthest position', () => {
        const { report } = lexer.matchProperty('margin', '1px 2px foo', { report: true });

        assert.strictEqual(report.status, 'mismatch');
        assert.strictEqual(report.offset, 8);
        assert.strictEqual(report.token, 'foo');

        // every expectation keeps the source syntax of its branch
        assert.deepStrictEqual(report.expected, [
            { token: 'end of value', kind: 'end', via: ['<\'margin\'>'] },
            { token: '<length>', kind: 'type', via: ['<length-percentage>'] },
            { token: '<percentage>', kind: 'type', via: ['<length-percentage>'] },
            { token: 'anchor-size()', kind: 'function', via: ['<\'margin-top\'>'] },
            { token: 'auto', kind: 'keyword', via: ['<\'margin-top\'>'] }
        ]);
    });

    it('should merge expectations of css-wide keywords and property syntax passes', () => {
        const { report } = lexer.matchProperty('margin', 'foo', { report: true });

        assert.strictEqual(report.offset, 0);

        const byToken = new Map(report.expected.map(entry => [entry.token, entry]));

        // both candidate passes failed at the same position, sources are preserved
        assert.deepStrictEqual(byToken.get('initial').via, ['css-wide-keywords']);
        assert.deepStrictEqual(byToken.get('auto').via, ['<\'margin-top\'>']);
        assert.deepStrictEqual(byToken.get('<length>').via, ['<length-percentage>']);
    });

    it('should mark a value with var() as pending, not passed', () => {
        const { matched, error, report } = lexer.matchProperty('margin', 'var(--gap) 4px', { report: true });

        assert.strictEqual(matched, null);
        assert.strictEqual(error.message, 'Matching for a tree with var() is not supported');
        assert.deepStrictEqual(report, {
            status: 'pending',
            reason: 'value contains var(), matching is not decidable'
        });
    });

    it('should report a full match as match', () => {
        const { matched, error, report } = lexer.matchProperty('margin', '1px 2px', { report: true });

        assert.notStrictEqual(matched, null);
        assert.strictEqual(error, null);
        assert.deepStrictEqual(report, { status: 'match' });
    });

    it('should skip a report for large values', () => {
        const value = new Array(40).fill('1px').join(' ');
        const { report } = lexer.matchProperty('margin', value, { report: true });

        assert.deepStrictEqual(report, {
            status: 'skipped',
            reason: 'value is too large for a failure report'
        });
    });

    it('should work for Lexer#match() with a custom syntax', () => {
        const { matched, report } = lexer.match('<length> | <color>', 'solid', { report: true });

        assert.strictEqual(matched, null);
        assert.strictEqual(report.status, 'mismatch');
        assert.strictEqual(report.offset, 0);
        assert.strictEqual(report.token, 'solid');

        const tokens = report.expected.map(entry => entry.token);
        assert.ok(tokens.includes('<length>'));
        assert.ok(tokens.includes('<hex-color>'));
    });

    it('should work for Lexer#matchType()', () => {
        const { report } = lexer.matchType('length', 'foo', { report: true });

        assert.strictEqual(report.status, 'mismatch');
        assert.deepStrictEqual(report.expected, [
            { token: '<length>', kind: 'type', via: ['<length>'] }
        ]);
    });
});
