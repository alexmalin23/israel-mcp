# Adding a service

1. **Create** `src/services/<name>/index.ts` exporting a `ServiceModule`:

```ts
import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { requestJson } from "../../lib/http.js";
import { ok, run } from "../../lib/result.js";

export const myService: ServiceModule = {
  id: "my",                      // tool-name prefix
  name: "My Service",
  disabledReason: (c) => (process.env.MY_KEY ? null : "MY_KEY not set"),
  register(server, config) {
    server.registerTool(
      "my_do_task",
      {
        title: "...",
        description: "What it does, when to use it, what it returns.",
        inputSchema: { query: z.string().describe("...") },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ query }) => run(async () => ok({ result: await requestJson("https://...") })),
    );
  },
};
```

2. **Register** it in `src/services/index.ts`.
3. **Config**: add env vars to `src/config.ts` and `.env.example` (don't read `process.env` directly in the service in real code).
4. **Document** in `docs/services/<name>.md`: auth, tools table, limitations, a `curl` verification snippet.
5. **Test**: pure logic in its own module with unit tests; add the tool name to `test/server.test.ts`.

## Tool checklist
- [ ] Name is `<prefix>_<verb>_<noun>`
- [ ] Description says *when* to use it, not just what it wraps
- [ ] Inputs have `.describe()` and sane defaults/limits
- [ ] `annotations` set (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
- [ ] Output trimmed to what an agent needs — no raw 200-field payloads
- [ ] Anything that writes money/legal records: opt-in env flag + dry run + confirmation in description
- [ ] Errors go through `run()` so they become `isError` results
