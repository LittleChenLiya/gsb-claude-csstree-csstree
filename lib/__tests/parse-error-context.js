import assert from 'assert';
import { parse } from 'css-tree';

const throwOnParseError = {
    onParseError: e => {
        throw e;
    }
};

function getParseError(source, options) {
    let error = null;

    assert.throws(
        () => parse(source, { ...throwOnParseError, ...options }),
        (e) => {
            error = e;
            return true;
        },
        'Should throw a parse error'
    );

    assert(error instanceof SyntaxError, 'Should be a CSS parse error');
    assert.strictEqual(error.name, 'SyntaxError');

    return error;
}

// reference line/column computation (1-based, UTF-16 code units,
// CRLF/CR/LF/FF count as a single line break each)
function offsetToLineColumn(source, offset) {
    const lines = source.slice(0, offset).split(/\r\n?|\n|\f/);

    return {
        line: lines.length,
        column: lines[lines.length - 1].length + 1
    };
}

function hasLoneSurrogate(str) {
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);

        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = str.charCodeAt(i + 1);

            if (next < 0xDC00 || next > 0xDFFF) {
                return true;
            }

            i++;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }

    return false;
}

function errorContextLine(error) {
    const entry = error.context.lines.find(({ line }) => line === error.line);

    assert(entry, 'context should contain the error line');

    return entry.text;
}

// the pointer should indicate the exact character at error.offset
// in the (possibly truncated) context line
function assertPointerAligned(error, source) {
    const text = errorContextLine(error);
    const pointerIndex = error.context.pointer.column - 1;

    assert.strictEqual(error.context.pointer.line, error.line);

    if (error.offset < source.length && !/[\r\n\f]/.test(source[error.offset])) {
        assert.strictEqual(
            text.charAt(pointerIndex),
            source.charAt(error.offset),
            'pointer should indicate the character at error.offset'
        );
    } else {
        // error position is at a line break or at EOF,
        // the pointer should indicate the position right after the line content
        assert.strictEqual(pointerIndex, text.replace(/…$/, '').length);
    }

    // the caret in the rendered fragment should be aligned with the pointer as well
    const fragmentLines = error.sourceFragment().split('\n');
    const caretLineIndex = fragmentLines.findIndex(line => line.includes('^'));

    assert.notStrictEqual(caretLineIndex, -1, 'fragment should contain a caret');

    const textStartIndex = fragmentLines[caretLineIndex - 1].indexOf('|') + 1;

    assert.strictEqual(
        fragmentLines[caretLineIndex].indexOf('^') - textStartIndex,
        pointerIndex
    );
}

