import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateEntrySenses, groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { meaningPairKey } from '../js/services/meaningEquivalenceLearning.js';
import { MEANING_COMPARISON_VERSION } from '../js/services/meaningComparison.js';
import { getPretrainedEquivalenceHead, MEANING_EMBEDDING_CENTER } from '../js/ml/pretrainedSemanticHeads.js';

const sense = (id, definition) => ({ id, word: 'testword', partOfSpeech: 'verb', definition });
const entry = {word: 'testword', senses: [sense('a', 'To commence.'), sense('b', 'To start doing something.')]};
const vector = index => Array.from({length: 768}, (_, i) => Number(i === index));
const centered = () => {
  const c = MEANING_EMBEDDING_CENTER;
  const scale = Math.sqrt(1 - c.reduce((s, x) => s + x*x, 0)) / Math.hypot(c[0], c[1]);
  return c.map((x, i) => x + (i === 0 ? scale*c[1] : i === 1 ? -scale*c[0] : 0));
};
function options(groups, records = []) {
  let calls = 0;
  return {storage: new MemoryStorage(), settings:{apiKey: 'synthetic-local-test-key', enabled: true},
    meaningLearningState:{records, head:null}, encodeDefinitionTexts: async () => null,
    fetchImpl:async (_url, request) => {
      calls++;
      const prompt = JSON.parse(request.body).contents[0].parts[0].text;
      const parts = JSON.parse(prompt.split('Parts: ')[1]);
      const result = typeof groups === 'function' ? groups(parts, prompt) : groups;
      return {ok:true, json:async () => ({candidates:[{content:{parts:[{text:JSON.stringify({parts:{p0:result}})}]}}]})};
    }, get calls(){return calls;}};
}
const group = members => ({members, definition:'To start doing something.', usageNote:''});

test('Gemini can split a local statistical merge, while retaining all original senses', async () => {
  const opts = options(parts => {
    assert.equal(parts[0].senses.length, 2);
    return [group(['0']), group(['1'])];
  });
  opts.meaningLearningState.head = head(10);
  opts.encodeDefinitionTexts = async texts => texts.map(centered);
  const result = await consolidateEntrySenses(entry, opts);
  assert.equal(opts.calls, 1);
  assert.equal(result.senses.length, 2);
  assert.deepEqual(result.senses.flatMap(s => s.groupedSenses.map(x => x.id)), ['a','b']);
});

test('a user distinction protects that pair without disabling Gemini for other meanings', async () => {
  const records = [{source:'user', label:0, key:meaningPairKey(entry.word, 'verb', entry.senses[0].definition, entry.senses[1].definition)}];
  const opts = options((parts,prompt) => {
    assert.match(prompt, /User-confirmed distinct ID pairs/);
    assert.equal(parts[0].senses.length, 4);
    return [group(['0']),group(['1']),group(['2','3'])];
  }, records);
  const result = await consolidateEntrySenses({...entry,senses:[...entry.senses,sense('c','To take into custody.'),sense('d','To arrest someone.')]},opts);
  assert.equal(opts.calls,1);
  assert.deepEqual(result.senses.map(s=>s.groupedSenses.length),[1,1,2]);
});

test('Gemini output contradicting a saved distinction fails closed with a visible warning', async () => {
  const records = [{source:'user',label:0,key:meaningPairKey(entry.word,'verb',entry.senses[0].definition,entry.senses[1].definition)}];
  const opts=options([group(['0','1'])],records);
  const result=await consolidateEntrySenses(entry,opts);
  assert.equal(result.senses.length,2);
  assert.match(result.consolidationWarning,/contradicted/);
  assert.equal(result.meaningInference.gemini,'failed');
});

function head(bias) {
  const result=getPretrainedEquivalenceHead();
  result.comparisonVersion=MEANING_COMPARISON_VERSION;
  result.threshold=.9;
  result.scorer={weights:Array(11).fill(0),mean:Array(11).fill(0),scale:Array(11).fill(1),bias};
  return result;
}

test('a calibrated equivalence rejection overrides high generic cosine similarity', async () => {
  const result=await groupEntrySensesLocally(entry,{storage:null,meaningLearningState:{records:[],head:head(-10)},encodeDefinitionTexts:async texts=>texts.map(centered)});
  assert.equal(result.senses.length,2);
  assert.equal(result.meaningInference.scorer,'calibrated-equivalence');
});

test('a calibrated equivalence acceptance merges low-cosine pairs and is reused during manual regrouping', async () => {
  const state={records:[],head:head(10)};
  const result=await groupEntrySensesLocally(entry,{storage:null,meaningLearningState:state,encodeDefinitionTexts:async texts=>texts.map((_,i)=>vector(i))});
  assert.equal(result.senses.length,1);
  const reused=await groupEntrySensesLocally(result,{storage:null,meaningLearningState:state,reuseSemanticScoresOnly:true,encodeDefinitionTexts:()=>assert.fail('Manual regrouping should reuse exact-model evidence')});
  assert.equal(reused.senses.length,1);
});

test('regrouping without any cached scores does not claim cached inference', async () => {
  const result=await groupEntrySensesLocally(entry,{storage:null,meaningLearningState:{records:[],head:null},reuseSemanticScoresOnly:true});
  assert.equal(result.meaningInference.local,'unavailable');
});

test('unavailable calibrated anchor evidence cannot claim an active scored model', async () => {
  let calls=0;
  const result=await groupEntrySensesLocally(entry,{storage:null,meaningLearningState:{records:[],head:head(10)},encodeDefinitionTexts:async texts=>++calls===1?texts.map(centered):null});
  assert.equal(result.senses.length,2);
  assert.equal(result.meaningInference.local,'unavailable');
  assert.match(result.meaningInference.reason,/Calibrated/);
  assert.equal(result.meaningEquivalenceModel,undefined);
  const reused=await groupEntrySensesLocally(result,{storage:null,meaningLearningState:{records:[],head:head(10)},reuseSemanticScoresOnly:true});
  assert.notEqual(reused.meaningInference.scorer,'calibrated-equivalence');
});

test('Gemini consolidation retains local review scores and a later judgment preserves other Gemini groups', async () => {
  const input={...entry,senses:[...entry.senses,sense('c','To arrest a person.'),sense('d','To take someone into custody.')]};
  const opts=options((_parts,prompt)=>prompt.includes('[["0","1"]]')?[group(['0']),group(['1']),group(['2','3'])]:[group(['0','1']),group(['2','3'])]);
  opts.encodeDefinitionTexts=async texts=>texts.map(centered);
  const first=await consolidateEntrySenses(input,opts);
  assert.equal(first.senses.length,2);
  assert.ok(first.meaningReviewScores.length>0);
  opts.meaningLearningState.records=[{source:'user',label:0,key:meaningPairKey(entry.word,'verb',entry.senses[0].definition,entry.senses[1].definition)}];
  const changed=await consolidateEntrySenses(first,{...opts,reuseSemanticScoresOnly:true});
  assert.deepEqual(changed.senses.map(s=>s.groupedSenses.length),[1,1,2]);
});
