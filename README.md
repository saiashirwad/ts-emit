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

Verification checks types and runs emitted programs in all three runtimes.
