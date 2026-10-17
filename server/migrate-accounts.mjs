// Apply NexGameWorld accounts schema exactly once per database.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createAccountStore} from './account-store.js';
const location=dirname(fileURLToPath(import.meta.url));
if(!process.env.DATABASE_URL){
 console.error('DATABASE_URL is not set; refusing migration');
 process.exit(1);
}
if(process.env.NGW_MIGRATION_APPROVED!=='yes'){
 console.error('Set NGW_MIGRATION_APPROVED=yes for this one-time migration command');
 process.exit(1);
}
const sql=await readFile(resolve(location,'migrations/001_accounts_characters.sql'),'utf8');
const store=createAccountStore();
try{
 await store.ping();
 // Migration script is additive/idempotent and wraps changes in a transaction.
 // It contains no DELETE or DROP statements.
 const {default:pg}=await import('pg');
 const {Pool}=pg;
 const pool=new Pool({connectionString:process.env.DATABASE_URL,
  connectionTimeoutMillis:6000,ssl:{rejectUnauthorized:true},max:1});
 try{
  await pool.query(sql);
  console.log('NexGameWorld account schema ready');
 }finally{await pool.end()}
}catch(error){
 console.error('Account database migration failed:',error?.code||error?.name||'unknown');
 process.exitCode=1;
}finally{await store.close()}
