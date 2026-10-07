# Value normalization

> Added as an opt-in, conservative numeric normalization. When no option is
> enabled the function is a no-op, so the regular `parse()`/`generate()` flow
> is unaffected.

```js
import { parse, generate, normalize } from 'css-tree';

const ast = parse('.a { margin: 0px 10px; width: calc(100% - -0px); }');
normalize(ast, { zeroUnit: true });
console.log(generate(ast));
// .a{margin:0 10px;width:calc(100% - -0px)}
```

## normalize(ast, options)

Applies a conservative numeric normalization to declaration values and returns
the same AST. All changes are performed on the AST and the output is produced
by the regular AST generator — no string replacement on the source is involved.

Options:

- `zeroUnit: boolean` (default: `false`) — drop the unit on an unsigned zero
  dimension (e.g. `0px` → `0`) only when the property grammar allows a unitless
  zero. The check is syntax based: the property grammar is matched against `0`
  via the lexer, so e.g. `margin: 0px` is normalized (`<length>` allows a
  unitless zero) while `rotate: 0deg` is kept as is (`<angle>` does not).

The normalization is deliberately conservative:

- values inside CSS math functions (`calc()`, `min()`, `max()`, `clamp()`,
  `round()`, trigonometric/exponential functions, `abs()`, `sign()`, etc.) are
  never touched — in particular a negative zero such as `-0px` inside `calc()`
  is preserved, since its sign is observable in calculations and a unitless
  zero inside a math function would be a `<number>`, not a `<length>`;
- a signed zero (`-0`, `+0`) is preserved everywhere;
- custom property values are kept as unparsed text (Raw nodes) and are never
  rewritten.

When the option is not enabled, `normalize()` returns the AST unchanged:

```js
normalize(ast);                       // no-op
normalize(ast, { zeroUnit: false });  // no-op
```
