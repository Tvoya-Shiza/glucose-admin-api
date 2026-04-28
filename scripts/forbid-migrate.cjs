#!/usr/bin/env node
// glucose-admin-api/scripts/forbid-migrate.cjs
// Per FND-02: admin-api never owns migrations. The shared MySQL is migrated through glucose-api.
/* eslint-disable no-console */
console.error('');
console.error('+================================================================+');
console.error('|  Migrations live in glucose-api.                               |');
console.error('|                                                                |');
console.error('|  Run prisma migrate there, then `npm run prisma:pull` here.    |');
console.error('|                                                                |');
console.error('|  See glucose-admin-api/PRISMA.md for the full workflow.        |');
console.error('+================================================================+');
console.error('');
process.exit(1);
