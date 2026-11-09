import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RagProvider } from '../server/rag-provider.ts';

test('Optional embedding/rerank requires explicit opt-in and respects persistent daily quota', {timeout:20000},async()=>{
  const old=process.env.TSUKIREI_ALLOW_LOCAL_AI;
  process.env.TSUKIREI_ALLOW_LOCAL_AI='1';
  const dir=mkdtempSync(join(tmpdir(),'tsukirei-rag-provider-'));
  const calls=[];
  const mock=createServer(async(req,res)=>{
    let body='';
    for await(const part of req)body+=String(part);
    calls.push({path:req.url,authorization:req.headers.authorization,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.endsWith('/embeddings'))res.end(JSON.stringify({data:[{embedding:[1,0,.4]}]}));
    else res.end(JSON.stringify({results:[{index:1,relevance_score:.9},{index:0,relevance_score:.1}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  try{
    const endpoint='http://127.0.0.1:'+mock.address().port+'/v1';
    const provider=new RagProvider(dir);
    assert.equal(provider.public().embeddingsEnabled,false);
    assert.equal(await provider.embed('память'),null);
    assert.equal(await provider.rerank('память',['один','два']),null);
    assert.equal(calls.length,0);
    assert.throws(()=>provider.update({embeddingsEnabled:true}),/URL|ключ/);
    assert.throws(()=>provider.update({endpoint:'https://example.com/v1'}),/Cloud.ru/);
    const settings=provider.update({
      endpoint,model:'mock-embedding',apiKey:'private-embed-key',
      rerankEndpoint:endpoint,rerankModel:'mock-rerank',rerankApiKey:'private-rerank-key',
      embeddingsEnabled:true,autoEmbed:true,rerankEnabled:true,maxCallsPerDay:3
    });
    assert.equal(settings.hasKey,true);
    assert.equal(settings.hasRerankKey,true);
    assert.equal(JSON.stringify(settings).includes('private-'),false);
    assert.equal(provider.autoEmbed,true);
    const first=await provider.embed('память');
    assert.deepEqual(first.vector,[1,0,.4]);
    const reused=await provider.embed('память');
    assert.deepEqual(reused.vector,[1,0,.4]);
    assert.equal(calls.length,1,'Vector cache avoids repeated paid requests');
    assert.deepEqual(await provider.rerank('память',['один','два']),[.1,.9]);
    await provider.embed('другая память');
    assert.equal(calls.length,3);
    await assert.rejects(provider.embed('совсем другой запрос'),/лимит/);
    const restarted=new RagProvider(dir);
    assert.equal(restarted.public().requestsToday,3);
    await assert.rejects(restarted.embed('третий запрос'),/лимит/);
    restarted.update({embeddingsEnabled:false,autoEmbed:false,rerankEnabled:false});
    assert.equal(await restarted.embed('offline'),null);
    assert.ok(calls.every(x=>x.authorization?.startsWith('Bearer private-')));
  }finally{
    mock.close();
    rmSync(dir,{recursive:true,force:true});
    if(old===undefined)delete process.env.TSUKIREI_ALLOW_LOCAL_AI;
    else process.env.TSUKIREI_ALLOW_LOCAL_AI=old;
  }
});
