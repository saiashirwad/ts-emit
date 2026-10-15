import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  type C,
  c,
  type Converted,
  cTarget,
  emitC,
  type F64,
  type I32,
  type I64,
  type Ptr,
  type U16,
  type U32,
  type U64,
  type U8,
} from "../languages/c.ts"
import * as lang from "../src/index.ts"
import { assertType, type Equal } from "./typing.ts"

const i8 = (value: number) => c.literal(c.i8, value)
const i32 = (value: number) => c.literal(c.i32, value)
const u32 = (value: number) => c.literal(c.u32, value)
const f64 = (value: number) => c.literal(c.f64, value)

export const conversionContracts = () => {
  const sum = c.add(i8(1), i8(2))
  assertType<Equal<lang.Denotes<typeof sum>, I32>>()
  const mixed = c.add(u32(1), i32(2))
  assertType<Equal<lang.Denotes<typeof mixed>, U32>>()
  const wide = c.add(c.literal(c.i64, 1n), i8(2))
  assertType<Equal<lang.Denotes<typeof wide>, I64>>()
  const real = c.add(i32(1), f64(2))
  assertType<Equal<lang.Denotes<typeof real>, F64>>()
  const compared = c.less(i8(1), f64(2))
  assertType<Equal<lang.Denotes<typeof compared>, boolean>>()
  assertType<Equal<Converted<U8, U8>, I32>>()
  assertType<Equal<Converted<U16, I32>, I32>>()
  assertType<Equal<Converted<U16, U32>, U32>>()
  assertType<Equal<Converted<U32, I64>, I64>>()
  assertType<Equal<Converted<U64, I32>, U64>>()
  assertType<Equal<Converted<I64, U64>, U64>>()

  c.program(function*() {
    yield* c.fn("main", [], c.void, function*() {
      const n = yield* c.let("n", i8(1), c.i32)
      yield* c.let("wide", n, c.i64)
      // @ts-expect-error a C binding needs a declared type
      yield* c.let("untyped", n)
      yield* c.let("real", n, c.f64)
      yield* c.let("narrow", f64(2), c.i8)
      const p = yield* c.let("p", c.address(n), c.ptr(c.i32))
      const q = c.add(p, i32(1))
      assertType<Equal<lang.Denotes<typeof q>, Ptr<I32>>>()
      const flipped = c.add(i32(1), p)
      assertType<Equal<lang.Denotes<typeof flipped>, Ptr<I32>>>()
      yield* c.let("q", q, c.ptr(c.i32))
      yield* c.let("m", c.deref(p), c.i32)
      // @ts-expect-error int* to double* needs a cast in C
      yield* c.let("r", p, c.ptr(c.f64))
      // @ts-expect-error int32_t* to uint32_t* needs a cast in C
      yield* c.let("u", p, c.ptr(c.u32))
      // @ts-expect-error an int is not a pointer
      yield* c.let("s", n, c.ptr(c.i32))
      // @ts-expect-error a pointer is not arithmetic
      yield* c.let("t", p, c.i32)
      // @ts-expect-error only a pointer can be dereferenced
      c.deref(n)
      // @ts-expect-error two pointers cannot be added
      c.add(p, p)
      // @ts-expect-error a double cannot be added to a pointer
      c.add(p, f64(1))
      // @ts-expect-error a pointer cannot be compared with an int
      c.less(p, n)
      yield* c.while(c.less(n, i32(10)), function*() {
        yield* c.assign(n, c.add(n, i32(1)))
      })
      // @ts-expect-error a value is not assignable to a pointer binding
      yield* c.assign(p, n)
      const letter = yield* c.let("letter", c.literal(c.char, "a"), c.char)
      // @ts-expect-error a char is not an int
      yield* c.let("code", letter, c.i32)
      // @ts-expect-error an int is not a char
      yield* c.let("other", n, c.char)
      // @ts-expect-error a char is not arithmetic
      c.add(letter, i32(1))
      // @ts-expect-error chars cannot be compared yet
      c.less(letter, letter)
    })
  })
}

export const functionContracts = () => {
  c.program(function*() {
    const square = yield* c.fn("square", [c.param("x", c.i32)], c.i64, function*(x) {
      yield* c.if(c.less(x, i32(0)), function*() {
        yield* c.return(i32(0))
      })
      yield* c.return(c.add(x, x))
    })
    yield* c.fn("main", [], c.void, function*() {
      yield* c.let("nine", c.call(square, i32(3)), c.i64)
    })
    c.call(square, f64(3))
    const one = yield* c.let("one", i32(1), c.i32)
    // @ts-expect-error a pointer argument does not convert to an int parameter
    c.call(square, c.address(one))
    // @ts-expect-error too many arguments
    c.call(square, i32(1), i32(2))
    // @ts-expect-error too few arguments
    c.call(square)
    // @ts-expect-error a pointer is returned from a function declared to return an int
    yield* c.fn(
      "leak",
      [c.param("p", c.ptr(c.i32))],
      c.i32,
      function*(p) {
        yield* c.return(p)
      },
    )
  })
}

