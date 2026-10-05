// Checks the per-market document numbering (migration 20261005120000_per_store_document_numbers) against a development database:
//   node scripts/check-document-numbers.mjs         (DATABASE_URL, default: the local docker database)
// It makes two throw-away markets, takes numbers in them (also 40 at once), and removes them again.
import pg from "pg";
const URL = process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/olgax_pos";
const db = new pg.Client({ connectionString: URL }); await db.connect();
const q = (s, p) => db.query(s, p).then((r) => r.rows);
const ok = (name, cond, extra = "") => console.log(cond ? "PASS" : "**FAIL**", name, extra);
const nums = async (store, table = "PurchaseReceipt", col = "documentNo") => (await q(`select "${col}" n from "${table}" where "storeId"=$1 order by "${col}"`, [store])).map((r) => r.n);

await q(`delete from "Store" where id in ('zzn_a','zzn_b')`);
for (const id of ["zzn_a", "zzn_b"]) await q(`insert into "Store"(id,name,"updatedAt") values ($1,$1,now())`, [id]);
const user = (await q(`select id from "User" where role='ADMIN' limit 1`))[0].id;
const ins = (store, extra = "") => db.query(`insert into "PurchaseReceipt"(id,"storeId","userId") values ($1,$2,$3) returning "documentNo"`, ["zzr" + Math.random().toString(36).slice(2, 10), store, user]).then((r) => r.rows[0].documentNo);

// a) each market numbers on its own
const a = [await ins("zzn_a"), await ins("zzn_a"), await ins("zzn_a")];
const b = [await ins("zzn_b"), await ins("zzn_b")];
ok("a) market A gets 1,2,3", JSON.stringify(a) === "[1,2,3]", JSON.stringify(a));
ok("a) market B starts at 1 on its own", JSON.stringify(b) === "[1,2]", JSON.stringify(b));
// b) an explicit number is kept and the counter moves past it
await db.query(`insert into "PurchaseReceipt"(id,"storeId","userId","documentNo") values ('zzr_explicit','zzn_a',$1,50)`, [user]);
const after = await ins("zzn_a");
ok("b) explicit 50 kept, next is 51", (await q(`select "documentNo" n from "PurchaseReceipt" where id='zzr_explicit'`))[0].n === 50 && after === 51, "next=" + after);
// c) rollback leaves no gap
await db.query("begin"); const lost = await ins("zzn_b"); await db.query("rollback");
const next = await ins("zzn_b");
ok("c) a rolled-back insert gives its number back", lost === 3 && next === 3, `rolled back ${lost}, next ${next}`);
// d) 40 tills at once: distinct, consecutive
const pool = Array.from({ length: 40 }, () => new pg.Client({ connectionString: URL }));
await Promise.all(pool.map((c) => c.connect()));
const got = await Promise.all(pool.map((c) => c.query(`insert into "PurchaseReceipt"(id,"storeId","userId") values ($1,'zzn_b',$2) returning "documentNo"`, ["zzc" + Math.random().toString(36).slice(2, 10), user]).then((r) => r.rows[0].documentNo)));
await Promise.all(pool.map((c) => c.end()));
const sorted = [...got].sort((x, y) => x - y);
ok("d) 40 parallel inserts: all different and consecutive", new Set(got).size === 40 && sorted[39] - sorted[0] === 39, `${sorted[0]}..${sorted[39]}`);
// e) registers numbered per market
await q(`insert into "Cashbox"(id,"storeId",name,"updatedAt") values ('zzcbA1','zzn_a','a1',now()),('zzcbA2','zzn_a','a2',now()),('zzcbB1','zzn_b','b1',now())`);
ok("e) Cashbox.no per market", JSON.stringify(await nums("zzn_a", "Cashbox", "no")) === "[1,2]" && JSON.stringify(await nums("zzn_b", "Cashbox", "no")) === "[1]", JSON.stringify([await nums("zzn_a", "Cashbox", "no"), await nums("zzn_b", "Cashbox", "no")]));
// f) the existing market kept its numbers and continues after its highest
const main = await q(`select max("documentNo") m from "Sale" where "storeId"='store_main'`);
const counter = await q(`select last from "DocumentCounter" where "storeId"='store_main' and kind='Sale'`);
ok("f) existing market: counter = highest existing Sale number", Number(counter[0]?.last ?? 0) === Number(main[0].m ?? 0), `${counter[0]?.last} vs ${main[0].m}`);
// g) deleting a market removes its counters
await q(`delete from "Store" where id in ('zzn_a','zzn_b')`);
ok("g) counters of a deleted market are gone", Number((await q(`select count(*) c from "DocumentCounter" where "storeId" in ('zzn_a','zzn_b')`))[0].c) === 0);
await db.end();
