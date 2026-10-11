'use strict';

const useCase = "Express Wash Concepts sends out message reminding a current customer that their membership is set to renew in 14 days. Customer responds with a question about what all the membership includes. EWC provides insight into the membership benefits, as well as notices that the customer hasn't signed up for the loyalty program that would also provide some additional benefits to their EWC membership. Customer still debates not renewing, to which EWC brings in a human rep on the same thread to explore options. Human agent offers the person a bonus of extra loyalty points for renewing, which they can use on the loyalty marketplace for additional discounts, events, and gift cards at partner organizations.";
const request = {
  companyName:'EWC', website:'https://example.com/', channels:['sms','rcs','whatsapp','email'], useCase,
  controls:{initialSender:null,expectedMessageCount:null},
  persona:{customerName:'',representativeName:'',representativeRole:''},
};
const conversation = [
  {speaker:'company',text:'Your membership is due for renewal in two weeks.'},
  {speaker:'customer',text:"What's included?",mode:'prefill',options:[]},
  {speaker:'company',text:"Your plan includes membership benefits we can review together; the current details need confirmation. You haven't signed up for the rewards program yet. Would you like to join?"},
  {speaker:'customer',text:"I'm not sure I want to renew.",mode:'prefill',options:[]},
  {speaker:'company',text:"I'll bring a human representative into this thread to explore your options."},
  {speaker:'company',text:"I'm your agent. If you renew, I can offer extra loyalty points. Redeem those points in the rewards marketplace for savings, event tickets and gift certificates with participating businesses."},
];
const rawDraft = {
  schemaVersion:2, companyName:'EWC', initialSender:'company',
  scenarios:Object.fromEntries(request.channels.map(channel=>[channel,{
    title:'Membership renewal conversation',sender:'EWC',subject:channel==='email'?'Your membership renewal':'',
    turns:conversation.map((turn,index)=>({...turn,...(turn.options?{options:[...turn.options]}:{}),
      ...(channel==='email'&&turn.speaker==='company'?{presentation:{kind:'email',mode:'plain'}}:{}),
      ...(channel==='rcs'&&index===0?{presentation:{kind:'card',cards:[{title:'Membership renewal',description:'Renewal is due in two weeks.'}]}}:{}),
    })),
  }])),
};

module.exports = {useCase,request,rawDraft};
