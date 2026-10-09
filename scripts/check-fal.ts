// `npm run check:fal`: one real test image through the fal provider with the key from `.env.local`.
// Costs about USD 0.003 at fal. Prints what failed and what to do about it; never prints the key.
import { runFalCheck } from './lib/fal-check';

async function main(): Promise<number> {
  const result = await runFalCheck({ key: (process.env.FAL_KEY ?? '').trim() });
  if (result.ok) {
    const size = result.width && result.height ? `${result.width}x${result.height}, ` : '';
    console.log(
      `\nOK: fal works. Saved ${result.file} (${size}${result.bytes} bytes, ${result.ms} ms).`,
    );
    console.log('Open the Studio, pick FLUX.1 Schnell and generate.');
    return 0;
  }
  console.log(`\nFAILED (${result.reason}): ${result.advice}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
