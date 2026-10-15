import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { family } from "../examples/prolog.ts"
import { emitProlog, prolog, type Term } from "../languages/prolog.ts"

const a = prolog.atom
const call = prolog.call

test("facts emit atoms, compounds, numbers, and proper and improper lists", () => {
  const clauses = prolog.program(
    prolog.fact(call("values", a("alice"), a("Alice Smith"), a(""), a("don't\\\n\u0000"))),
    prolog.fact(call("data", prolog.compound("+", prolog.number(-2), prolog.number(1.5)), prolog.list([a("a"), a("b")]))),
    prolog.clause(({ variable }) => ({ head: call("cons", prolog.list([variable("Head")], variable("Tail"))) })),
    prolog.fact(call("empty", prolog.list([]), prolog.compound("zero"))),
    prolog.fact(call("ready")),
  )
  assert.equal(
    emitProlog(clauses),
    [
      "values(alice, 'Alice Smith', '', 'don\\'t\\\\\\xa\\\\x0\\').",
      "data('+'(-2, 1.5), [a, b]).",
      "cons([Head | Tail]).",
      "empty([], zero).",
      "ready.",
    ].join("\n"),
  )
  assert.equal(emitProlog([]), "")
})

test("Prolog rejects lone surrogates in atom, compound, and predicate names", () => {
  for (const name of ["\ud800", "\udfff", "a\ud800b", "a\udfffb"]) {
    for (
      const clause of [
        prolog.fact(call("value", a(name))),
        prolog.fact(call("value", prolog.compound(name, a("x")))),
        prolog.fact(call(name)),
        prolog.rule(() => ({ head: call("value"), body: call(name) })),
      ]
    ) {
      assert.throws(() => emitProlog([clause]), /lone surrogate/)
    }
  }
})

test("Prolog preserves Unicode pairs in atom, compound, and predicate names", () => {
  assert.equal(
    emitProlog([prolog.fact(call("😀", a("😀"), prolog.compound("😀", a("x"))))]),
    "'😀'('😀', '😀'(x)).",
  )
})

test("goal precedence preserves conjunctions containing disjunctions", () => {
  const clause = prolog.rule(({ variable }) => {
    const x = variable("X")
    return {
      head: call("choose", x),
      body: prolog.and(
        prolog.or(prolog.unify(x, a("a")), prolog.unify(x, a("b"))),
        prolog.or(call("left", x), prolog.and(call("middle", x), call("right", x))),
      ),
    }
  })
  assert.equal(emitProlog([clause]), "choose(X) :- (X = a; X = b), (left(X); middle(X), right(X)).")
})

test("variables are clause-scoped, repeated names share identity, and anonymous occurrences stay fresh", () => {
  let escaped: Term = prolog.anonymous()
  const clause = prolog.clause(({ variable }) => {
    escaped = variable("X")
    assert.equal(variable("X"), escaped)
    const anonymous = prolog.anonymous()
    return { head: call("same", escaped, escaped, anonymous, anonymous) }
  })
  assert.equal(emitProlog([clause]), "same(X, X, _, _).")
  assert.throws(() => prolog.fact(call("bad", escaped)), /another clause/)
  assert.throws(
    () => prolog.rule(() => ({ head: call("bad"), body: call("nested", prolog.list([prolog.compound("f", escaped)])) })),
    /another clause/,
  )
  assert.doesNotThrow(() => prolog.clause(({ variable }) => ({ head: call("other", variable("X")) })))
  for (const name of ["x", "_", "X Y", "X). injected(", ""]) {
    assert.throws(() => prolog.clause(({ variable }) => ({ head: call("bad", variable(name)) })), /Invalid variable name/)
  }
})

test("unsupported numeric values and empty list tails fail explicitly", () => {
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prolog.number(value), /finite.*safe integers/)
  }
  assert.throws(() => prolog.list([], a("tail")), /at least one item/)
})

test("family example emits recursive rules", () => {
  assert.equal(
    emitProlog(family),
    [
      "parent(alice, bob).",
      "parent(bob, carol).",
      "ancestor(X, Y) :- parent(X, Y).",
      "ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).",
    ].join("\n"),
  )
})

const runtime = spawnSync("swipl", ["--version"], { encoding: "utf8" })

test("SWI-Prolog executes recursion, unification, lists, escaping, and goal precedence", {
  skip: runtime.error && (runtime.error as NodeJS.ErrnoException).code === "ENOENT" ? "SWI-Prolog is not installed" : false,
}, () => {
  assert.equal(runtime.status, 0, runtime.stderr)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-prolog-"))
  try {
    const source = join(directory, "family.pl")
    const clauses = [
      ...family,
      prolog.clause(({ variable }) => ({ head: call("same", variable("X"), variable("X")) })),
      prolog.fact(call("fresh", prolog.anonymous(), prolog.anonymous())),
      prolog.clause(({ variable }) => ({ head: call("first", prolog.list([variable("Head")], variable("Tail")), variable("Head")) })),
      prolog.fact(call("escaped", a("don't\\\n\u0000"))),
      prolog.fact(call("data", prolog.compound("+", prolog.number(-2), prolog.number(1.5)), prolog.number(1e-7))),
      prolog.fact(call("quoted", a("a). injected. %"), a("雪"), a(""))),
      prolog.fact(call("😀", a("😀"), prolog.compound("😀", a("x")))),
      prolog.rule(({ variable }) => {
        const x = variable("X")
        return { head: call("choose", x), body: prolog.and(prolog.or(prolog.unify(x, a("a")), prolog.unify(x, a("b"))), prolog.unify(x, a("b"))) }
      }),
    ]
    writeFileSync(source, emitProlog(clauses))
    const query = [
      "findall(Y, ancestor(alice, Y), [bob, carol])",
      "same(a, a)",
      "\\+ same(a, b)",
      "fresh(a, b)",
      "first([a, b], a)",
      "findall(X, choose(X), [b])",
      "escaped(E), atom_codes(E, [100,111,110,39,116,92,10,0])",
      "data('+'(-2, 1.5), 1e-7)",
      "quoted('a). injected. %', '雪', '')",
      "'😀'(A, '😀'(x)), atom_codes(A, [128512])",
      "write(ok)",
    ].join(", ")
    const result = spawnSync("swipl", ["-q", "-s", source, "-g", query, "-t", "halt"], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "ok")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
