# Enterprise AI Chat — Backend

Fastify 5 + TypeScript backend for the Enterprise AI Chat application.

## Development

```bash
npm install --legacy-peer-deps
npm run dev
npm run build
npm run test
npm run lint
```

## Known Peer Dependency Conflicts

### @anthropic-ai/claude-agent-sdk

Current installed: `0.2.121`  
Latest available: `0.3.x`

The 0.3.x series requires:
- `zod ^4.0.0` (project uses `zod ^3.23.0`)
- `@anthropic-ai/sdk >= 0.93.0` (project uses `^0.71.2`)

**Upgrade blockers**: Zod v4 introduced breaking API changes. Migrating from Zod v3 → v4 requires
updating all schema definitions (`.parse()`, `.safeParse()`, `.z.infer<>` usage) across the codebase.
This is a non-trivial migration tracked as DEBT-81-PEERDEPS.

**Workaround**: Always install with `--legacy-peer-deps`:
```bash
npm install --legacy-peer-deps
```

This is enforced in `Dockerfile` and `BUILD.sh`. Do not remove the flag.

**To upgrade (future task)**:
1. Bump `zod` to `^4.x` in package.json
2. Run `npx zod-to-3` migration tool or manually update schemas
3. Bump `@anthropic-ai/sdk` to `^0.93.0`
4. Bump `@anthropic-ai/claude-agent-sdk` to `^0.3.x`
5. Run full test suite and verify agent SDK integration
