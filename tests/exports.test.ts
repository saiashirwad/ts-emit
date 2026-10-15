import assert from "node:assert/strict"
import { test } from "node:test"

import { emit } from "@texoport/ts-emit"
import { c, cTarget, emitC } from "@texoport/ts-emit/languages/c"
import { emitLua, lua } from "@texoport/ts-emit/languages/lua"
import { emitProlog, prolog } from "@texoport/ts-emit/languages/prolog"

test("package entrypoints emit C, Lua, and Prolog", () => {
  const program = c.program(function*() {
    yield* c.fn("main", [], c.int(32), function*() {
      yield* c.return(c.literal(c.int(32), 0))
    })
  })
  assert.equal(emit(program, cTarget), "int32_t main(void) {\n  return 0;\n}")
  assert.equal(emitC(program), "#include <stdbool.h>\n#include <stdint.h>\n\nint32_t main(void) {\n  return 0;\n}\n")

  assert.equal(
    emitLua(lua.program(function*() {
      yield* lua.run(lua.call(lua.print, lua.literal(42)))
    })),
    "print(42)",
  )
  assert.equal(
    emitProlog(prolog.program(function*() {
      yield* prolog.facts("ready", [[]])
    })),
    "ready.",
  )
})
