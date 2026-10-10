const {test, before, after, beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc, setDoc, getDoc, updateDoc, deleteDoc, runTransaction, collection, getDocs}=require('firebase/firestore');
let env, db;
const projectId='demo-mahjong-record-protection';
function record(kind='create', overrides={}) {
  return {version:11,id:'op_1',client:'device_1',clock:1,time:1791590000000,
    kind,target:'game_1',field:'',value:{id:'game_1',date:'2026-10-10',memo:'',
      players:Array.from({length:4},()=>({name:'',score:''}))},...overrides};
}
const ref=(id='op_1',board='default')=>doc(db,`mahjongScoreAppsV11/${board}/events/${id}`);
before(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Tests require the isolated emulator; production access is forbidden.');
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
  db=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>env.clearFirestore());
after(async()=>env?.cleanup());
test('valid seed, field edits, archive, restore, rate and note are append-only readable',async()=>{
  await assertSucceeds(setDoc(ref(),record()));
  const kinds=[record('edit',{id:'op_2',clock:2,field:'players.0.score',value:'40000'}),
    record('archive',{id:'op_3',clock:3,value:true}),record('archive',{id:'op_4',clock:4,value:false}),
    record('rate',{id:'op_5',clock:5,target:'2026-10-10',value:'100'}),
    record('note',{id:'op_6',clock:6,target:'2026-10-10',value:'メモ'})];
  for(const e of kinds)await assertSucceeds(setDoc(ref(e.id),e));
  const snapshot=await assertSucceeds(getDocs(collection(db,'mahjongScoreAppsV11/default/events')));
  assert.equal(snapshot.size,6);
});
test('replacing, clearing or deleting a stored event is denied',async()=>{
  await assertSucceeds(setDoc(ref(),record()));
  await assertFails(setDoc(ref(),record('archive',{value:true})));
  await assertFails(updateDoc(ref(),{value:[]}));
  await assertFails(deleteDoc(ref()));
  assert.equal((await getDoc(ref())).data().kind,'create');
});
test('idempotent retries may read an existing event without writing it',async()=>{
  await assertSucceeds(setDoc(ref(),record()));
  await assertSucceeds(runTransaction(db,async tx=>{const existing=await tx.get(ref());if(!existing.exists)tx.set(ref(),record());}));
});
test('legacy whole-array overwrite and legacy deletion are denied',async()=>{
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'mahjongScoreApps/default'),{games:[{id:1}]}));
  const legacy=doc(db,'mahjongScoreApps/default');
  await assertSucceeds(getDoc(legacy));
  await assertFails(setDoc(legacy,{games:[]}));await assertFails(deleteDoc(legacy));
});
test('invalid payloads, nested fields, extra keys, bad ID and oversized input are denied',async()=>{
  await assertFails(setDoc(ref(),record('edit',{field:'players',value:[]})));
  await assertFails(setDoc(ref(),record('edit',{field:'players.4.score',value:'100'})));
  await assertFails(setDoc(ref(),record('edit',{field:'players.0.score',value:'1'.repeat(41)})));
  await assertFails(setDoc(ref(),record('note',{target:'2026-10-10',value:'x'.repeat(2001)})));
  await assertFails(setDoc(ref(),record('create',{value:{}})));
  await assertFails(setDoc(ref(),{...record(),games:[]}));
  await assertFails(setDoc(ref('other_id'),record()));
  await assertFails(setDoc(ref(),record('edit',{field:'__proto__',value:'x'})));
});
test('unconfigured boards cannot be read or written',async()=>{
  await assertFails(setDoc(ref('op_1','another-board'),record()));
  await assertFails(getDocs(collection(db,'mahjongScoreAppsV11/another-board/events')));
});
