// Run after asset edits; use --check in CI to reject a stale release marker.
import fs from 'node:fs';import crypto from 'node:crypto';
const files=['app.js','tasks.js','planner-store.js','planner-actions.js','cache-update.js','styles.css','tasks.css','cancel-fix.css','config.js'];
const html=fs.readFileSync('index.html','utf8');
const normalized=html.replace(/\?v=[\w.-]+/g,'?v=BUILD').replace(/window.PLANNER_BUILD="[^"]+"/,'window.PLANNER_BUILD="BUILD"');
const hash=crypto.createHash('sha256').update(normalized);for(const f of files)hash.update(fs.readFileSync(f));
const build='2.0-'+hash.digest('hex').slice(0,12);
if(process.argv.includes('--check')){if(JSON.parse(fs.readFileSync('version.json')).build!==build)throw new Error('Run npm run version after asset edits.');console.log('Release hashes verified.');}
else{fs.writeFileSync('index.html',html.replace(/\?v=[\w.-]+/g,'?v='+build).replace(/window.PLANNER_BUILD="[^"]+"/,'window.PLANNER_BUILD="'+build+'"'));fs.writeFileSync('version.json',JSON.stringify({build})+'\n');const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest'));manifest.start_url='./index.html?v='+build;fs.writeFileSync('manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');console.log(build);}
