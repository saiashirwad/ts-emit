# ts-emit

Build C, Prolog, and Lua programs from TypeScript.

```ts
import { c, emitC } from "@texoport/ts-emit/languages/c"

const program = c.program(function*() {
  yield* c.fn("main", [], c.int(32), function*() {
    yield* c.return(c.literal(c.int(32), 0))
  })
})

console.log(emitC(program))
```

Small language-specific builders, not complete language checkers. TypeScript is the builder language, not an output target.

See [`examples/c.ts`](examples/c.ts), [`examples/prolog.ts`](examples/prolog.ts), and [`examples/lua.ts`](examples/lua.ts). Run an example with `node examples/c.ts`.

## Checks

Use Node.js 24 or later and pnpm. Runtime tests require a C compiler (`cc`), SWI-Prolog (`swipl`), and Lua (`lua`).

```sh
pnpm install
pnpm verify
```

Verification checks types and runs emitted programs in all three runtimes. fast-check runtime properties use bounded batches and a fixed seed. Replay a failure with its reported seed and path:

```sh
FC_SEED=20261015 FC_PATH='0:1' node --test --test-name-pattern='property name' tests/lua.property.test.ts
```

Use the failing test's name, file, seed, and path.
