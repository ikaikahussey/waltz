// scripts/migrate.js — Apply the SQLite schema.
import 'dotenv/config';
import { initDb, closeDb } from '../lib/db.js';

initDb();
console.log('waltz: migrations applied');
closeDb();
