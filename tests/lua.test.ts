import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { type Binding, emitLua, lua } from "../languages/lua.ts"

const runtime = ["lua", "lua5.4", "lua5.3", "luajit"].find((command) => spawnSync(command, ["-v"]).status === 0)
const run = (source: string): string => {
  assert.ok(runtime)
  const result = spawnSync(runtime, ["-"], { input: source, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

const sumProgram = lua.program(function*() {
  const sum = yield* lua.fn("sum", [lua.param("count", lua.number)], lua.number, function*(count) {
    const total = yield* lua.let("total", lua.literal(0))
    const i = yield* lua.let("i", lua.literal(0))
    yield* lua.while(lua.less(i, count), function*() {
      yield* lua.assign(total, lua.add(total, i))
      yield* lua.assign(i, lua.add(i, lua.literal(1)))
    })
    yield* lua.return(total)
  })
  yield* lua.run(lua.call(lua.print, lua.call(sum, lua.literal(10))))
})

test("Lua emits a sum loop and a print call", () => {
  assert.equal(
    emitLua(sumProgram),
    [
      "local function sum(count)",
      "  local total = 0",
      "  local i = 0",
      "  while i < count do",
      "    total = total + i",
      "    i = i + 1",
      "  end",
      "  return total",
      "end",
      "print(sum(10))",
    ].join("\n"),
  )
})

test("Lua executes a sum loop", { skip: runtime ? false : "Lua runtime not installed" }, () => {
  assert.equal(run(emitLua(sumProgram)), "45\n")
})

test("Lua preserves binding identity, captures, and sanitizes names", () => {
  const source = emitLua(lua.program(function*() {
    const outer = yield* lua.let("end", lua.literal(7))
    const fn = yield* lua.fn("1 bad-name", [], lua.number, function*() {
      const inner = yield* lua.let("end", outer)
      yield* lua.if(lua.less(inner, lua.literal(10)), function*() {
        const local = yield* lua.let("print", lua.literal(1))
        yield* lua.assign(outer, lua.add(outer, local))
      }, function*() {
        yield* lua.assign(outer, lua.literal(0))
      })
      yield* lua.return(outer)
    })
    yield* lua.run(lua.call(lua.print, lua.call(fn)))
  }))
  assert.match(source, /local _end = 7/)
  assert.match(source, /local function _1_bad_name\(\)/)
  assert.match(source, /local _end_2 = _end/)
  assert.match(source, /local print_2 = 1/)
  if (runtime) assert.equal(run(source), "8\n")
})

test("Lua rejects escaped branch bindings and undeclared parameters", () => {
  let escaped: Binding<"number"> | undefined
  const program = lua.program(function*() {
    yield* lua.if(lua.literal(true), function*() {
      escaped = yield* lua.let("hidden", lua.literal(1))
    })
    assert.ok(escaped)
    yield* lua.run(lua.call(lua.print, escaped))
  })
  assert.throws(() => emitLua(program), /outside its lexical scope: hidden/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.run(lua.call(lua.print, lua.param("missing", lua.number)))
    })), /outside its lexical scope: missing/)
})

test("Lua preserves right-associated arithmetic and string bytes", () => {
  const text = "quote \" slash \\ newline\n nul\u00001\t café 😀"
  const source = emitLua(lua.program(function*() {
    yield* lua.run(lua.call(lua.print, lua.add(lua.literal(1e20), lua.add(lua.literal(-1e20), lua.literal(1)))))
    yield* lua.run(lua.call(lua.print, lua.literal(text)))
  }))
  assert.match(source, /100000000000000000000 \+ \(-100000000000000000000 \+ 1\)/)
  assert.ok(source.includes("\\\" slash \\\\ newline\\010 nul\\0001\\009"))
  if (runtime) {
    const output = run(source)
    assert.match(output, /^0(?:\.0)?\n/)
    assert.equal(output.slice(output.indexOf("\n") + 1), `${text}\n`)
  }
})

test("Lua rejects unsupported values and invalid statement contexts", () => {
  assert.throws(() => lua.literal(Infinity), /finite numbers/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.run(lua.call(lua.print, lua.literal("\ud800")))
    })), /unpaired surrogate/)
  assert.throws(() => lua.run(lua.literal(1)), /must be calls/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.return(lua.literal(1))
    })), /inside a function/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.fn("wrong", [], lua.number, function*() {
        yield* lua.return(lua.literal("no"))
      })
    })), /return type mismatch/)
})

test("Lua checks call arity and parameter types", () => {
  lua.program(function*() {
    const fn = yield* lua.fn("identity", [lua.param("x", lua.number)], lua.number, function*(x) {
      yield* lua.return(x)
    })
    assert.throws(() => lua.call(fn), /do not match parameters/)
    assert.throws(() => lua.call(fn, lua.literal("x")), /do not match parameters/)
  })
})

test("Lua permits an early return followed by other statements", () => {
  const source = emitLua(lua.program(function*() {
    const fn = yield* lua.fn("early", [], lua.number, function*() {
      yield* lua.return(lua.literal(3))
      yield* lua.return(lua.literal(4))
    })
    yield* lua.run(lua.call(lua.print, lua.call(fn)))
  }))
  assert.match(source, /do return 3 end\n  return 4/)
  if (runtime) assert.equal(run(source), "3\n")
})

test("Lua rejects function assignments in the DSL and AST", () => {
  const program = lua.program(function*() {
    const f = yield* lua.fn("f", [], lua.number, function*() {
      yield* lua.return(lua.literal(1))
    })
    const g = yield* lua.fn("g", [], lua.string, function*() {
      yield* lua.return(lua.literal("text"))
    })
    assert.throws(() => {
      // @ts-expect-error function bindings cannot be assignment targets
      lua.assign(f, g)
    }, /function assignments are not supported/)
    yield { kind: "assign", binding: f, value: g }
  })
  assert.throws(() => emitLua(program), /function assignments are not supported/)
})

test("Lua rejects non-nil functions that may fall through", () => {
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.fn("empty", [], lua.number, function*() {})
    })), /non-nil function may fall through/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.fn("oneSide", [lua.param("condition", lua.boolean)], lua.number, function*(condition) {
        yield* lua.if(condition, function*() {
          yield* lua.return(lua.literal(1))
        })
      })
    })), /non-nil function may fall through/)
  assert.throws(() =>
    emitLua(lua.program(function*() {
      yield* lua.fn("loop", [], lua.number, function*() {
        yield* lua.while(lua.literal(true), function*() {
          yield* lua.return(lua.literal(1))
        })
      })
    })), /non-nil function may fall through/)
})

test("Lua accepts returns in both branches and nil fallthrough", () => {
  const source = emitLua(lua.program(function*() {
    const choose = yield* lua.fn("choose", [lua.param("condition", lua.boolean)], lua.number, function*(condition) {
      yield* lua.if(condition, function*() {
        yield* lua.return(lua.literal(1))
      }, function*() {
        yield* lua.return(lua.literal(2))
      })
    })
    const empty = yield* lua.fn("empty", [], lua.nil, function*() {})
    yield* lua.run(lua.call(lua.print, lua.call(choose, lua.literal(true)), lua.call(choose, lua.literal(false))))
    const value = yield* lua.let("value", lua.call(empty))
    yield* lua.run(lua.call(lua.print, value))
  }))
  assert.match(source, /if condition then\n    return 1\n  else\n    return 2\n  end/)
  if (runtime) assert.equal(run(source), "1\t2\nnil\n")
})
