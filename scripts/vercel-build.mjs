/**
 * The build, on a platform that builds from a git push.
 *
 * `vercel.json` used to run `prisma migrate deploy && next build` directly,
 * and a deployment with no database reported this:
 *
 *     Error: Prisma schema validation - (get-config wasm)
 *     Error code: P1012
 *     error: Environment variable not found: DATABASE_URL.
 *       -->  prisma/schema.prisma:11
 *
 * Which is true, and says nothing a person can act on: the schema is fine, the
 * line it points at is fine, and the thing to fix is three screens away in the
 * hosting dashboard. A first deployment hits this every time, because importing
 * a repository starts a build before anyone has created a database.
 *
 * So the check happens here, before Prisma is asked anything, and the message
 * names the fix.
 *
 * Plain `.mjs` and not the `.ts` the rest of scripts/ uses, deliberately: this
 * one runs inside the platform's build step, before anything in the repository
 * has been shown to work, so it should need no loader, no transpiler and no
 * dependency of its own.
 *
 * Failing rather than skipping the migration is also deliberate. An
 * application whose every page needs a database is not better off deployed
 * green and answering 500 — a build that stops with a sentence saying what to
 * add is the kinder outcome.
 */
import { spawnSync } from 'node:child_process'

if (!process.env.DATABASE_URL) {
  console.error(
    [
      '',
      'DATABASE_URL is not set for this deployment, so there is nothing to',
      'migrate against and the application would have no database to read.',
      '',
      'On Vercel:',
      '  1. Storage → Create Database → Neon, and connect it to this project.',
      '     The integration sets DATABASE_URL for you.',
      '  2. Settings → Environment Variables: check DATABASE_URL is listed for',
      '     the environment being built (Production, and Preview if branch',
      '     deployments should build too).',
      '  3. Redeploy.',
      '',
      'Anywhere else: set DATABASE_URL in the build environment. Use the',
      'pooled connection string — serverless opens a connection per request.',
      '',
    ].join('\n')
  )
  process.exit(1)
}

/** Run one step, and stop the build on the first that fails. */
function run(command, args, env = process.env) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const { status, error } = spawnSync(command, args, { stdio: 'inherit', env })
  if (error) {
    console.error(`Could not start ${command}: ${error.message}`)
    process.exit(1)
  }
  if (status !== 0) process.exit(status ?? 1)
}

/*
 * Migrate over a direct connection, not the pooled one.
 *
 * A managed Postgres gives you two URLs: one through a connection pooler,
 * which is what a serverless application wants because it opens a connection
 * per invocation, and one straight to the database. Migrations need the
 * second. The pooler runs in transaction mode, where a session-level advisory
 * lock cannot be held, and `prisma migrate deploy` takes one to stop two
 * deployments migrating at once — through the pooler it hangs or fails, and
 * it does so intermittently, which is the worst way to find out.
 *
 * Neon hands out `DATABASE_URL_UNPOOLED` for exactly this, and Vercel's
 * integration passes it through. Where there is only the one URL — a plain
 * Postgres with no pooler in front of it — that URL is already direct, so the
 * fallback is correct rather than a compromise.
 *
 * Only the migration is switched. The application keeps the pooled URL, which
 * is the whole reason it is there.
 */
const direct = process.env.DATABASE_URL_UNPOOLED
if (direct) {
  console.log('Migrating over the direct (unpooled) connection.')
} else {
  console.log(
    'No DATABASE_URL_UNPOOLED set; migrating over DATABASE_URL.\n' +
      'If that URL points at a connection pooler, add the direct one — a\n' +
      'migration through a pooler in transaction mode can hang on its lock.'
  )
}

run(
  'npx',
  ['prisma', 'migrate', 'deploy'],
  direct ? { ...process.env, DATABASE_URL: direct } : process.env
)
run('npx', ['next', 'build'])
