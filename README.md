# ts-emit

An experiment in using TypeScript to build and emit programs in other languages.

TypeScript is the host here, not an output target. Instead of string templates or a heavy compiler pipeline, it's exploring small typed builders where generator blocks (`yield*`) handle sequence, local bindings, and scope hygiene.

There are small working builders for C, Lua, and Prolog in `languages/` (with runnable examples in `examples/`) to see how very different languages feel, but the core is meant for any target.

Still very much a work in progress.
