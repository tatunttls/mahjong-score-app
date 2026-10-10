const vm=require('node:vm'), fs=require('node:fs'), assert=require('node:assert/strict'), path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
let passed=0;
function check(name, fn){fn();console.log('PASS',name);passed++;}
const server=new Map();
function storage(map=new Map()) {return {map,fail:false,get length(){return map.size},key:i=>[...map.keys()][i],getItem:key=>map.get(key)??null,setItem(key,value){if(this.fail)throw new Error('quota');map.set(key,String(value));},removeItem:key=>map.delete(key)};}
function page(local=storage()){
 const nodes=new Map(),handlers=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},appendChild(){},querySelector(){return null},focus(){},blur(){},click(){},clientWidth:390});return nodes.get(id);}
 const doc={activeElement:null,visibilityState:'visible',getElementById:node,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>node(webcrypto.randomUUID()),addEventListener(){}};
 const state={fail:false,creates:0,gets:0,listener:null};
 const collection={doc:id=>({id}),onSnapshot:(options,next,error)=>{state.listener=next;state.error=error;}};
 const db={collection:()=>({doc:()=>({collection:()=>collection})}),runTransaction:async fn=>{
   if(state.fail)throw new Error('simulated failure');
   let write;
   await fn({get:async ref=>{state.gets++;let e=server.get(ref.id);return {exists:!!e,data:()=>structuredClone(e)}},set:(ref,e)=>{write={ref,e:structuredClone(e)}}});
   if(write){assert.equal(server.has(write.ref.id),false,'must never replace an event');server.set(write.ref.id,write.e);state.creates++;}
 }};
 const timers=new Map();let timerId=0;
 const ctx={console:{error(){}},crypto:webcrypto,localStorage:local,sessionStorage:storage(),document:doc,navigator:{onLine:true,userAgent:'test'},setTimeout:(fn,ms)=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),setInterval:()=>{},alert:message=>state.alert=message,confirm:()=>true,structuredClone,Blob,URL};
 ctx.window=ctx;ctx.globalThis=ctx;ctx.addEventListener=(name,fn)=>handlers.set(name,fn);
 ctx.MAHJONG_FIREBASE_CONFIG={projectId:'mock'};ctx.MAHJONG_FIREBASE_DOC_ID='default';
 ctx.firebase={apps:[],initializeApp(){this.apps.push({})},firestore:()=>db};
 const context=vm.createContext(ctx);
 for(const file of ['record-store.js','safe-sync.js','script.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 const run=source=>vm.runInContext(source,context);
 const deliver=(list=[...server.values()],fromCache=false)=>{
   state.listener({metadata:{fromCache},docs:list.map(e=>({id:e.id,data:()=>Object.fromEntries(Object.entries(structuredClone(e)).sort(([a],[b])=>a.localeCompare(b))),metadata:{hasPendingWrites:false}}))});
 };
 deliver();return {ctx,run,state,local,nodes,deliver,handlers};
}
async function main(){
 const a=page(),b=page();a.ctx.navigator.onLine=false;b.ctx.navigator.onLine=false;
 a.run('addGameToSelectedDate();updateName(0,0,"佐藤");updateScoreValue(0,0,{value:"42000"},false)');
 b.run('addGameToSelectedDate();updateName(0,0,"山田");updateScoreValue(0,1,{value:"18000"},false)');
 check('input creates an immutable seed and durable pending journal',()=>{
  assert.equal(a.run('[...recordEvents.values()].find(e=>e.kind==="create").value.players[0].score'),'');
  assert.equal(a.run('pendingEvents.size'),3);assert.equal(a.local.map.size,3);
 });
 const merged=[...a.run('[...recordEvents.values()]'),...b.run('[...recordEvents.values()]')];
 a.deliver(merged);b.deliver(merged);a.run('localEditUntil=0;applyRecordProjection(true)');b.run('localEditUntil=0;applyRecordProjection(true)');
 check('two devices converge without replacing either game',()=>{
  assert.equal(a.run('games.length'),2);assert.equal(b.run('games.length'),2);
  assert.equal(a.run('games.find(g=>g.players[0].name==="佐藤").players[0].score'),'42000');
 });
 const id=a.run('games.find(g=>g.players[0].name==="佐藤").id');
 a.run(`updateName(games.findIndex(g=>g.id===${JSON.stringify(id)}),1,"鈴木")`);
 const remoteNote={version:11,id:'remote_note',client:'remote',clock:100,time:Date.now(),kind:'note',target:'2026-10-10',field:'',value:'メモが残る'};
 a.deliver([...merged,remoteNote]);
 check('remote update is buffered during input rather than discarded',()=>{
  assert.equal(a.run('projectionDue'),true);assert.equal(a.run('recordEvents.has("remote_note")'),true);
  a.run('localEditUntil=0;applyRecordProjection()');assert.equal(a.run('dateNotes["2026-10-10"]'),'メモが残る');
  assert.equal(a.run(`games.find(g=>g.id===${JSON.stringify(id)}).players[1].name`),'鈴木');
 });
 a.deliver([]);a.run('localEditUntil=0;applyRecordProjection(true)');
 check('empty authoritative snapshot retains all known games and requeues missing events',()=>{
  assert.equal(a.run('games.length'),2);assert.equal(a.run('pendingEvents.size'),a.run('recordEvents.size'));
 });
 a.run(`deleteGame(games.findIndex(g=>g.id===${JSON.stringify(id)}))`);
 check('trash keeps full record and restores original score',()=>{
  assert.equal(a.run('games.length'),1);assert.equal(a.run('MahjongStore.project(recordEvents.values()).trash.length'),1);
  a.run(`restoreRecord(${JSON.stringify(id)})`);assert.equal(a.run(`games.find(g=>g.id===${JSON.stringify(id)}).players[0].score`),'42000');
 });
 a.run(`updateScoreValue(games.findIndex(g=>g.id===${JSON.stringify(id)}),0,{value:"39000"},false)`);
 a.run('undoRecordEvent([...recordEvents.values()].filter(e=>e.kind==="edit"&&e.field==="players.0.score").sort(MahjongStore.compare).at(-1).id)');
 check('undo restores only selected field and retains unrelated name/note',()=>{
  assert.equal(a.run(`games.find(g=>g.id===${JSON.stringify(id)}).players[0].score`),'42000');
  assert.equal(a.run(`games.find(g=>g.id===${JSON.stringify(id)}).players[1].name`),'鈴木');
  assert.equal(a.run('dateNotes["2026-10-10"]'),'メモが残る');
 });
 const backup={version:11,project:'mock',board:'default',events:a.run('[...recordEvents.values()]')};
 const c=page();c.ctx.navigator.onLine=false;
 c.ctx.__input={files:[{size:100,text:async()=>JSON.stringify(backup)}],value:'file'};
 await c.run('importRecordBackup(__input)');const imported=c.run('recordEvents.size');
 c.ctx.__input.value='file';await c.run('importRecordBackup(__input)');
 check('backup round trip merges idempotently and restores notes',()=>{
  assert.equal(c.run('games.length'),2);assert.equal(c.run('recordEvents.size'),imported);
  assert.equal(c.run('dateNotes["2026-10-10"]'),'メモが残る');
 });
 const corrupt=structuredClone(backup);corrupt.events[0].value.date='2099-01-01';
 c.ctx.__input.files[0].text=async()=>JSON.stringify(corrupt);await c.run('importRecordBackup(__input)');
 check('conflicting backup ID is rejected without touching existing records',()=>{
  assert.equal(c.run('recordEvents.size'),imported);assert.match(c.state.alert,/一致しません/);
 });
 c.ctx.navigator.onLine=true;c.state.fail=true;await c.run('flushRecordQueue()');
 check('rejected server writes retain outbox and expose failure',()=>{
  assert.ok(c.run('pendingEvents.size')>0);assert.match(c.nodes.get('saveStatus').textContent,/失敗/);
 });
 const reloaded=page(c.local);reloaded.state.fail=true;await new Promise(setImmediate);await reloaded.run('flushRecordQueue()');
 check('reload retains games and outbox after failed save',()=>{
  assert.equal(reloaded.run('games.length'),2);assert.ok(reloaded.run('pendingEvents.size')>0);
 });
 reloaded.state.fail=false;await reloaded.run('flushRecordQueue()');
 check('retry uploads append-only records and confirms status',()=>{
  assert.equal(reloaded.run('pendingEvents.size'),0);assert.match(reloaded.nodes.get('saveStatus').textContent,/共有に保存済み/);
 });
 const creates=reloaded.state.creates;
 reloaded.run('for(const id of recordEvents.keys())pendingEvents.add(id)');await reloaded.run('flushRecordQueue()');
 check('duplicate retries read existing records without update',()=>{assert.equal(reloaded.state.creates,creates);});
 reloaded.deliver();
 check('Firestore map field ordering does not cause false conflicts',()=>{assert.equal(reloaded.run('storageError'),'');});
 reloaded.local.fail=true;
 reloaded.run(`updateScoreValue(games.findIndex(g=>g.id===${JSON.stringify(id)}),0,{value:"99999"},false)`);
 check('capacity failure rolls back displayed value and is never shown as saved',()=>{
  assert.equal(reloaded.run(`games.find(g=>g.id===${JSON.stringify(id)}).players[0].score`),'42000');
  assert.match(reloaded.nodes.get('saveStatus').textContent,/端末への保存に失敗/);
 });reloaded.local.fail=false;
 const broken=storage();broken.setItem('mahjong-v11:mock:default:event:broken','not json');const d=page(broken);
 check('corrupt local JSON remains preserved with a visible error',()=>{
  assert.equal(broken.getItem('mahjong-v11:mock:default:event:broken'),'not json');assert.match(d.nodes.get('saveStatus').textContent,/読めない履歴/);
 });
 const shared=storage();const t1=page(shared),t2=page(shared);t1.ctx.navigator.onLine=false;t2.ctx.navigator.onLine=false;
 t1.run('addGameToSelectedDate();updateName(games.length-1,0,"タブ1")');
 t2.run('addGameToSelectedDate();updateName(games.length-1,0,"タブ2")');
 for(const [key,newValue]of shared.map){t1.handlers.get('storage')({key,newValue});t2.handlers.get('storage')({key,newValue});}
 t1.run('localEditUntil=0;applyRecordProjection(true)');t2.run('localEditUntil=0;applyRecordProjection(true)');
 check('two tabs sharing storage do not overwrite each other journals',()=>{
  assert.equal(t1.run('games.some(g=>g.players[0].name==="タブ1")'),true);
  assert.equal(t1.run('games.some(g=>g.players[0].name==="タブ2")'),true);
 });
 const calc=a.run('ensureCalculatedGame({players:[{score:40000},{score:30000},{score:20000},{score:10000}]})');
 check('existing mahjong calculation remains zero-sum and ranks correctly',()=>{
  assert.equal(calc.isValidTotal,true);assert.deepEqual(Array.from(calc.players,p=>p.result),[40,5,-15,-30]);
 });
 console.log(`${passed} integration checks passed with isolated storage and mocked Firebase. No production data changed.`);
}
main().catch(error=>{console.error(error);process.exit(1)});