describe('parse error source context', () => {
    it('regression: default interface output is unchanged', () => {
        const error = getParseError('/**/\n.\nfoo');

        assert.strictEqual(error.formattedMessage,
            'Parse error: Identifier is expected\n' +
            '    1 |/**/\n' +
            '    2 |.\n' +
            '--------^\n' +
            '    3 |foo'
        );
        assert.strictEqual(error.sourceFragment(),
            '    2 |.\n' +
            '--------^'
        );
        assert.strictEqual(error.sourceFragment(3),
            '    1 |/**/\n' +
            '    2 |.\n' +
            '--------^\n' +
            '    3 |foo'
        );

        // a small source is kept on the error as is
        assert.strictEqual(error.source, '/**/\n.\nfoo');

        // position properties are consistent with the offset
        assert.deepStrictEqual(
            { line: error.line, column: error.column },
            offsetToLineColumn('/**/\n.\nfoo', error.offset)
        );
    });

    it('regression: CRLF and LF produce the same formatted message', () => {
        const lfError = getParseError('/**/\n.\nfoo');
        const crlfError = getParseError('/**/\r\n.\r\nfoo');

        assert.strictEqual(crlfError.formattedMessage, lfError.formattedMessage);
        assert.strictEqual(crlfError.message, lfError.message);
        assert.strictEqual(crlfError.line, lfError.line);
        assert.strictEqual(crlfError.column, lfError.column);
    });

    it('should indicate the error column with CRLF, CJK and emoji on the error line', () => {
        const source = 'a {\r\n  color: 😀#;\r\n}\r\n';
        const error = getParseError(source);

        assert.strictEqual(error.message, 'Hex or identifier is expected');
        assert.strictEqual(error.offset, source.indexOf(';'));
        assert.deepStrictEqual(
            { line: error.line, column: error.column },
            { line: 2, column: 13 }
        );
        assert.deepStrictEqual(
            { line: error.line, column: error.column },
            offsetToLineColumn(source, error.offset)
        );

        const text = errorContextLine(error);

        // the context line is a single line with no line breaks, emoji is kept intact
        assert(!/[\r\n\f]/.test(text));
        assert(text.includes('😀'));
        assert(!hasLoneSurrogate(text));

        assertPointerAligned(error, source);
    });

    it('should point after the line content when the error offset is on a CRLF', () => {
        const source = 'a 😀.\r\n';
        const error = getParseError(source);

        // error offset is on the trailing CR of the line
        assert.strictEqual(source[error.offset], '\r');
        assert.deepStrictEqual(
            { line: error.line, column: error.column },
            offsetToLineColumn(source, error.offset)
        );

        const text = errorContextLine(error);

        assert(text.includes('😀'));
        assert(!hasLoneSurrogate(text));
        assertPointerAligned(error, source);
    });

    it('should truncate a very long single line and keep the pointer aligned', () => {
        const source = '.long {' + 'x'.repeat(1500) + '#;}';
        const error = getParseError(source);

        assert.strictEqual(error.message, 'Colon is expected');
        assert.strictEqual(error.offset, source.indexOf('#'));
        assert.deepStrictEqual(
            { line: error.line, column: error.column },
            offsetToLineColumn(source, error.offset)
        );

        // context is bounded: a single truncated line with cut markers
        assert.strictEqual(error.context.lines.length, 1);

        const text = errorContextLine(error);

        assert(text.length <= 100, 'context line should be truncated (got ' + text.length + ')');
        assert(text.startsWith('…'));
        assert(!hasLoneSurrogate(text));
        assertPointerAligned(error, source);

        // the whole stylesheet should not be stored on the error
        assert.notStrictEqual(error.source, source);
        assert(error.source.length <= 100, 'source excerpt should be bounded (got ' + error.source.length + ')');
        assert(error.source.includes('…'));
    });

    it('should not split a surrogate pair when truncating', () => {
        // the truncation window ends in the middle of an emoji run
        const source = '.f {' + 'a'.repeat(200) + '#;b' + '😀'.repeat(100) + ';}';
        const error = getParseError(source);

        assert.strictEqual(error.offset, source.indexOf('#'));

        const text = errorContextLine(error);

        assert(text.length <= 100, 'context line should be truncated (got ' + text.length + ')');
        assert(!hasLoneSurrogate(text), 'truncation should not split a surrogate pair');
        assertPointerAligned(error, source);
    });

    it('should respect a configurable context length limit', () => {
        const source = '.long {' + 'x'.repeat(1500) + '#;}';
        const defaultError = getParseError(source);
        const limitedError = getParseError(source, { errorContextMaxLength: 40 });

        // error class and position are not affected by the option
        assert(limitedError instanceof SyntaxError);
        assert.strictEqual(limitedError.name, 'SyntaxError');
        assert.strictEqual(limitedError.message, defaultError.message);
        assert.strictEqual(limitedError.offset, defaultError.offset);
        assert.strictEqual(limitedError.line, defaultError.line);
        assert.strictEqual(limitedError.column, defaultError.column);

        // ... but the retained context is smaller
        const text = errorContextLine(limitedError);

        assert(text.length <= 40, 'context line should be truncated to the limit (got ' + text.length + ')');
        assert(limitedError.source.length <= 40, 'source excerpt should be bounded (got ' + limitedError.source.length + ')');
        assertPointerAligned(limitedError, source);

        // every rendered line respects the limit as well
        for (const line of limitedError.formattedMessage.split('\n')) {
            assert(line.length <= 45, 'rendered line should be bounded (got ' + line.length + ')');
        }
    });

    it('should keep a bounded context window for multi-line sources', () => {
        const source =
            '/* 😀 */\r\n'.repeat(40) +
            '.broken 😀#;\r\n' +
            '/* tail */\r\n'.repeat(40);
        const error = getParseError(source);

        assert(source.length > 500, 'source should exceed the context budget');

        // at most 2 lines around the error line are retained
        assert(error.context.lines.length <= 5);
        assert(error.context.lines.some(({ line }) => line === error.line));
        assert(error.source.length < source.length);
        assert(error.source.length <= 5 * 100);
        assertPointerAligned(error, source);
    });

    it('should provide the context on errors delivered via onParseError', () => {
        const errors = [];

        parse('{a: 1!; foo; b: 2}', {
            context: 'block',
            onParseError: error => errors.push(error)
        });

        assert.strictEqual(errors.length, 2);

        for (const error of errors) {
            assert(error instanceof SyntaxError);
            assert(Array.isArray(error.context.lines));
            assert(error.context.lines.length > 0);
            assert.strictEqual(typeof error.sourceFragment(), 'string');
        }
    });
});
