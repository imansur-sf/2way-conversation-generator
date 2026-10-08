const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');

const lines = fs.readFileSync(path.join(__dirname, '..', 'interactive-simulator-builder.html'), 'utf8').split('\n');
const clone = value => JSON.parse(JSON.stringify(value));
function source(prefix) {
  const start = lines.findLastIndex(line => line.trim().startsWith(prefix));
  assert.ok(start >= 0, `source exists: ${prefix}`);
  let code = '';
  for (let index = start; index < lines.length; index++) {
    code += `${lines[index]}\n`;
    try { new vm.Script(code); return code; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  throw new Error(`Incomplete source: ${prefix}`);
}
const fn = name => source(`function ${name}(`);

for (const channel of ['sms', 'rcs', 'whatsapp', 'email']) {
  for (const author of ['customer', 'brand']) {
    test(`adding ${author} in ${channel} saves the render-stable multi-channel revision`, async () => {
      const writes = [], notices = [], cache = new Map();
      const scenario = {
        id:'journey', name:'Synthetic journey', scenarioMode:'multi', channel,
        variants:Object.fromEntries(['sms', 'rcs', 'whatsapp', 'email'].map(key => [key, {
          channel:key, brandName:'Example',
          steps:[{id:`existing-${key}`, author:'brand', kind:'text', text:'Existing message'}]
        }]))
      };
      const state = {scenarios:[scenario], activeId:scenario.id};
      const context = vm.createContext({
        state, crypto:webcrypto, window:{}, isStandaloneExport:false,
        cloneValue:clone, journeyChannels:['sms', 'rcs', 'whatsapp', 'email'],
        journeyMeta:new Set(['id', 'name', 'scenarioMode', 'variants', 'channel']),
        active:() => state.scenarios[0], seed:{scenarios:[]},
        scenarioStoreKey:'current', localStorageCacheLimit:420000, saved:'',
        localStorage:{setItem:(key, value) => cache.set(key, value)},
        durableScenarioRecord:'current', durableSaveSequence:0, durableLastSavedAt:0,
        preserveDurableRecoveryRecord:() => Promise.resolve(),
        durableWrite:(key, value) => { writes.push({key, value:clone(value)}); return Promise.resolve(); },
        rememberChannelSaveSignatures(){}, resetRuntime(){}, persist(){},
        showStorageNotice:(detail, outcome) => notices.push({detail, outcome}),
        renderAll:() => context.ensureJourneyState(),
      });
      vm.runInContext([
        ...['normalizeScenarioIdentifiers', 'journeyVariant', 'isJourneyVariant',
          'normalizeJourneyStep', 'normalizeJourneyVariant', 'normalizeJourney',
          'captureJourneyVariant', 'projectJourneyVariant', 'ensureJourneyState',
          'writeSmallLocalCache', 'add'].map(fn),
        source("persist=function(){captureJourneyVariant();if(isStandaloneExport){const saveState=$('#saveState');if(saveState)saveState.textContent='Standalone HTML';return Promise.resolve(true)}"),
      ].join('\n'), context);
      context.ensureJourneyState();
      const previousStep = scenario.steps[0];
      const inactiveBefore = clone(Object.fromEntries(Object.entries(scenario.variants).filter(([key]) => key !== channel)));
      const persist = context.persist;
      let pending;
      context.persist = () => {
        assert.equal(scenario.steps[0], previousStep, 'adding a step must not replace existing objects before saving');
        pending = persist();
        return pending;
      };

      context.add(author);
      assert.equal(await pending, true);
      assert.equal(writes.length, 1);
      const stored = writes[0].value;
      assert.deepEqual(stored.scenarios, clone(state.scenarios), 'rendering must not add defaults after the saved snapshot');
      assert.deepEqual(JSON.parse(cache.get('current')), stored);
      assert.equal(state.unsavedScenarioChanges, false);
      assert.equal(state.lastScenarioSaveOutcome, 'saved');
      assert.equal(notices.at(-1).outcome, 'saved');
      const added = stored.scenarios[0].steps.at(-1);
      assert.equal(added.author, author);
      assert.equal(added.kind, author === 'brand' ? 'text' : 'free');
      assert.equal(added.reusableSet, true, 'new steps retain the existing normalization default');
      assert.equal(added.articleEnabled, false);
      assert.deepEqual(clone(Object.fromEntries(Object.entries(scenario.variants).filter(([key]) => key !== channel))), inactiveBefore);
    });
  }
}
