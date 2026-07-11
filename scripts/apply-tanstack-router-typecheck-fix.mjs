import fs from "node:fs";

const edits = [
  {
    path: "src/admin/components/admin-topbar.tsx",
    replacements: [
      ['navigate({ to: "/login" });', 'navigate({ to: "/login", search: {} });'],
    ],
  },
  {
    path: "src/public/components/public-shell.tsx",
    replacements: [
      ['to="/login"\n            className=', 'to="/login"\n            search={{}}\n            className='],
    ],
  },
  {
    path: "src/routes/__root.tsx",
    replacements: [
      ['router.navigate({ to: "/login" });', 'router.navigate({ to: "/login", search: {} });'],
    ],
  },
  {
    path: "src/routes/admin.tsx",
    replacements: [
      ['throw redirect({ to: "/login" });', 'throw redirect({ to: "/login", search: {} });'],
    ],
  },
];

for (const edit of edits) {
  let source = fs.readFileSync(edit.path, "utf8");
  for (const [before, after] of edit.replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) {
      throw new Error(`Guard failed in ${edit.path}: missing expected source: ${before}`);
    }
    source = source.replace(before, after);
  }
  fs.writeFileSync(edit.path, source);
}

console.log("Applied guarded TanStack Router typecheck fixes.");
