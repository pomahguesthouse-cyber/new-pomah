import fs from "node:fs";

const replaceAllGuarded = (source, before, after, path) => {
  if (!source.includes(before)) return source;
  return source.split(before).join(after);
};

const editFile = (path, transform) => {
  const source = fs.readFileSync(path, "utf8");
  const next = transform(source);
  if (next === source) {
    console.log(`No changes needed in ${path}`);
    return;
  }
  fs.writeFileSync(path, next);
  console.log(`Updated ${path}`);
};

editFile("src/admin/components/admin-topbar.tsx", (source) =>
  replaceAllGuarded(
    source,
    'navigate({ to: "/login", search: {} });',
    'navigate({ to: "/login", search: { next: undefined } });',
    "src/admin/components/admin-topbar.tsx",
  ),
);

editFile("src/public/components/public-shell.tsx", (source) => {
  let next = source;
  next = replaceAllGuarded(
    next,
    'to="/login"\n            className=',
    'to="/login"\n            search={{ next: undefined }}\n            className=',
    "src/public/components/public-shell.tsx",
  );
  next = replaceAllGuarded(
    next,
    '<Link to="/rooms"',
    '<Link to="/" hash="rooms"',
    "src/public/components/public-shell.tsx",
  );
  next = replaceAllGuarded(
    next,
    'to="/rooms"\n            className=',
    'to="/"\n            hash="rooms"\n            className=',
    "src/public/components/public-shell.tsx",
  );
  return next;
});

editFile("src/routes/__root.tsx", (source) => {
  let next = source;
  next = replaceAllGuarded(
    next,
    'router.navigate({ to: "/login" });',
    'router.navigate({ to: "/login", search: { next: undefined } });',
    "src/routes/__root.tsx",
  );
  next = replaceAllGuarded(
    next,
    'to="/rooms"',
    'to="/" hash="rooms"',
    "src/routes/__root.tsx",
  );
  return next;
});

editFile("src/routes/admin.tsx", (source) =>
  replaceAllGuarded(
    source,
    'throw redirect({ to: "/login" });',
    'throw redirect({ to: "/login", search: { next: undefined } });',
    "src/routes/admin.tsx",
  ),
);

editFile("src/routes/lp.$slug.tsx", (source) =>
  replaceAllGuarded(
    source,
    '<Link to="/rooms"',
    '<Link to="/" hash="rooms"',
    "src/routes/lp.$slug.tsx",
  ),
);

editFile("src/routes/rooms.$slug.tsx", (source) => {
  let next = source;
  next = replaceAllGuarded(
    next,
    'to: "/rooms",',
    'to: "/",\n        hash: "rooms",',
    "src/routes/rooms.$slug.tsx",
  );
  next = replaceAllGuarded(
    next,
    '<Link to="/rooms"',
    '<Link to="/" hash="rooms"',
    "src/routes/rooms.$slug.tsx",
  );
  next = replaceAllGuarded(
    next,
    'to="/rooms"',
    'to="/"\n            hash="rooms"',
    "src/routes/rooms.$slug.tsx",
  );
  return next;
});

for (const temporaryPath of [
  "src/routes/rooms.tsx",
  "scripts/apply-tanstack-router-typecheck-fix.mjs",
  "scripts/apply-tanstack-router-followup.mjs",
]) {
  if (fs.existsSync(temporaryPath)) {
    fs.unlinkSync(temporaryPath);
    console.log(`Removed ${temporaryPath}`);
  }
}

console.log("Applied final TanStack Router typecheck fixes.");
