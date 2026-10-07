import { createCustomError } from '../utils/create-custom-error.js';

const MAX_LINE_LENGTH = 100;
const OFFSET_CORRECTION = 60;
const TAB_REPLACEMENT = '    ';
const EXTRA_LINES = 2;         // how many lines around the error line to keep in the context
const ELLIPSIS = '…'; // horizontal ellipsis
const LINE_BREAK = /\r\n?|\n|\f/;

function isLowSurrogate(code) {
    return code >= 0xDC00 && code <= 0xDFFF;
}

// Substring by UTF-16 offsets that never splits a surrogate pair (e.g. an emoji).
// Returns the substring and the actually used start offset, which may be moved
// back by one to keep a leading surrogate pair intact.
function safeSubstr(str, start, length) {
    if (start > 0 && start < str.length && isLowSurrogate(str.charCodeAt(start))) {
        start--;
    }

    let end = Math.min(start + Math.max(length, 0), str.length);

    if (end > start && end < str.length && isLowSurrogate(str.charCodeAt(end))) {
        end--;
    }

    return [str.substring(start, end), start];
}

// Cut a bounded context out of the source around the error position:
// a few lines around the error line, each truncated to maxLineLength.
// The truncation keeps the error position visible and never splits
// a surrogate pair, so the pointer column stays aligned with the text.
function buildContext(source, line, column, baseLine, baseColumn, maxLineLength) {
    const prelines = '\n'.repeat(Math.max(baseLine - 1, 0));
    const precolumns = ' '.repeat(Math.max(baseColumn - 1, 0));
    const lines = (prelines + precolumns + source).split(LINE_BREAK);
    const errorLineIndex = Math.min(Math.max(line - 1, 0), lines.length - 1);
    const offsetCorrection = Math.round(maxLineLength * OFFSET_CORRECTION / MAX_LINE_LENGTH);

    // column correction according to replaced tabs before the column
    let pointerColumn = column +
        (TAB_REPLACEMENT.length - 1) * (lines[errorLineIndex].substr(0, column - 1).match(/\t/g) || []).length;

    let cutLeft = 0;

    if (pointerColumn > maxLineLength) {
        cutLeft = pointerColumn - offsetCorrection + 3;
        pointerColumn = offsetCorrection - 2;
    }

    const from = Math.max(errorLineIndex - EXTRA_LINES, 0);
    const to = Math.min(errorLineIndex + EXTRA_LINES, lines.length - 1);
    const contextLines = [];
    const excerptLines = [];

    for (let i = from; i <= to; i++) {
        const rawLine = lines[i];
        const expandedLine = rawLine.replace(/\t/g, TAB_REPLACEMENT);
        const [text, start] = safeSubstr(expandedLine, cutLeft, maxLineLength - 2);

        if (i === errorLineIndex && start !== cutLeft) {
            // keep the pointer aligned when the cut position was
            // moved to not split a surrogate pair
            pointerColumn += cutLeft - start;
        }

        contextLines.push({
            line: i + 1,
            text:
                (cutLeft > 0 && expandedLine.length > start ? ELLIPSIS : '') +
                text +
                (expandedLine.length > start + maxLineLength - 1 ? ELLIPSIS : '')
        });

        // raw excerpt (no tab expansion) to be used as a bounded source slice
        const [excerptText, excerptStart] = safeSubstr(rawLine, cutLeft, maxLineLength - 2);

        excerptLines.push(
            (cutLeft > 0 && rawLine.length > excerptStart ? ELLIPSIS : '') +
            excerptText +
            (rawLine.length > excerptStart + maxLineLength - 1 ? ELLIPSIS : '')
        );
    }

    return {
        lines: contextLines,
        pointer: {
            line,
            column: pointerColumn
        },
        totalLines: lines.length,
        excerpt: excerptLines.join('\n')
    };
}

export function SyntaxError(message, source, offset, line, column, baseLine = 1, baseColumn = 1, contextMaxLength) {
    const maxLineLength = Number.isInteger(contextMaxLength) && contextMaxLength > 0
        ? contextMaxLength
        : MAX_LINE_LENGTH;
    const context = buildContext(source, line, column, baseLine, baseColumn, maxLineLength);
    const maxSourceLength = maxLineLength * (EXTRA_LINES * 2 + 1);

    function sourceFragment(extraLines) {
        extraLines = isNaN(extraLines) ? 0 : extraLines;

        const endBound = Math.min(line + extraLines, context.totalLines + 1);
        const maxNumLength = Math.max(4, String(endBound).length) + 1;
        const fragment = [];

        for (const entry of context.lines) {
            if (entry.line < line - extraLines || entry.line > line + extraLines) {
                continue;
            }

            fragment.push(String(entry.line).padStart(maxNumLength) + ' |' + entry.text);

            if (entry.line === line) {
                fragment.push(new Array(context.pointer.column + maxNumLength + 2).join('-') + '^');
            }
        }

        return fragment
            .join('\n')
            .replace(/^(\s+\d+\s+\|\n)+/, '')
            .replace(/\n(\s+\d+\s+\|)+$/, '');
    }

    const error = Object.assign(createCustomError('SyntaxError', message), {
        // don't store the whole stylesheet on the error;
        // keep the source as is when it fits the context budget,
        // otherwise store a bounded excerpt around the error position
        source: source.length <= maxSourceLength ? source : context.excerpt,
        offset,
        line,
        column,
        context: {
            lines: context.lines,
            pointer: context.pointer
        },
        sourceFragment,
        get formattedMessage() {
            return (
                `Parse error: ${message}\n` +
                sourceFragment(EXTRA_LINES)
            );
        }
    });

    return error;
}
