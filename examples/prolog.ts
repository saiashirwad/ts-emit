import { emitProlog, prolog } from "../languages/prolog.ts"

export const family = prolog.program(
  prolog.fact(prolog.call("parent", prolog.atom("alice"), prolog.atom("bob"))),
  prolog.fact(prolog.call("parent", prolog.atom("bob"), prolog.atom("carol"))),
  prolog.rule(({ variable }) => {
    const x = variable("X")
    const y = variable("Y")
    return {
      head: prolog.call("ancestor", x, y),
      body: prolog.call("parent", x, y),
    }
  }),
  prolog.rule(({ variable }) => {
    const x = variable("X")
    const y = variable("Y")
    const z = variable("Z")
    return {
      head: prolog.call("ancestor", x, y),
      body: prolog.and(prolog.call("parent", x, z), prolog.call("ancestor", z, y)),
    }
  }),
)

if (import.meta.main) console.log(emitProlog(family))
