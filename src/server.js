import { openDb } from './db.js';
import { seedDatabase } from './seed.js';
import { createApp } from './app.js';

const db = openDb();
if (seedDatabase(db)) console.log('Database was empty: demo campus, accounts and timetable created.');

const port = Number(process.env.PORT) || 4000;
createApp(db).listen(port, '0.0.0.0', () => {
  console.log(`HallFinder API running on http://localhost:${port}`);
});
