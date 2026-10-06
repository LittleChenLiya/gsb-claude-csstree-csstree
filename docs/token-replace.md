# Token-level replacement

The `tokenReplace` module performs explicit token-level replacements in CSS
source text. It is designed for tools that need to change a number or an
identifier inside a declaration value while keeping everything else –
unselected tokens, whitespace and comments – byte for byte intact.

Import it from the main entry point:

```js
import { tokenReplace } from 'css-tree';
```

## How it works

1. Tokens are located with the real CSS lexer (`tokenizeValue()`), so a
   replacement range always matches a real token boundary. Look-alike words
   inside strings or comments can never be targeted – only `number`,
   `percentage`, `dimension` and `ident` tokens are replaceable.
2. A plan (`createReplacementPlan()`) validates the edits: overlapping
   ranges are rejected up front, the replacement is encoded so it can't
   merge into an adjacent token, and the resulting value is matched against
   the declaration grammar (`lexer.matchProperty()`). A result that no
   longer matches the property grammar is rejected.
3. Applying a plan (`applyReplacementPlan()`) splices the encoded
   replacements into the source text. A plan is bound to the exact source
   it was created from (length + hash fingerprint); applying it to a
   changed source is rejected as stale.
4. Nothing is mutated in place: `replaceDeclaration()` only reads the
   declaration node (property name and value location, requires
   `positions: true`) and returns new source text. Parse the result to get
   an updated AST.

## API

- `tokenizeValue(source, valueStart, valueEnd)` → tokens with absolute
  offsets, `text` and a `replaceable` flag
- `createReplacementPlan(source, edits, options)` → frozen plan;
  `edits` is a list of `{ token | start, end, value }` where `value` is a
  CSS string or an array of identifier strings; `options` accepts
  `property`, `value: { start, end }` and `lexer`
- `applyReplacementPlan(plan, source)` → new source text
- `replaceTokens(source, edits, options)` → `{ plan, source }`
- `replaceDeclaration(source, declaration, edits, options)` → `{ plan, source }`

## Before / after examples

Run them locally with `npm run example:token-replace`
(or `node scripts/token-replace.js`):

```
## 1. Legal numeric replacement: width 10px -> 20px
   before: a { width: 10px }
   after:  a { width: 20px }

## 2. Illegal replacement is rejected: width 10px -> red (not a <length>)
   REJECTED: Replacement doesn't match the grammar of "width": Mismatch

## 3. Invalid color is rejected: color red -> #xyz
   REJECTED: Replacement doesn't match the grammar of "color": Mismatch

## 4. Comments and unselected tokens stay byte for byte
   before: a { width: /* min */ 10px  /* max */ }
   after:  a { width: /* min */ 20px  /* max */ }

## 5. Look-alike words inside strings are never touched
   before: a { content: "10px"; width: 10px }
   after:  a { content: "10px"; width: 20px }

## 6. Adjacent identifiers are separated when encoded
   before: a { font-family: foo }
   after:  a { font-family: hello world }

## 7. New value is encoded so it does not turn into another token
   before: a { font-family: foo }
   after:  a { font-family: \32 px }

## 8. Overlapping plans are rejected up front
   REJECTED: Overlapping replacement ranges at 11..15 and 11..15

## 9. A plan is bound to its source: stale plans are rejected
   before: a { width: 10px }
   after:  a { width: 20px }
   applying the same plan to "a { width: 11px }":
   REJECTED: Stale plan: the source has changed since the plan was created

## 10. The source AST is never mutated in place
   before:        a { width: 10px }
   after:         a { width: 20px }
   AST unchanged: true
```

## Example

```js
import { parse, walk, tokenReplace } from 'css-tree';

const source = 'a { width: /* min */ 10px }';
const ast = parse(source, { positions: true });
let declaration = null;

walk(ast, node => {
    if (node.type === 'Declaration') {
        declaration = node;
    }
});

const tokens = tokenReplace.tokenizeValue(
    source,
    declaration.value.loc.start.offset,
    declaration.value.loc.end.offset
);
const dimension = tokens.find(token => token.text === '10px');

const { source: result } = tokenReplace.replaceDeclaration(source, declaration, [{
    token: dimension,
    value: '20px'
}]);

console.log(result); // a { width: /* min */ 20px }
```

## Tests

```
npm run test:token-replace
```
