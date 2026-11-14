import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanResourceTitle,titleFromDownloader,metadataCanName,youtubeMetadataEndpoint,fetchYoutubeTitle} from './resource-titles.js';

test('title enrichment preserves user names and unknown legacy provenance',()=>{
 const resource={name:'https://youtu.be/example',url:'https://youtu.be/example',name_source:'url_fallback'};
 assert.equal(metadataCanName(resource),true);
 for(const patch of [{name_source:'user'},{name_source:null},{name_source:'metadata'},{name:'My experiment'}])assert.equal(metadataCanName({...resource,...patch}),false);
 assert.equal(cleanResourceTitle('  Lab\nwork\x00 '),'Lab work');
 assert.equal(Array.from(cleanResourceTitle('🔬'.repeat(210))).length,200);
 assert.equal(cleanResourceTitle(null),null);
});
test('downloader titles accept JSON data only and bound log records',()=>{
 assert.equal(titleFromDownloader('progress\nLABOS_TITLE:"A real title"\nprogress'),'A real title');
 assert.equal(titleFromDownloader('LABOS_TITLE:process.exit()'),null);
 assert.equal(titleFromDownloader('LABOS_TITLE:'+JSON.stringify('x'.repeat(9000))),null);
 assert.equal(titleFromDownloader('LABOS_TITLE:{"title":"object"}'),null);
});
test('metadata lookup stays on the fixed HTTPS provider without following redirects',async()=>{
 for(const url of ['https://youtube.com.evil.test/watch?v=x','http://localhost/a','file:///a','https://user:secret@youtube.com/watch?v=x'])assert.equal(youtubeMetadataEndpoint(url),null);
 let called=false;
 const title=await fetchYoutubeTitle('https://youtu.be/example',{fetcher:async(url,options)=>{called=true;assert.equal(new URL(url).origin,'https://www.youtube.com');assert.equal(options.redirect,'error');return new Response(JSON.stringify({title:'Real title'}));}});
 assert.equal(called,true);assert.equal(title,'Real title');
 await assert.rejects(fetchYoutubeTitle('https://youtu.be/example',{fetcher:async()=>new Response('x'.repeat(65537))}),/bound/);
 await assert.rejects(fetchYoutubeTitle('https://youtu.be/example',{fetcher:async()=>new Response('{}',{status:503})}),/unavailable/);
 assert.equal(await fetchYoutubeTitle('https://example.test/a',{fetcher:()=>assert.fail('unexpected network')}),null);
});
