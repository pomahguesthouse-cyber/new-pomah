async function main() {
  const url = "https://gofvxeiulaljwyfyhnww.supabase.co";
  const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnZ4ZWl1bGFsand5Znlobnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTYxMzQsImV4cCI6MjA5NDMzMjEzNH0.hYJqRzZa5l2lW1ttLSc1VRbW-NgayPvUY-Be7QLLxtU";
  
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
  
  console.log("=== PROPERTIES ===");
  let res = await fetch(`${url}/rest/v1/properties?select=id,name,homepage_config,global_config`, { headers });
  console.log(JSON.stringify(await res.json(), null, 2));

  console.log("\n=== SYSTEM PAGES ===");
  res = await fetch(`${url}/rest/v1/seo_landing_pages?select=id,title,slug,page_type,is_system`, { headers });
  console.log(JSON.stringify(await res.json(), null, 2));
}
main();
