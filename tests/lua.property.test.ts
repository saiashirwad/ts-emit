import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import fc from "fast-check"

import { type Binding, emitLua, type Expr, lua } from "../languages/lua.ts"

const parameters: fc.Parameters<unknown> = {
  numRuns: 30,
  seed: process.env.FC_SEED === undefined ? 20261015 : Number(process.env.FC_SEED),
}
if (process.env.FC_PATH !== undefined) parameters.path = process.env.FC_PATH
const runtime = ["lua", "lua5.4", "lua5.3", "luajit"].find((command) => spawnSync(command, ["-v"], { timeout: 5_000 }).status === 0)
const run = (source: string): Buffer => {
  assert.ok(runtime, "Lua runtime is required for property tests")
  const result = spawnSync(runtime, ["-"], { input: source, timeout: 5_000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr?.toString())
  return result.stdout
}
const batch = <T>(arbitrary: fc.Arbitrary<T>) => fc.array(arbitrary, { minLength: 1, maxLength: 12 })
const integer = fc.integer({ min: -100, max: 100 })

type Sum = number | { left: Sum; right: Sum }
const sums = (depth: number, leaf: fc.Arbitrary<number> = integer): fc.Arbitrary<Sum> =>
  depth === 0
    ? leaf
    : fc.oneof(leaf, fc.record({ left: sums(depth - 1, leaf), right: sums(depth - 1, leaf) }))
const evaluate = (sum: Sum): number => typeof sum === "number" ? sum : evaluate(sum.left) + evaluate(sum.right)
const expression = (sum: Sum): Expr<number> =>
  typeof sum === "number"
    ? lua.literal(sum)
    : lua.add(expression(sum.left), expression(sum.right))

test("Lua nested addition and comparison agree with exact integer evaluation", () => {
  fc.assert(
    fc.property(batch(fc.tuple(sums(3), sums(3))), (cases) => {
      const source = emitLua(lua.program(function*() {
        for (const [left, right] of cases) {
          yield* lua.run(lua.call(lua.print, lua.add(expression(left), expression(right))))
          yield* lua.run(lua.call(lua.print, lua.less(expression(left), expression(right))))
        }
      }))
      const expected = cases.map(([left, right]) => {
        const a = evaluate(left)
        const b = evaluate(right)
        return `${a + b}\n${a < b}\n`
      }).join("")
      assert.deepEqual(run(source), Buffer.from(expected))
    }),
    parameters,
  )
})

test("Lua preserves rounding-sensitive nested addition grouping", () => {
  fc.assert(
    fc.property(batch(sums(3, fc.constantFrom(1e20, -1e20, 1, -1, 0, 0.5))), (cases) => {
      const source = emitLua(lua.program(function*() {
        for (const [index, sum] of cases.entries()) {
          yield* lua.fn(`result_${index}`, [], lua.number, function*() {
            yield* lua.return(expression(sum))
          })
        }
      }))
      const checks = cases.map((sum, index) => {
        const expected = evaluate(sum)
        assert.ok(Number.isFinite(expected))
        return `assert(result_${index}() == ${expected})`
      }).join("\n")
      run(`${source}\n${checks}`)
    }),
    parameters,
  )
})

const names = fc.constantFrom<[string, string]>(
  ["end", "_end"],
  ["a-b", "a b"],
  ["print", "print"],
  ["1name", "_1name"],
  ["", "_"],
  ["café", "caf_"],
)

test("Lua preserves captures and binding identity through colliding names and branch scopes", () => {
  fc.assert(
    fc.property(batch(fc.tuple(names, integer, integer, integer)), (cases) => {
      const source = emitLua(lua.program(function*() {
        for (const [[first, second], initial, argument, delta] of cases) {
          const outer = yield* lua.let(first!, lua.literal(initial))
          const fn = yield* lua.fn(second!, [lua.param(first!, lua.number)], lua.number, function*(parameter) {
            const local = yield* lua.let(second!, lua.add(outer, parameter))
            yield* lua.if(lua.less(parameter, outer), function*() {
              const shadow = yield* lua.let(first!, lua.literal(delta))
              yield* lua.assign(outer, lua.add(local, shadow))
            }, function*() {
              const shadow = yield* lua.let(second!, lua.literal(delta))
              yield* lua.assign(outer, lua.add(outer, shadow))
            })
            yield* lua.return(lua.add(local, outer))
          })
          yield* lua.run(lua.call(lua.print, lua.call(fn, lua.literal(argument))))
          yield* lua.run(lua.call(lua.print, outer))
        }
      }))
      const expected = cases.map(([, initial, argument, delta]) => {
        const local = initial + argument
        const outer = argument < initial ? local + delta : initial + delta
        return `${local + outer}\n${outer}\n`
      }).join("")
      assert.deepEqual(run(source), Buffer.from(expected))
    }),
    parameters,
  )
})

const scalar = fc.oneof(
  fc.constantFrom(0, 10, 13, 9, 47, 92, 34, 48, 49, 57, 0xe9, 0x4e2d, 0x1f600, 0x10ffff),
  fc.integer({ min: 0, max: 0xd7ff }),
  fc.integer({ min: 0xe000, max: 0x10ffff }),
)
const text = fc.array(scalar, { maxLength: 40 }).map((codes) => String.fromCodePoint(...codes))

test("Lua string literals preserve Unicode and control bytes", () => {
  fc.assert(
    fc.property(batch(text), (cases) => {
      const source = emitLua(lua.program(function*() {
        for (const value of cases) yield* lua.run(lua.call(lua.print, lua.literal(value)))
      }))
      assert.deepEqual(run(source), Buffer.from(cases.map((value) => `${value}\n`).join("")))
    }),
    parameters,
  )
})

test("Lua rejects bindings escaping their lexical branch", () => {
  fc.assert(
    fc.property(batch(fc.tuple(names, integer)), (cases) => {
      for (const [[name], value] of cases) {
        let escaped: Binding<number> | undefined
        const program = lua.program(function*() {
          yield* lua.if(lua.literal(true), function*() {
            escaped = yield* lua.let(name!, lua.literal(value))
          })
          assert.ok(escaped)
          yield* lua.run(lua.call(lua.print, escaped))
        })
        assert.throws(() => emitLua(program), /outside its lexical scope/)
      }
    }),
    parameters,
  )
})

test("Lua rejects unpaired surrogates in string literals", () => {
  fc.assert(
    fc.property(batch(fc.tuple(text, fc.integer({ min: 0xd800, max: 0xdfff }))), (cases) => {
      for (const [prefix, surrogate] of cases) {
        const program = lua.program(function*() {
          yield* lua.run(lua.call(lua.print, lua.literal(prefix + String.fromCharCode(surrogate))))
        })
        assert.throws(() => emitLua(program), /unpaired surrogate/)
      }
    }),
    parameters,
  )
})
