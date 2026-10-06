// Maximum number of tokens in a value to build a detailed failure report for.
// Collecting every failed branch attempt has a cost, so explicit failure
// reports are built for small values only.
export const MAX_REPORT_TOKENS = 100;

// Offsets are defined in the original CSS source: since tokens are
// contiguous slices of the input, an offset of a token is a sum of
// all previous token lengths
function tokenOffsets(tokens) {
    const offsets = new Array(tokens.length + 1);
    let offset = 0;

    for (let i = 0; i < tokens.length; i++) {
        offsets[i] = offset;
        offset += tokens[i].value.length;
    }

    offsets[tokens.length] = offset;

    return offsets;
}

function syntaxRef({ type, name }) {
    return type === 'Property' ? `<'${name}'>` : `<${name}>`;
}

// Record a real failed branch attempt during matching (no re-matching later).
// The source is a chain of currently open syntax references (Type/Property),
// i.e. the actual branch the matcher was in when the attempt failed.
export function recordMatchAttempt(collect, tokenIndex, category, value, syntaxStack) {
    const source = [];

    for (let item = syntaxStack; item !== null; item = item.prev) {
        const syntax = item.syntax;

        if (syntax && (syntax.type === 'Type' || syntax.type === 'Property')) {
            source.unshift(syntaxRef(syntax));
        }
    }

    collect.push({
        tokenIndex,
        category,
        value,
        source
    });
}

// Build an explicit failure report from the attempts recorded during matching:
// - the furthest consumed position (in the original CSS source offsets)
// - expectations of all branches failed at that position, merged by expectation
//   but keeping the source of every branch
// - the raw list of real tried branches
export function buildFailureReport(tokens, attempts, longestMatch, rootSource) {
    const offsets = tokenOffsets(tokens);

    // de-duplicate identical attempts (same position, expectation and source)
    const tried = [];
    const seen = new Set();

    for (const attempt of attempts) {
        const source = attempt.source.length > 0
            ? attempt.source.join(' > ')
            : rootSource;
        const key = `${attempt.tokenIndex} ${attempt.category} ${attempt.value} ${source}`;

        if (!seen.has(key)) {
            seen.add(key);
            tried.push({
                offset: offsets[attempt.tokenIndex],
                tokenIndex: attempt.tokenIndex,
                expected: {
                    category: attempt.category,
                    value: attempt.value
                },
                source
            });
        }
    }

    // the furthest position the matcher reached
    let furthest = longestMatch;

    for (const attempt of attempts) {
        if (attempt.tokenIndex > furthest) {
            furthest = attempt.tokenIndex;
        }
    }

    // merge expectations of all branches failed at the furthest position,
    // keep the source of every branch
    const expectedMap = new Map();

    for (const item of tried) {
        if (item.tokenIndex !== furthest) {
            continue;
        }

        const key = item.expected.category + ':' + item.expected.value;
        let entry = expectedMap.get(key);

        if (!entry) {
            entry = {
                category: item.expected.category,
                value: item.expected.value,
                sources: []
            };
            expectedMap.set(key, entry);
        }

        if (!entry.sources.includes(item.source)) {
            entry.sources.push(item.source);
        }
    }

    return {
        position: {
            offset: offsets[furthest],
            tokenIndex: furthest,
            token: furthest < tokens.length ? tokens[furthest].value : null
        },
        expected: [...expectedMap.values()],
        tried: tried.sort((a, b) => a.tokenIndex - b.tokenIndex)
    };
}
