function normalizePhone(raw) {
  let p = String(raw).replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

const testCases = [
  { input: "0812345678", expected: "62812345678" },
  { input: "62812345678", expected: "62812345678" },
  { input: "812345678", expected: "62812345678" },
  { input: "620812345678", expected: "62812345678" },
  { input: "+62 812-3456-78", expected: "62812345678" },
  { input: "  0812 3456 78  ", expected: "62812345678" },
];

console.log("=== TESTING PHONE NORMALIZATION ===");
let allPassed = true;
testCases.forEach((tc) => {
  const result = normalizePhone(tc.input);
  const passed = result === tc.expected;
  console.log(`Input: "${tc.input}" | Normalized: "${result}" | Expected: "${tc.expected}" | Passed: ${passed ? "✅" : "❌"}`);
  if (!passed) allPassed = false;
});

if (allPassed) {
  console.log("\nAll tests passed successfully! 🎉");
} else {
  console.log("\nSome tests failed.");
  process.exit(1);
}
