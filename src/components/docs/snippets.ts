/**
 * The quickstart as runnable code: create a generation, poll it, download the results. One script
 * per language, cut into the four steps the page explains. Everything a reader has to replace is
 * the API key (read from `AIVORE_API_KEY`); the origin and the model are this deployment's own.
 */
import type { CodeLanguage } from './tokenize';

export const QUICKSTART_LANGUAGES = ['bash', 'javascript', 'python'] as const;
export type QuickstartLanguage = (typeof QUICKSTART_LANGUAGES)[number];

export const QUICKSTART_STEPS = ['setup', 'generate', 'poll', 'download'] as const;
export type QuickstartStep = (typeof QUICKSTART_STEPS)[number];

/** What every example shows until the reader chooses another language. */
export const DEFAULT_QUICKSTART_LANGUAGE: QuickstartLanguage = 'bash';

export function isQuickstartLanguage(value: unknown): value is QuickstartLanguage {
  return (QUICKSTART_LANGUAGES as readonly unknown[]).includes(value);
}

export interface QuickstartInput {
  /** `https://host` of this deployment, no trailing slash. */
  origin: string;
  /** An available text-to-image model. */
  modelId: string;
  prompt: string;
  aspectRatio: string;
}

export type QuickstartCode = Record<QuickstartStep, Record<QuickstartLanguage, string>>;

/** The language of the highlighter that colours a quickstart language. */
export const HIGHLIGHT_AS: Record<QuickstartLanguage, CodeLanguage> = {
  bash: 'bash',
  javascript: 'javascript',
  python: 'python',
};

export function quickstartCode({
  origin,
  modelId,
  prompt,
  aspectRatio,
}: QuickstartInput): QuickstartCode {
  const quoted = JSON.stringify(prompt);
  return {
    setup: {
      bash: `export AIVORE_API_KEY="avk_..."   # the key you just created
ORIGIN="${origin}"
BASE_URL="$ORIGIN/api/v1"`,
      javascript: `// Node.js 20 or newer, saved as quickstart.mjs
const ORIGIN = "${origin}";
const BASE_URL = \`\${ORIGIN}/api/v1\`;
const API_KEY = process.env.AIVORE_API_KEY; // the key you just created

async function api(path, { headers, ...options } = {}) {
  const response = await fetch(\`\${BASE_URL}\${path}\`, {
    ...options,
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
      ...headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(\`\${response.status} \${body.error.code}: \${body.error.message}\`);
  }
  return body.data;
}`,
      python: `# pip install requests
import os
import time
import uuid

import requests

ORIGIN = "${origin}"
BASE_URL = f"{ORIGIN}/api/v1"
HEADERS = {"Authorization": f"Bearer {os.environ['AIVORE_API_KEY']}"}  # the key you just created


def api(method, path, headers=None, **kwargs):
    response = requests.request(
        method, BASE_URL + path, headers={**HEADERS, **(headers or {})}, timeout=30, **kwargs
    )
    if not response.ok:
        error = response.json()["error"]
        raise RuntimeError(f"{response.status_code} {error['code']}: {error['message']}")
    return response.json()["data"]`,
    },
    generate: {
      bash: `RESPONSE=$(curl -s -X POST "$BASE_URL/generations" \\
  -H "Authorization: Bearer $AIVORE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: quickstart-$(date +%s)-$RANDOM" \\
  -d '{
    "tool": "text-to-image",
    "modelId": "${modelId}",
    "prompt": ${quoted},
    "params": { "aspectRatio": "${aspectRatio}" }
  }')
echo "$RESPONSE" | jq .
ID=$(echo "$RESPONSE" | jq -r '.data.id')`,
      javascript: `const created = await api("/generations", {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({
    tool: "text-to-image",
    modelId: "${modelId}",
    prompt: ${quoted},
    params: { aspectRatio: "${aspectRatio}" },
  }),
});
console.log(created.id, created.status, \`\${created.cost} credits\`);`,
      python: `created = api(
    "POST",
    "/generations",
    headers={"Idempotency-Key": str(uuid.uuid4())},
    json={
        "tool": "text-to-image",
        "modelId": "${modelId}",
        "prompt": ${quoted},
        "params": {"aspectRatio": "${aspectRatio}"},
    },
)
print(created["id"], created["status"], f"{created['cost']} credits")`,
    },
    poll: {
      bash: `while true; do
  STATUS=$(curl -s "$BASE_URL/generations/$ID" \\
    -H "Authorization: Bearer $AIVORE_API_KEY" | jq -r '.data.status')
  echo "status: $STATUS"
  case "$STATUS" in queued|processing) sleep 2 ;; *) break ;; esac
done`,
      javascript: `const FINAL = ["succeeded", "failed", "canceled"];
let generation = created;
while (!FINAL.includes(generation.status)) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  generation = await api(\`/generations/\${generation.id}\`);
  console.log(generation.status, \`\${generation.progress}%\`);
}
if (generation.status !== "succeeded") {
  throw new Error(generation.error?.message ?? \`Generation \${generation.status}\`);
}`,
      python: `generation = created
while generation["status"] not in ("succeeded", "failed", "canceled"):
    time.sleep(2)
    generation = api("GET", f"/generations/{generation['id']}")
    print(generation["status"], f"{generation['progress']}%")

if generation["status"] != "succeeded":
    raise RuntimeError(generation.get("error", {}).get("message", generation["status"]))`,
    },
    download: {
      bash: `curl -s "$BASE_URL/generations/$ID" -H "Authorization: Bearer $AIVORE_API_KEY" \\
  | jq -r '.data.outputs[].url' \\
  | while read -r URL; do
      curl -sS -OJ -H "Authorization: Bearer $AIVORE_API_KEY" "$ORIGIN$URL?download=1"
    done
ls -l aivore-*`,
      javascript: `import { writeFile } from "node:fs/promises";

for (const [index, output] of generation.outputs.entries()) {
  const response = await fetch(\`\${ORIGIN}\${output.url}\`, {
    headers: { Authorization: \`Bearer \${API_KEY}\` },
  });
  const extension = output.mimeType.split("/")[1];
  await writeFile(\`result-\${index + 1}.\${extension}\`, Buffer.from(await response.arrayBuffer()));
}`,
      python: `for index, output in enumerate(generation["outputs"], start=1):
    file = requests.get(ORIGIN + output["url"], headers=HEADERS, timeout=60)
    file.raise_for_status()
    extension = output["mimeType"].split("/")[1]
    with open(f"result-{index}.{extension}", "wb") as handle:
        handle.write(file.content)`,
    },
  };
}
