import assert from "node:assert/strict"
import { test } from "node:test"

import fc from "fast-check"

import { type Bits, type C, c, type I16, type I32, type I64, type I8, type U16, type U32, type U64, type U8 } from "../languages/c.ts"
import type { TypeNode } from "../src/index.ts"

type Int = I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64

type Integer = { bits: Bits; signed: boolean }
const integers: Integer[] = [8, 16, 32, 64].flatMap((bits) => [
  { bits: bits as Bits, signed: true },
  { bits: bits as Bits, signed: false },
])
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