const counter = () =>
  c.program(function*() {
    yield* c.fn("count", [c.param("limit", c.i32)], c.i32, function*(limit) {
      const i = yield* c.let("i", i32(0), c.i32)
      yield* c.while(c.less(i, limit), function*() {
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(i)
    })
  })

test("emit requires a handler for every kind a program uses, nested kinds included", () => {
  const program = counter()
  assertType<
    Equal<
      typeof program,
      lang.Program<C, "function" | "int-type" | "let" | "literal" | "while" | "less" | "ref" | "assign" | "add" | "return">
    >
  >()
  const { less: _less, ...withoutLess } = cTarget.handlers
  lang.emit(program, lang.defineTarget(cTarget.naming, { ...withoutLess, less: cTarget.handlers.less, extra: () => "" }))
  // @ts-expect-error target has no handler for "less", which is only used in a nested while condition
  assert.throws(() => lang.emit(program, lang.defineTarget(cTarget.naming, withoutLess)), /target has no handler for "less"/)
})

test("the C target emits C source", () => {
  assert.equal(
    emitC(counter()),
    `#include <stdbool.h>
#include <stdint.h>

int32_t count(int32_t limit) {
  int32_t i = 0;
  while (i < limit) {
    i = i + 1;
  }
  return i;
}
`,
  )
  const pointers = c.program(function*() {
    yield* c.fn("main", [], c.i32, function*() {
      const x = yield* c.let("int", f64(2), c.f64)
      const p = yield* c.let("p", c.address(x), c.ptr(c.f64))
      yield* c.let("byte", c.literal(c.u8, 255), c.u8)
      yield* c.return(c.add(c.deref(p), i32(1)))
    })
  })
  assert.equal(
    emitC(pointers),
    `#include <stdbool.h>
#include <stdint.h>

int32_t main(void) {
  double int_2 = 2.0;
  double* p = &int_2;
  uint8_t byte = 255;
  return *p + 1;
}
`,
  )
})

test("C spells leading underscores safely and preserves collisions and references", () => {
  const program = c.program(function*() {
    const first = yield* c.let("_value", i32(1), c.i32)
    const second = yield* c.let("binding_value", i32(2), c.i32)
    yield* c.let("_", i32(3), c.i32)
    yield* c.let("first", c.address(first), c.ptr(c.i32))
    yield* c.let("second", c.address(second), c.ptr(c.i32))
  })
  assert.equal(
    emitC(program),
    "#include <stdbool.h>\n#include <stdint.h>\n\nint32_t binding_value = 1;\nint32_t binding_value_2 = 2;\nint32_t binding_ = 3;\nint32_t* first = &binding_value;\nint32_t* second = &binding_value_2;\n",
  )
  for (const hint of ["_bad-name", "_\n", "_\r", "_\u2028", "_\u2029", "bad-name", "1value", ""]) {
    assert.throws(() =>
      emitC(c.program(function*() {
        yield* c.let(hint, i32(1), c.i32)
      })), /invalid identifier/)
  }
})

test("C compiles C11 keywords and reserved underscore names in every binding position", () => {
  const names = ["_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local", "__LINE__", "__FILE__", "_value"]
  const program = c.program(function*() {
    for (const name of names) {
      const global = yield* c.let(name, i32(1), c.i32)
      yield* c.fn(name, [c.param(name, c.i32)], c.i32, function*(parameter) {
        const local = yield* c.let(name, c.add(global, parameter), c.i32)
        yield* c.return(local)
      })
    }
    yield* c.fn("main", [], c.i32, function*() {
      yield* c.return(i32(0))
    })
  })
  const text = emitC(program)
  for (const name of names) {
    assert.ok(text.includes(`int32_t binding${name} = 1;`))
    assert.ok(text.includes(`int32_t binding${name}_2(int32_t binding${name}_3)`))
    assert.ok(text.includes(`int32_t binding${name}_4 = binding${name} + binding${name}_3;`))
    assert.ok(text.includes(`return binding${name}_4;`))
  }
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, text)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C literals are spelled with their declared type, and must fit it", () => {
  const program = c.program(function*() {
    yield* c.let("int32_t", c.less(u32(1), i32(-1)), c.bool)
    yield* c.let("INT64_C", c.add(c.literal(c.i64, -5n), c.literal(c.u64, 9007199254740991n)), c.i64)
    yield* c.let("min", i32(-2147483648), c.i32)
    yield* c.let("small", c.add(c.literal(c.u16, 65535), c.literal(c.i8, -128)), c.i32)
    yield* c.let("big", f64(1e21), c.f64)
    yield* c.let("tiny", f64(-1.5e-7), c.f64)
    yield* c.let("negativeZero", f64(-0), c.f64)
    yield* c.let("notANumber", c.add(f64(NaN), f64(1)), c.f64)
    yield* c.let("infinity", c.less(f64(-Infinity), f64(Infinity)), c.bool)
  })
  assert.equal(
    emitC(program),
    `#include <stdbool.h>
#include <stdint.h>

bool int32_t_2 = UINT32_C(1) < -1;
int64_t INT64_C_2 = -INT64_C(5) + UINT64_C(9007199254740991);
int32_t min = INT32_MIN;
int32_t small = 65535 + -128;
double big = 1e+21;
double tiny = -1.5e-7;
double negativeZero = -0.0;
double notANumber = 0.0 / 0.0 + 1.0;
bool infinity = -1.0 / 0.0 < 1.0 / 0.0;
`,
  )
  assert.throws(() => c.literal(c.i8, 300), /int8_t cannot hold the literal 300 exactly/)
  assert.throws(() => c.literal(c.i32, 1.5), /int32_t cannot hold the literal 1.5 exactly/)
  assert.throws(() => c.literal(c.u8, -1), /uint8_t cannot hold the literal -1 exactly/)
  assert.throws(() => c.literal(c.i64, 1n << 63n), /int64_t cannot hold the literal 9223372036854775808 exactly/)
  assert.throws(() => c.literal(c.char, "é"), /char cannot hold the literal "é"/)
  assert.throws(() => c.literal(c.char, "ab"), /char cannot hold the literal "ab"/)
  assert.throws(() => c.literal(c.char, ""), /char cannot hold the literal ""/)
})

test("C 64-bit literals preserve exact bounds", () => {
  const program = c.program(function*() {
    yield* c.let("minimum", c.literal(c.i64, -(1n << 63n)), c.i64)
    yield* c.let("maximum", c.literal(c.i64, (1n << 63n) - 1n), c.i64)
    yield* c.let("unsignedMaximum", c.literal(c.u64, (1n << 64n) - 1n), c.u64)
    yield* c.let("zero", c.literal(c.u64, 0n), c.u64)
    yield* c.let("negative", c.literal(c.i64, -9007199254740993n), c.i64)
  })
  const emitted = emitC(program)
  assert.match(emitted, /int64_t minimum = INT64_MIN;/)
  assert.match(emitted, /int64_t maximum = INT64_C\(9223372036854775807\);/)
  assert.match(emitted, /uint64_t unsignedMaximum = UINT64_C\(18446744073709551615\);/)
  assert.match(emitted, /uint64_t zero = UINT64_C\(0\);/)
  assert.match(emitted, /int64_t negative = -INT64_C\(9007199254740993\);/)
  assert.throws(() => c.literal(c.i64, -(1n << 63n) - 1n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.i64, 1n << 63n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.u64, -1n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.u64, 1n << 64n), /cannot hold the literal/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-64-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(
      source,
      `${emitted}\nint main(void) {
  return minimum == INT64_MIN && maximum == INT64_MAX && unsignedMaximum == UINT64_MAX
    && zero == 0 && negative == -INT64_C(9007199254740993) ? 0 : 1;
}\n`,
    )
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C numeric casts preserve target types, precedence, and C semantics", () => {
  const narrowed = c.cast(c.i32, f64(3.9))
  assertType<Equal<lang.Denotes<typeof narrowed>, I32>>()
  const widened = c.cast(c.f64, c.literal(c.i64, 42n))
  assertType<Equal<lang.Denotes<typeof widened>, F64>>()
  const program = c.program(function*() {
    yield* c.let("sum", c.cast(c.i32, c.add(f64(1.5), f64(2.5))), c.i32)
    yield* c.let("truncated", narrowed, c.i32)
    yield* c.let("wrapped", c.cast(c.u8, i32(257)), c.u8)
    yield* c.let("wide", widened, c.f64)
    yield* c.let("nested", c.cast(c.i64, c.cast(c.i32, f64(-3.9))), c.i64)
    yield* c.let("branch", c.cast(c.i32, c.ternary(c.true, f64(1.5), f64(2.5))), c.i32)
    yield* c.let("added", c.add(narrowed, i32(2)), c.i32)
    yield* c.fn("truncate", [c.param("value", c.f64)], c.i32, function*(value) {
      yield* c.return(c.cast(c.i32, value))
    })
  })
  const emitted = emitC(program)
  assert.equal(
    emitted,
    `#include <stdbool.h>
#include <stdint.h>

int32_t sum = (int32_t)(1.5 + 2.5);
int32_t truncated = (int32_t)3.9;
uint8_t wrapped = (uint8_t)257;
double wide = (double)INT64_C(42);
int64_t nested = (int64_t)(int32_t)-3.9;
int32_t branch = (int32_t)(true ? 1.5 : 2.5);
int32_t added = (int32_t)3.9 + 2;
int32_t truncate(double value) {
  return (int32_t)value;
}
`,
  )
  assert.throws(() =>
    c.program(function*() {
      const value = yield* c.let("value", i32(1), c.i32)
      yield* c.let("nonconstant", c.cast(c.f64, value), c.f64)
    }), /needs a constant initializer/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-cast-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(
      source,
      `${emitted}\nint main(void) {
  return sum == 4 && truncated == 3 && wrapped == 1 && wide == 42.0 && nested == -3
    && branch == 1 && added == 5 && truncate(-3.9) == -3 ? 0 : 1;
}\n`,
    )
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C rejects invalid program structure", () => {
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.run(i32(1))
      }),
    /"expression" cannot appear at the top level of a C program/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.fn("outer", [], c.void, function*() {
          yield* c.if(c.true, function*() {
            yield* c.fn("inner", [], c.void, function*() {})
          })
        })
      }),
    /function "inner" cannot be nested in another function in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const one = yield* c.fn("one", [], c.i32, function*() {
          yield* c.return(i32(1))
        })
        yield* c.let("x", c.call(one), c.i32)
      }),
    /the top-level "let" of "x" needs a constant initializer in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const x = yield* c.let("x", i32(1), c.i32)
        yield* c.let("y", c.add(x, i32(1)), c.i32)
      }),
    /the top-level "let" of "y" needs a constant initializer in C/,
  )
  assert.throws(() => c.address(i32(1) as never), /only an lvalue has an address/)
  const constants = c.program(function*() {
    const x = yield* c.let("x", c.add(i32(1), c.ternary(c.less(i8(2), f64(3)), i32(1), i32(0))), c.i32)
    yield* c.let("p", c.add(i32(1), c.address(x)), c.ptr(c.i32))
  })
  assert.equal(emitC(constants), "#include <stdbool.h>\n#include <stdint.h>\n\nint32_t x = 1 + (2 < 3.0 ? 1 : 0);\nint32_t* p = 1 + &x;\n")
})

