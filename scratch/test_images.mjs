async function checkUrl(name, url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    console.log(`${name}: HTTP ${res.status}`);
  } catch (e) {
    console.log(`${name}: Error - ${e.message}`);
  }
}

async function main() {
  await checkUrl("Mosque", "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&q=80&w=600");
  await checkUrl("Historic Building", "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600");
  await checkUrl("Indonesian Food", "https://images.unsplash.com/photo-1541832676-9b763b0239ab?auto=format&fit=crop&q=80&w=400");
  await checkUrl("Sam Poo Kong Alt", "https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&q=80&w=600");
  await checkUrl("Taman Budaya Alt", "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=400");
}
main();
