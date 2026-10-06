# Explicit token-level replacement (before / after)

`lib/token-replace` replaces single tokens (number, dimension, percentage
or ident) located by their **real lexer ranges**. Unselected tokens and
comments are preserved byte for byte, look-alike words inside strings are
never touched, overlapping edits are rejected up front, a replacement is
only accepted when the result still matches the declaration syntax, and a
plan is bound to the source text it was created for (a changed source
rejects the stale plan). No AST is mutated – the output is produced by
splicing the original source and validated against a freshly parsed AST.

## Command

```console
$ node scripts/token-replace.js fixtures/token-replace/before.css fixtures/token-replace/plan.json
```

or via npm:

```console
$ npm run token-replace -- fixtures/token-replace/before.css fixtures/token-replace/plan.json
```

## Before (`before.css`)

```css
/* theme tokens - comments stay untouched */
button {
    width: 10px; /* fixed hit area */
    content: "10px";
    border: solid red;
}
```

## Plan (`plan.json`)

```json
{
    "edits": [
        { "start": 65, "end": 69, "value": "20px" },
        { "start": 125, "end": 130, "value": "dashed" }
    ]
}
```

(`offset` may be used instead of an exact `start`/`end` pair; the plan
above also carries a `source` fingerprint of `before.css`.)

## After (`after.css`)

```css
/* theme tokens - comments stay untouched */
button {
    width: 20px; /* fixed hit area */
    content: "10px";
    border: dashed red;
}
```

Note that the comment and the `"10px"` string (a look-alike of the
replaced dimension) are byte-identical to the input.

## Rejections

- `width: 10px` → `red` is rejected (`syntax-mismatch`), see
  `plan-invalid.json`:

  ```console
  $ node scripts/token-replace.js fixtures/token-replace/before.css fixtures/token-replace/plan-invalid.json
  token-replace: [syntax-mismatch] edit #0: value "red" does not match the syntax of declaration "width": Mismatch
  ```

- an edit targeting the `"10px"` string or a comment is rejected
  (`not-replaceable`);
- overlapping edits are rejected (`overlap`) before anything is applied;
- a value that would glue itself to a neighbour into another token
  (e.g. replacing `-2` in `--x: 1-2` with `3`, producing the single
  number `13`) is rejected (`token-stream-changed`); adjacent idents
  stay separated because the whitespace between them is preserved;
- applying a plan after the source text changed is rejected
  (`stale-plan`) – create a new plan for the new source.
