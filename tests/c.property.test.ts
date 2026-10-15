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
type Operand = Integer & { value: bigint }
type Case = { left: Operand; right: Operand; operation: "add" | "less" }

const integers: Integer[] = [8, 16, 32, 64].flatMap((bits) => [
  { bits: bits as Bits, signed: true },
  { bits: bits as Bits, signed: false },
])
const minimum = (type: Integer) => type.signed ? -(1n << BigInt(type.bits - 1)) : 0n
const maximum = (type: Integer) => (1n << BigInt(type.bits - (type.signed ? 1 : 0))) - 1n
const promote = (type: Integer): Integer => type.bits < 32 ? { bits: 32, signed: true } : type

const commonType = (left: Integer, right: Integer): Integer => {
  const a = promote(left)
  const b = promote(right)
  if (a.signed === b.signed) return a.bits >= b.bits ? a : b
  const signed = a.signed ? a : b
  const unsigned = a.signed ? b : a
  if (unsigned.bits >= signed.bits) return unsigned
  if (maximum(signed) >= maximum(unsigned)) return signed
  return { bits: signed.bits, signed: false }
}
const convert = (value: bigint, type: Integer) => type.signed ? value : BigInt.asUintN(type.bits, value)
const oracle = ({ left, right, operation }: Case) => {
  const common = commonType(left, right)
  const a = convert(BigInt(left.value), common)
  const b = convert(BigInt(right.value), common)
  if (operation === "less") return { type: { bits: 32, signed: true } as Integer, value: a < b ? 1n : 0n }
  const sum = a + b
  if (common.signed && (sum < minimum(common) || sum > maximum(common))) return undefined
  return { type: common, value: convert(sum, common) }
}

const operand = fc.constantFrom(...integers).chain((type) => {
  const min = minimum(type)
  const max = maximum(type)
  return fc.oneof(
    fc.constantFrom(min, min + 1n, max - 1n, max, 0n, 1n, ...(type.signed ? [-1n] : [])),
    fc.bigInt({ min, max }),
  ).map((value): Operand => ({ ...type, value }))
})
const arithmeticCase = fc.record({
  left: operand,
  right: operand,
  operation: fc.constantFrom("add" as const, "less" as const),
}).filter((item) => oracle(item) !== undefined)
const typeNode = (type: Integer): TypeNode<C, Int, { readonly kind: "int-type" }> =>
  type.signed ? { 8: c.i8, 16: c.i16, 32: c.i32, 64: c.i64 }[type.bits] : { 8: c.u8, 16: c.u16, 32: c.u32, 64: c.u64 }[type.bits]
const options: fc.Parameters<unknown> = {
  seed: Number(process.env.FC_SEED ?? 20261015),
  numRuns: 20,
}
if (process.env.FC_PATH !== undefined) options.path = process.env.FC_PATH

test("C integer arithmetic agrees with an independent BigInt oracle", () => {
  fc.assert(
    fc.property(fc.array(arithmeticCase, { minLength: 1, maxLength: 16 }), (cases) => {
      const expected = cases.map((item) => oracle(item)!)
      const program = c.program(function*() {
        for (const [index, item] of cases.entries()) {
          const resultType = expected[index]!.type
          yield* c.fn(`case_${index}`, [], typeNode(resultType), function*() {
            // Bind narrow operands: bare 8/16-bit literals would instead have C's plain int type.
            const left = yield* c.let(
              "left",
              c.literal(typeNode(item.left), item.left.bits === 64 ? item.left.value : Number(item.left.value)),
              typeNode(item.left),
            )
            const right = yield* c.let(
              "right",
              c.literal(typeNode(item.right), item.right.bits === 64 ? item.right.value : Number(item.right.value)),
              typeNode(item.right),
            )
            const expression: Expr<C, Int, { readonly kind: "add" | "ternary" | "less" | "ref" | "literal" | "int-type" }> = item.operation === "add"
              ? c.add(left, right)
              : c.ternary(c.less(left, right), c.literal(c.i32, 1), c.literal(c.i32, 0))
            assert.deepEqual(expression.type, typeNode(resultType))
            yield* c.return(expression)
          })
        }
      })
      const calls = expected.map(({ type }, index) =>
        `  printf("%" ${type.signed ? "PRId64" : "PRIu64"} "\\n", (${type.signed ? "int64_t" : "uint64_t"})case_${index}());`
      ).join("\n")
      const source = `${emitC(program)}
#include <limits.h>
#include <inttypes.h>
#include <stdio.h>
_Static_assert(CHAR_BIT == 8, "oracle requires 8-bit bytes");
_Static_assert(sizeof(int) * CHAR_BIT == 32 && INT_MAX == INT32_MAX, "oracle requires 32-bit int");
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
        // Mixed-sign comparisons are the subject of this property, not accidental application code.
        const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-Wno-sign-compare", path, "-o", executable], {
          encoding: "utf8",
          timeout: 10_000,
        })
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

test("C integer literals reject non-integral and out-of-range numbers", () => {
  fc.assert(
    fc.property(fc.constantFrom(...integers), fc.constantFrom(NaN, Infinity, -Infinity, 0.5, 2 ** 53), (type, value) => {
      assert.throws(() => c.literal(typeNode(type), value), /cannot hold the literal/)
    }),
    options,
  )
})
