// Explicit failure reporting for lexer matching.
//
// A report is built from the facts collected during a real match attempt
// (no re-matching is involved to guess a failure reason):
// - the furthest consumed position (in the original CSS bytes);
// - the token categories expected by the branches probed at that position;
// - the source syntax of every probed branch.
//
// Reports are collected for small values only (see MATCH_REPORT_TOKEN_LIMIT),
// and only when explicitly requested via the `report` option, so the default
// match output is left unchanged.

// Only values with a small number of tokens get a failure report
export const MATCH_REPORT_TOKEN_LIMIT = 64;

export function formatSyntaxRef(syntax) {
    if (!syntax) {
        return null;
    }

    switch (syntax.type) {
        case 'Type':
            return '<' + syntax.name + '>';

        case 'Property':
            return '<\'' + syntax.name + '\'>';

        default:
            return syntax.name ? String(syntax.name) : String(syntax.type);
    }
}

// Merge expectations probed at the furthest consumed position.
// Expectations with the same token category are merged into a single entry,
// while the source syntax of every branch is preserved in `via`.
function mergeExpectations(expectations, furthest) {
    const merged = new Map();

    for (const { tokenIndex, expected, kind, via } of expectations) {
        if (tokenIndex !== furthest) {
            continue;
        }

        const key = kind + ':' + expected;
        let entry = merged.get(key);

        if (!entry) {
            entry = {
                token: expected,
                kind,
                via: []
            };
            merged.set(key, entry);
        }

        const source = formatSyntaxRef(via);

        if (source !== null && !entry.via.includes(source)) {
            entry.via.push(source);
        }
    }

    return [...merged.values()];
}

export function buildMismatchReport({ tokens, longestMatch, expectations }) {
    // Reconstruct the CSS from tokens; tokenization is lossless, so offsets
    // in the reconstructed string are the offsets in the original CSS
    let css = '';
    const offsets = [];

    for (const token of tokens) {
        offsets.push(css.length);
        css += token.value;
    }

    // The furthest position the matcher has actually probed
    let furthest = longestMatch;

    for (const { tokenIndex } of expectations) {
        if (tokenIndex > furthest) {
            furthest = tokenIndex;
        }
    }

    const offset = furthest < tokens.length ? offsets[furthest] : css.length;

    return {
        status: 'mismatch',
        css,
        offset,
        token: furthest < tokens.length ? tokens[furthest].value : null,
        matchedPrefix: css.slice(0, offset),
        rest: css.slice(offset),
        expected: mergeExpectations(expectations, furthest)
    };
}
