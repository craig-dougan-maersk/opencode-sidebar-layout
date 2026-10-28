# Signed Git extraction fixtures

`git-preparation.bundle` is a binary Git bundle, not an executable. Never print
its raw contents. It contains three signed commits:

- `original`: exact upstream package.json and src/tui.tsx from
  `f5a4d9f154c53057a2b4c65a31523c5ba389fdfd`; extraction works without npm,
  but the compiled-export contract fails and dist is absent.
- `preparation-trap`: synthetic original manifest with a `prepare` hook.
  This tests accidentally introducing installer triggers, not an upstream bug.
- `corrected`: exact candidate package.json and canonical dist/tui.js.

Pacote 21.5.1 performs real Git extraction with fresh caches, Arborist 9.9.1,
`ignoreScripts: true` and an unavailable npm CLI sentinel. The synthetic trap
must fail with Git dependency preparation; original and corrected must extract
without npm. Pacote 22 honors scripts-disabled preparation at this boundary
and would mask the trap. These behavioral-probe dependencies are dev-only.

To regenerate, create an isolated temporary Git repo outside the project.
Write the original manifest/source from the SHA above, explicitly add them,
`git commit -S` and tag `original`. Add `scripts.prepare = "exit 1"` to that
manifest, `git commit -S` and tag `preparation-trap`. Remove only that fixture's
source, copy the candidate manifest/dist, explicitly stage each change,
`git commit -S` and tag `corrected`. Verify all signatures with
`git verify-commit <tag>` and create the bundle with
`git bundle create <project>/test/fixtures/git-preparation.bundle original preparation-trap corrected`.

Tests verify signed-object presence and exact candidate manifest/output
equality. Signatures were cryptographically checked locally; CI needs no
signing key and makes no commits. Runtime dependencies are not installed and
plugin setup is never executed. Archive/AST/freshness checks separately
validate output. This is not a host rendering test. Temporary fixtures and
caches are removed after each test.
