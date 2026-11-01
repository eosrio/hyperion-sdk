// Source-oracle controls only: original Git blobs are inspected, not executed against PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root=new URL('./fixtures/indexed-query-original-2.7/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const pinned={'schemas.ts':'9af0899d2e53e538f34abff204abdbc9aba08807b1f03be72ae718ff4d41887e','validation.ts':'daca1f17ad21cd4bafc72e12f240d644e9a3517451cd9ca64b861c87c26f51b1','builder.ts':'2ae1e3b89da2e42e826e00eed65fda2576a4da7b83fbc6cc3ccedc6e72b8cbf3'};
const source={};
for(const [name,info] of Object.entries(manifest.sources)){
 const data=readFileSync(new URL(name,root));assert.equal(data.length,info.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),info.sha256);if(name in pinned)assert.equal(info.sha256,pinned[name]);source[name]=data.toString('utf8');
}
assert.deepEqual(Object.keys(manifest.sources).sort(),['LICENSE','builder.ts','schemas.ts','validation.ts']);
test('pinned original validates match names before using literal POSITION, not a pattern operator',()=>{
 assert.equal(manifest.commit,'0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e');
 const line=source['validation.ts'].match(/^const nameRE = \/(.+)\/;$/m);assert.ok(line);const nameRE=new RegExp(line[1]);
 for(const name of ['a','a.b','abc12345','............','abcdefghijklj'])assert.equal(nameRE.test(name),true,name);
 for(const name of ['A','a_b','a%b','a*b','a?b','abcdefghijklk'])assert.equal(nameRE.test(name),false,name);
 const sql="query.addCondition('POSITION(' + query.addVariable(args.match.toLowerCase()) + ' IN schema_name) > 0');";
 assert.ok(source['schemas.ts'].includes("match: {type: 'name'}"));assert.ok(source['schemas.ts'].includes(sql));
 // Examples illustrate literal/case-sensitive matching; these controls do not execute SQL.
 assert.equal('a.b'.includes('.'),true);assert.equal('axb'.includes('.'),false);
 assert.equal('ALPHA'.includes('a'),false);assert.equal('alpha'.includes('a'),true);
});
test('pinned source retains nullable joined sort and unpaginated exact count branch',()=>{
 const sourceText=source['schemas.ts'];assert.ok(sourceText.includes("assets: 'ac.assets'"));assert.ok(sourceText.includes("' NULLS LAST, schema_name ASC'"));
 assert.ok(sourceText.includes('COALESCE(ac.assets, 0) assets'));assert.ok(sourceText.includes("'SELECT COUNT(*) counter FROM (' + query.buildString() + ') x'"));
 assert.ok(sourceText.indexOf('if (args.count)')<sourceText.indexOf('query.paginate(args.page, args.limit)'));
 assert.ok(source['builder.ts'].includes('OFFSET '));assert.ok(source['builder.ts'].includes('= ANY('));
});
