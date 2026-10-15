import { emitProlog, prolog } from "../languages/prolog.ts"

export const family = prolog.program(function*() {
  const parent = yield* prolog.facts("parent", [
    [prolog.atom("alice"), prolog.atom("bob")],
    [prolog.atom("bob"), prolog.atom("carol")],
  ])
  const ancestor = yield* prolog.rule("ancestor", ["X", "Y"], function*(x, y) {
    yield* parent(x, y)
  })
  yield* prolog.rule(ancestor, ["X", "Y"], function*(x, y) {
    const z = yield* prolog.variable("Z")
    yield* parent(x, z)
    yield* ancestor(z, y)
  })
})

if (import.meta.main) console.log(emitProlog(family))
