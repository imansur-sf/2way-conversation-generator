'use strict';

const escape = value => value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
const words = value => String(value || '').normalize('NFC').toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) || [];
const normalized = value => words(value).join(' ');
const customer = /\b(?:customer|prospect|recipient|lead|member)\b/i;
const renewal = /\b(?:renew(?:s|al|als|ed|ing)?|expir(?:e|es|ing|y|ation))\b/i;
const membership = /\b(?:membership|subscription|plan)\b/i;
const loyalty = /\b(?:loyalty|rewards?)\b/i;
const points = /\bpoints?\b/i;
const human = /\b(?:human|live|rep|representative|agent|advisor|specialist|colleague|teammate|team member|account executive)\b/i;
const hesitation = /\b(?:hesitat\w*|debat\w*|unsure|uncertain|undecided|not (?:so )?sure|might not|may not|cancel\w*|not renew\w*|whether to renew|worth it|think (?:it|this) over|think about it)\b/i;
const amounts = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,twenty:20,thirty:30};

function companyAliases(companyName, prompt) {
  const aliases = new Set([companyName.trim()].filter(Boolean));
  const acronym = value => (value.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).filter(word => !/^(?:the|and|of|for)$/i.test(word)).map(word => word[0]).join('').toUpperCase();
  const base = companyName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (base) aliases.add(base);
  const initials = acronym(base);
  if (initials.length >= 2 && initials.length <= 8) aliases.add(initials);
  for (const match of companyName.matchAll(/\(([A-Z]{2,8})\)/g)) aliases.add(match[1]);
  // Expand a supplied acronym only from an exact initials match in this prompt.
  if (/^[A-Z]{2,8}$/.test(base)) {
    const tokens = [...prompt.matchAll(/\p{Lu}[\p{L}\p{M}'’-]*/gu)];
    for (let start = 0; start < tokens.length; start++) {
      for (let end = start + 1; end < Math.min(tokens.length, start + 8); end++) {
        if (!/^[ \t]+$/.test(prompt.slice(tokens[end - 1].index + tokens[end - 1][0].length, tokens[end].index))) break;
        const candidate = prompt.slice(tokens[start].index, tokens[end].index + tokens[end][0].length);
        if (acronym(candidate) === base) aliases.add(candidate);
      }
    }
  }
  return [...aliases].sort((a,b) => b.length - a.length);
}

function openingDirectives(prompt) {
  return [...prompt.matchAll(/\b(?:start|begin|open)(?:\s+the\s+(?:conversation|demo|flow))?\s+with\s+(?:the\s+)?(company|customer)\b/gi)].map(match=>{
    const sender=match[1].toLowerCase(), negative=/\b(?:do not|don't|never|must not)\s*$/i.test(prompt.slice(Math.max(0,match.index-25),match.index));
    return negative ? sender==='company'?'customer':'company' : sender;
  });
}
function requestedInitialSender(prompt, companyName = '') {
  const explicit=openingDirectives(prompt)[0];
  if (explicit) return explicit;
  const aliases = companyAliases(companyName, prompt).map(escape);
  const actors = '(company|brand' + (aliases.length ? '|' + aliases.join('|') : '') + '|customer|prospect|recipient|lead)';
  const name = "(?:[ \\t]+(?:named|called)[ \\t]+[\\p{L}'’ -]{1,80}?|[ \\t]*\\([^\\n)]{1,80}\\)|[ \\t]*,[ \\t]*[\\p{L}'’ -]{1,80}?,)?";
  const modifiers = '(?:[ \\t]+(?:will|would|should|must|can|then|first|also|later|now|still|very|just|[\\p{L}]{2,20}ly)){0,3}';
  const verbs = '(?:says?|sends?|shares?|announces?|invites?|responds?|repl(?:y|ies)|asks?|contacts?|messages?|reminds?|provides?|offers?|opens?|begins?|starts?|reaches?[ \\t]+out)';
  const pattern = new RegExp('\\b' + actors + '\\b' + name + modifiers + '[ \\t]+' + verbs + '\\b', 'giu');
  for (const match of prompt.matchAll(pattern)) {
    const preceding = prompt.slice(Math.max(0, match.index - 35), match.index);
    // A response/relative clause is not evidence of an opening action.
    if (/\b(?:which|who|whom|whose|that|when|after|once|until|if)\s+(?:(?:a|the|current)\s+)?$/i.test(preceding)) continue;
    if (/\b(?:later|then|afterwards|subsequently)\b/i.test(preceding+match[0]) || /\b(?:responds?|repl(?:y|ies))\b/i.test(match[0])) return null;
    return /^(?:customer|prospect|recipient|lead)$/i.test(match[1]) ? 'customer' : 'company';
  }
  return null;
}

function periods(value) {
  const found = [];
  for (const match of normalized(value).matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\s+(days?|weeks?|months?)\b/g)) {
    const amount = Number(match[1]) || amounts[match[1]], unit = match[2].replace(/s$/, '');
    if (amount > 0) found.push({amount:unit === 'week' ? amount * 7 : amount, unit:unit === 'week' ? 'day' : unit});
  }
  if (/\bfortnight\b/i.test(value)) found.push({amount:14,unit:'day'});
  return found;
}

function renewalPeriods(value) {
  const input=normalized(value), found=[];
  const amount='(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\\s+(?:days?|weeks?|months?)|(?:a\\s+)?fortnight';
  const cue='(?:renew(?:s|al|als|ed|ing)?|expir(?:e|es|ing|y|ation)|(?:membership|subscription|plan)(?:\\s+(?:is|will|be|set|scheduled|to)){0,3}\\s+due)';
  const modifiers='(?:\\s+(?:is|are|will|be|set|scheduled|due|to|again|automatically|now)){0,5}';
  const forward=new RegExp('\\b'+cue+modifiers+'\\s+(?:in|within|after|on|over)\\s+(?:the\\s+next\\s+)?('+amount+')\\b','g');
  const before=new RegExp('\\bin\\s+('+amount+')\\s+(?:(?:your|the|this|current)\\s+)?(?:membership|subscription|plan)\\s+(?:will\\s+)?renew\\w*\\b','g');
  for(const pattern of [forward,before])for(const match of input.matchAll(pattern))found.push(...periods(match[1]));
  return found;
}

const exampleFamilies = [
  {label:'discounts', pattern:/\b(?:discounts?|savings?|coupons?|money off)\b/i},
  {label:'events', pattern:/\b(?:events?|experiences?|tickets?)\b/i},
  {label:'gift cards', pattern:/\bgift (?:cards?|certificates?|vouchers?)\b/i},
  {label:'partner organizations', pattern:/\b(?:partners?|participating (?:brands?|businesses|organizations?|retailers?))\b/i},
];
const topicFamilies = [
  ['cost','costs','price','prices','pricing','fee','fees'],
  ['benefit','benefits','perk','perks','includes','included','include','covers','coverage'],
  ['membership','memberships','subscription','subscriptions','plan','plans'],
  ['renew','renews','renewal','renewing','renewed'],
  ['loyalty','reward','rewards'],
  ['information','details','detail'],
  ['accessibility','accessible','access'],
  ['virtual','online','remote','remotely'],
  ['attendance','attend','attending','participation','participate','join'],
  ['cancel','canceled','cancelled','canceling','cancelling','cancellation'],
];
const stopWords = new Set(('a an the and or about around regarding for of to with in on at from by their our your its it this that these those what which all how whether would could can should does do is are be being has have some more additional also as into through need needs want wants know learn tell please include includes included').split(' '));
function topicGroups(value) {
  const groups = new Map();
  for (const token of words(value)) {
    if (stopWords.has(token)) continue;
    const family = topicFamilies.find(group => group.includes(token));
    const stem = token.length > 4 ? token.replace(/s$/, '') : token;
    const key = family ? family[0] : stem;
    if (!groups.has(key)) groups.set(key, family || [stem]);
  }
  return [...groups.values()];
}
function topicPresent(value, groups) {
  const tokens = words(value), stems = new Set(tokens.flatMap(token => [token, token.length > 4 ? token.replace(/s$/, '') : token]));
  if (/\bhow much\b/i.test(value)) stems.add('cost');
  return groups.length > 0 && groups.every(group => group.some(token => stems.has(token)));
}

function narrativeRequirements(instructions, story) {
  const requirements = [], seen = new Set(), hasMembership = membership.test(instructions), hasRenewal = renewal.test(instructions);
  const add = (id, label, speaker, sentence, index, extra = {}) => {
    if (seen.has(id)) return;
    seen.add(id);
    const prohibited = /^\s*(?:please\s+)?(?:do not|don't|never|avoid|omit|exclude)\b(?!\s+forget)/i.test(sentence);
    requirements.push({id, label, speaker, order:index, prohibited, ...extra});
  };
  for (const match of instructions.matchAll(/[^.!?\n]+[.!?]?/g)) {
    const sentence = match[0], value = normalized(sentence), index = match.index;
    const durations=renewalPeriods(sentence),duration=durations[0];
    if (duration && durations.every(item=>item.amount===duration.amount&&item.unit===duration.unit) && !contrary(value,'renewal_reminder')) add('renewal_reminder','Renewal reminder and supplied timing','company',sentence,index,{duration});
    if (hasMembership && /\b(?:customer|prospect|recipient|lead|member)\b.{0,50}\b(?:question|asks?|responds?|inquir\w*)\b/i.test(value) && /\b(?:included|includes|covers|benefits?|perks?)\b/.test(value)) add('membership_inquiry','Customer asks what the membership includes','customer',sentence,index);
    if (hasMembership && /\b(?:explains?|provides?|shares?|describes?|outlines?|insight|benefits? include|includes|covers)\b/.test(value) && /\b(?:benefits?|perks?|includes|included|covers)\b/.test(value) && !customer.test(sentence.split(/\b(?:explains?|provides?|shares?|describes?|outlines?)\b/i)[0])) add('membership_benefits','Company explains membership benefits','company',sentence,index);
    if (loyalty.test(value) && /\b(?:invites?|join|joining|signed|sign up|signs up|enroll\w*|opt in|notices?)\b/.test(value)) add('loyalty_invitation','Invitation to join the loyalty program','company',sentence,index + 0.1);
    if (hasRenewal && customer.test(value) && hesitation.test(value)) add('renewal_hesitation','Customer hesitates about renewal','customer',sentence,index);
    if (human.test(value) && /\b(?:brings?|joins?|connect\w*|transfer\w*|hand ?off|speak|introduc\w*|escalat\w*)\b/.test(value)) add('human_handoff','Handoff to a human representative','company',sentence,index + sentence.search(human),{representative:story.representative || ''});
    if (points.test(value) && /\b(?:bonus|extra|additional)\b/.test(value) && /\b(?:offers?|awards?|gives?|receives?|earns?|bonus)\b/.test(value)) add('renewal_incentive','Offer of extra loyalty points for renewal','company',sentence,index,{renewal:hasRenewal});
    if (points.test(value) && /\b(?:use|uses|used|redeem\w*|spend|marketplace)\b/.test(value)) add('loyalty_redemption','How loyalty points can be used','company',sentence,index + 0.1,{examples:exampleFamilies.filter(example=>example.pattern.test(value)).map(example=>example.label)});
  }
  // Other topics use distinctive lexical cues, not verbatim descriptive prose.
  for (const [id,label,speaker,value] of [
    ['opening_topic','Opening topic','company',story.openingTopic],
    ['question_topic','Customer question topic','customer',seen.has('membership_inquiry')?'':story.questionTopic],
    ['handoff_topic','Customer interest before handoff','customer',story.handoffTopic],
  ]) {
    const groups=topicGroups(value);
    if (groups.length) add(id,label,speaker,'',Math.max(0,instructions.toLowerCase().indexOf(String(value).toLowerCase())),{groups});
  }
  return requirements.sort((a,b)=>a.order-b.order);
}

function contrary(value, kind) {
  // Target contrary predicates; "haven't signed up"/"don't forget to join"
  // are not refusals. This deliberately is not universal negation inference.
  const negative = "(?:not|never|cannot|can't|won't|don't|doesn't|isn't|aren't|no)";
  const predicate = {
    renewal_reminder:'(?:renew\\w*|due|expir\\w*)',
    membership_benefits:'(?:include\\w*|cover\\w*|offer\\w*|provide\\w*)',
    loyalty_invitation:'(?:join\\w*|enrol\\w*|sign up)',
    human_handoff:'(?:connect\\w*|transfer\\w*|bring|introduce|speak)',
    renewal_incentive:'(?:(?:offer|give|award|receive|earn|add|credit)\\w*|bonus|extra|additional)',
    loyalty_redemption:'(?:use|redeem\\w*|spend)',
  }[kind];
  return Boolean(predicate && new RegExp('\\b'+negative+'(?:\\s+(?:be|able|to|any|more|you|we|will|can)){0,3}\\s+'+predicate+'\\b','i').test(value));
}

function requirementMatch(requirement, turn, hasMembership) {
  if (turn.speaker !== requirement.speaker) return {matches:false, contrary:false};
  const visible = [turn.text, ...(turn.presentation?.cards || []).flatMap(card=>[card.title,card.description])].filter(Boolean).join('\n');
  const units = visible.split(/(?<=[.!?])\s+|\n+/).map(normalized).filter(Boolean);
  let contradiction = false, found = false;
  for (const value of units) {
    let matches = false;
    if (requirement.groups) matches = topicPresent(value,requirement.groups);
    else if (requirement.id === 'renewal_reminder') {
      const timings=renewalPeriods(value);
      matches=timings.some(item=>item.amount===requirement.duration.amount && item.unit===requirement.duration.unit);
      if(timings.some(item=>item.amount!==requirement.duration.amount || item.unit!==requirement.duration.unit)) contradiction=true;
    } else if (requirement.id === 'membership_inquiry') matches=hasMembership && /\b(?:what|which|includes|included|covers|benefits|perks)\b/.test(value) && /\b(?:what|which|can you|could you|tell me|explain|does|included|includes)\b/.test(value);
    else if (requirement.id === 'membership_benefits') matches=hasMembership && /\b(?:includes?|included|covers?|comes with|you get|you receive|access to|benefits? (?:are|include)|perks? (?:are|include))\b/.test(value);
    else if (requirement.id === 'loyalty_invitation') matches=/\b(?:join|enrol\w*|sign (?:you |me )?up|opt in|become a member)\b/.test(value) && (loyalty.test(visible) || /\b(?:program|club)\b/.test(value));
    else if (requirement.id === 'renewal_hesitation') matches=hesitation.test(value);
    else if (requirement.id === 'human_handoff') matches=human.test(value) && /\b(?:connect\w*|transfer\w*|bring\w*|join\w*|introduc\w*|hand ?off|i'm|i am|speak)\b/.test(value) || Boolean(requirement.representative && value.includes(normalized(requirement.representative)+' here'));
    else if (requirement.id === 'renewal_incentive') matches=points.test(value) && /\b(?:bonus|extra|additional)\b/.test(value) && (!requirement.renewal || renewal.test(visible));
    else if (requirement.id === 'loyalty_redemption') matches=points.test(visible) && /\b(?:use|redeem\w*|spend|exchange)\b/.test(value) && requirement.examples.every(label=>exampleFamilies.find(example=>example.label===label).pattern.test(visible));
    if (!matches) continue;
    if (contrary(value,requirement.id)) contradiction=true;
    else found=true;
  }
  return {matches:found&&!contradiction,contrary:contradiction};
}

function checkNarrative(requirements, turns) {
  const issues=[], hasMembership=requirements.some(item=>/^membership_/.test(item.id));
  let previous = 0;
  for (const requirement of requirements) {
    const candidates=turns.map(turn=>requirementMatch(requirement,turn,hasMembership)), indices=candidates.flatMap((result,index)=>result.matches?[index]:[]);
    const detail={field:'requirements.'+requirement.id,requirementId:requirement.id};
    if (requirement.prohibited) {
      if (indices.length) issues.push({code:'contradicted_requirement',message:'The draft includes an excluded requirement: '+requirement.label+'.',...detail});
      continue;
    }
    if (candidates.some(result=>result.contrary) || !indices.length) issues.push({code:candidates.some(result=>result.contrary)?'contradicted_requirement':'missing_requirement',message:'Required brief cue is missing or contradicted: '+requirement.label+'.',...detail});
    else {
      const index=indices.find(index=>index>=previous);
      if (index===undefined) issues.push({code:'requirement_order',message:'Requested sequence is not preserved: '+requirement.label+'.',...detail});
      else previous=index;
    }
  }
  return issues;
}

module.exports = {openingDirectives, requestedInitialSender, narrativeRequirements, checkNarrative};
