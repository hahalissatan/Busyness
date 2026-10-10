// Temporary probe — check how pg returns DATE columns
import { query } from "./src/db/pool.js";

const res = await query("SELECT CURRENT_DATE as today");
const today = res.rows[0].today;

console.log("typeof today:", typeof today);
console.log("instanceof Date:", today instanceof Date);
console.log("String(today):", String(today));
console.log("String(today).slice(0,10):", String(today).slice(0, 10));
if (today instanceof Date) {
  console.log("today.toISOString():", today.toISOString());
  console.log("today.toISOString().slice(0,10):", today.toISOString().slice(0, 10));
}

// Also check what a raw date string looks like
const res2 = await query("SELECT '2026-10-10'::date as explicit_date");
const ed = res2.rows[0].explicit_date;
console.log("\nexplicit_date:");
console.log("typeof:", typeof ed);
console.log("instanceof Date:", ed instanceof Date);
console.log("String(ed):", String(ed));
console.log("String(ed).slice(0,10):", String(ed).slice(0, 10));
if (ed instanceof Date) {
  console.log("toISOString:", ed.toISOString());
  console.log("toISOString.slice(0,10):", ed.toISOString().slice(0, 10));
}

process.exit(0);
