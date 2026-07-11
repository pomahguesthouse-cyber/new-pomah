import fs from "node:fs";

const edits = [
  {
    path: "src/public/components/public-shell.tsx",
    before: 'to="/login"\n            className=',
    after: 'to="/login"\n            search={{}}\n            className=',
  },
  {
    path: "src/routes/__root.tsx",
    before: 'router.navigate({ to: "/login" });',
    after: 'router.navigate({ to: "/login", search: {} });',
  },
  {
    path: "src/routes/admin.tsx",
    before: 'throw redirect({ to: "/login" });',
    after: 'throw redirect({ to: "/login", search: {} });',
  },
];

for (const edit of edits) {
  let source = fs.readFileSync(edit.path, "utf8");
  if (!source.includes(edit.after)) {
    if (!source.includes(edit.before)) {
      throw new Error(`Guard failed in ${edit.path}`);
    }
    source = source.replace(edit.before, edit.after);
    fs.writeFileSync(edit.path, source);
  }
}

for (const temporaryScript of [
  "scripts/apply-tanstack-router-typecheck-fix.mjs",
  "scripts/apply-tanstack-router-followup.mjs",
]) {
  if (fs.existsSync(temporaryScript)) fs.rmSync(temporaryScript);
}

console.log("Applied remaining TanStack Router fixes and removed temporary scripts.");
