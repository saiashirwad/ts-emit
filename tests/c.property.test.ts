import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import fc from "fast-check"

import { type Bits, type C, c, emitC, type I16, type I32, type I64, type I8, type U16, type U32, type U64, type U8 } from "../languages/c.ts"
import type { Expr, TypeNode } from "../src/index.ts"

type Int = I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64

type Integer = { bits: Bits; signed: boolean }
type Case = Integer & { left: bigint; right: bigint; operation: "add" | "less" | "sum-less" }

const integers: Integer[] = [8, 16, 32, 64].flatMap((bits) => [
  { bits: bits as Bits, signed: true },
  { bits: bits as Bits, signed: false },
])
const minimum = (type: Integer) => type.signed ? -(1n << BigInt(type.bits - 1)) : 0n
const maximum = (type: Integer) => (1n << BigInt(type.bits - (type.signed ? 1 : 0))) - 1n
const wrap = (value: bigint, type: Integer) => type.signed ? BigInt.asIntN(type.bits, value) : BigInt.asUintN(type.bits, value)
const oracle = (item: Case) => {
  if (item.operation === "less") return { type: { bits: 32, signed: true } as Integer, value: item.left < item.right ? 1n : 0n }
  const sum = item.left + item.right
  // Signed overflow at 32 and 64 bits is undefined in C. Narrower sums are cast back, which wraps on gcc and clang.
  if (item.signed && item.bits >= 32 && (sum < minimum(item) || sum > maximum(item))) return undefined
  if (item.operation === "sum-less") return { type: { bits: 32, signed: true } as Integer, value: wrap(sum, item) < item.right ? 1n : 0n }
  return { type: item as Integer, value: wrap(sum, item) }
}

const value = (type: Integer) =>
  fc.oneof(
    fc.constantFrom(minimum(type), minimum(type) + 1n, maximum(type) - 1n, maximum(type), 0n, 1n, ...(type.signed ? [-1n] : [])),
    fc.bigInt({ min: minimum(type), max: maximum(type) }),
  )
const arithmeticCase = fc.constantFrom(...integers).chain((type) =>
  fc.record({ left: value(type), right: value(type), operation: fc.constantFrom("add" as const, "less" as const, "sum-less" as const) })
    .map((item): Case => ({ ...type, ...item }))
).filter((item) => oracle(item) !== undefined)
const typeNode = (type: Integer): TypeNode<C, Int, { readonly kind: "int-type" }> =>
  type.signed ? { 8: c.i8, 16: c.i16, 32: c.i32, 64: c.i64 }[type.bits] : { 8: c.u8, 16: c.u16, 32: c.u32, 64: c.u64 }[type.bits]
const options: fc.Parameters<unknown> = {
  seed: Number(process.env.FC_SEED ?? 20261015),
  numRuns: 20,
}
if (process.env.FC_PATH !== undefined) options.path = process.env.FC_PATH

test("C integer literals reject non-integral and out-of-range numbers", () => {
  fc.assert(
    fc.property(fc.constantFrom(...integers), fc.constantFrom(NaN, Infinity, -Infinity, 0.5, 2 ** 53), (type, value) => {
      assert.throws(() => c.literal(typeNode(type), value), /cannot hold the literal/)
    }),
    options,
  )
})

test("C integer arithmetic on equal types agrees with a BigInt oracle", () => {
  fc.assert(
    fc.property(fc.array(arithmeticCase, { minLength: 1, maxLength: 16 }), (cases) => {
      const expected = cases.map((item) => oracle(item)!)
      const program = c.program(function*() {
        for (const [index, item] of cases.entries()) {
          yield* c.fn(`case_${index}`, [], typeNode(expected[index]!.type), function*() {
            const literal = (value: bigint) => c.literal(typeNode(item), item.bits === 64 ? value : Number(value))
            const left = yield* c.let("left", literal(item.left), typeNode(item))
            const right = yield* c.let("right", literal(item.right), typeNode(item))
            const expression: Expr<C, Int, { readonly kind: "add" | "ternary" | "less" | "ref" | "literal" | "int-type" }> = item.operation === "add"
              ? c.add(left, right)
              : item.operation === "less"
              ? c.ternary(c.less(left, right), c.literal(c.i32, 1), c.literal(c.i32, 0))
              : c.ternary(c.less(c.add(left, right), right), c.literal(c.i32, 1), c.literal(c.i32, 0))
            yield* c.return(expression)
          })
        }
      })
      const calls = expected.map(({ type }, index) =>
        `  printf("%" ${type.signed ? "PRId64" : "PRIu64"} "\\n", (${type.signed ? "int64_t" : "uint64_t"})case_${index}());`
      ).join("\n")
      const source = `${emitC(program)}
#include <inttypes.h>
#include <stdio.h>
int main(void) {
${calls}
  return 0;
}
`
      const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-property-"))
      try {
        const path = join(directory, "program.c")
        const executable = join(directory, "program")
        writeFileSync(path, source)
        const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", path, "-o", executable], { encoding: "utf8", timeout: 10_000 })
        assert.ifError(compiled.error)
        assert.equal(compiled.status, 0, `${compiled.stderr}\n${source}`)
        const executed = spawnSync(executable, [], { encoding: "utf8", timeout: 5_000 })
        assert.ifError(executed.error)
        assert.equal(executed.status, 0, executed.stderr)
        assert.deepEqual(executed.stdout.trim().split("\n"), expected.map(({ value }) => String(value)), source)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }),
    options,
  )
})

test("C array initializers preserve numeric bounds and ASCII elements", () => {
  fc.assert(
    fc.property(fc.tuple(...integers.map((type) => value(type))), fc.integer({ min: 0, max: 127 }), (values, code) => {
      const program = c.program(function*() {
        for (const [index, type] of integers.entries()) {
          const raw = type.bits === 64 ? values[index]! : Number(values[index]!)
          const array = c.array(typeNode(type), 2)
          yield* c.let(`values_${index}`, c.literal(array, [raw, raw]), array)
        }
        const chars = c.array(c.char, 2)
        yield* c.let("letters", c.literal(chars, [String.fromCharCode(code), "\n"]), chars)
        const doubles = c.array(c.f64, 2)
        yield* c.let("doubles", c.literal(doubles, [-0, 1.5]), doubles)
      })
      const checks = integers.map((type, index) => {
        const expected = values[index]!
        const spelling = expected === -(1n << 63n)
          ? "INT64_MIN"
          : `${expected < 0n ? "-" : ""}${type.signed ? "INT64_C" : "UINT64_C"}(${expected < 0n ? -expected : expected})`
        return `values_${index}[0] == ${spelling} && values_${index}[1] == ${spelling}`
      })
      const source = `${emitC(program)}
#include <math.h>
int main(void) {
  return ${checks.join(" && ")} && letters[0] == ${code} && letters[1] == 10
    && signbit(doubles[0]) && doubles[1] == 1.5 ? 0 : 1;
}
`
      const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-array-"))
      try {
        const path = join(directory, "program.c")
        const executable = join(directory, "program")
        writeFileSync(path, source)
        const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", path, "-o", executable], { encoding: "utf8", timeout: 10_000 })
        assert.ifError(compiled.error)
        assert.equal(compiled.status, 0, `${compiled.stderr}\n${source}`)
        const executed = spawnSync(executable, [], { encoding: "utf8", timeout: 5_000 })
        assert.ifError(executed.error)
        assert.equal(executed.status, 0, source)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }),
    options,
  )
})
