import { Generator, getConfig } from '@tanstack/router-generator';

async function main() {
  console.log('Fetching configuration...');
  const config = getConfig();
  console.log('Initializing Generator...');
  const generator = new Generator({ config, root: process.cwd() });
  console.log('Running route tree generation...');
  await generator.run();
  console.log('Routes generated successfully!');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
