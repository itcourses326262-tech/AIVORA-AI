// `npm run check:firebase`: asks Google whether the Firebase web settings in `.env` / `.env.local`
// work from this machine, and says what to change when they do not. Prints no secret (the web
// config is public; the key is shown as its first letters, length and last four characters).
import { getEnv } from '@/server/env';
import { runFirebaseCheck } from './lib/firebase-check';

async function main(): Promise<number> {
  console.log('AIVORE: check Google sign-in (Firebase)\n');
  let env;
  try {
    env = getEnv();
  } catch (error) {
    console.log(
      `The settings are not valid:\n${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const { FIREBASE_API_KEY: apiKey, FIREBASE_PROJECT_ID: projectId } = env;
  if (!apiKey || !env.FIREBASE_AUTH_DOMAIN || !projectId) {
    console.log('Google sign-in is not set up in .env.local. Run: npm run setup:firebase');
    return 1;
  }
  console.log(`Project: ${projectId} (${env.FIREBASE_AUTH_DOMAIN})`);
  const lines = await runFirebaseCheck({ apiKey, projectId, origin: 'http://localhost:3000' });
  for (const line of lines) {
    console.log(`\n${line.ok ? 'OK    ' : 'FAILED'} ${line.title}`);
    if (line.advice) console.log(`       -> ${line.advice}`);
  }
  const failed = lines.some((line) => !line.ok);
  console.log(
    failed
      ? '\nFix the first FAILED line, then run this again.'
      : '\nEverything Google can tell from here is fine. Try the button again.',
  );
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