test("C executes pointer arithmetic, assignment through pointers, loops, and typed calls", () => {
  const program = c.program(function*() {
    const count = yield* c.fn("count", [c.param("value", c.ptr(c.i32))], c.i32, function*(value) {
      const total = yield* c.let("total", i32(0), c.i32)
      const i = yield* c.let("i", i32(0), c.i32)
      yield* c.while(c.less(i, i32(3)), function*() {
        yield* c.assign(total, c.add(total, c.deref(c.add(value, i32(0)))))
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(total)
    })
    yield* c.fn("main", [], c.i32, function*() {
      const value = yield* c.let("value", i32(0), c.i32)
      const pointer = yield* c.let("pointer", c.address(value), c.ptr(c.i32))
      yield* c.assign(c.deref(pointer), i32(14))
      yield* c.return(c.call(count, pointer))
    })
  })
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitC(program))
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 42, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C char literals compile to the ASCII characters they name", () => {
  const codes = Array.from({ length: 128 }, (_, code) => code)
  const program = c.program(function*() {
    for (const code of codes) yield* c.let(`char_${code}`, c.literal(c.char, String.fromCharCode(code)), c.char)
  })
  const emitted = emitC(program)
  assert.match(emitted, /char char_39 = '\\'';\nchar char_40 = '\(';/)
  assert.match(emitted, /char char_10 = '\\n';/)
  assert.match(emitted, /char char_0 = '\\000';/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-char-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, `${emitted}\nint main(void) {\n  return ${codes.map((code) => `char_${code} == ${code}`).join(" && ")} ? 0 : 1;\n}\n`)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C rejects escaped references and preserves distinct binding names", () => {
  let escaped: lang.Ref<C, I32> | undefined
  c.program(function*() {
    yield* c.fn("outer", [], c.void, function*() {
      escaped = yield* c.let("inner", i32(1), c.i32)
    })
  })
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("other", [], c.i32, function*() {
        yield* c.return(escaped!)
      })
    }), /reference to "inner" does not resolve to an in-scope binding/)
  const program = c.program(function*() {
    const first = yield* c.let("value", i32(1), c.i32)
    yield* c.let("value", i32(2), c.i32)
    yield* c.let("pointer", c.address(first), c.ptr(c.i32))
  })
  assert.match(emitC(program), /int32_t value = 1;\nint32_t value_2 = 2;\nint32_t\* pointer = &value;/)
})
