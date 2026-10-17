// Synthetic visual viewport changes, not a claim to emulate an OS keyboard.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../assets/js/apply-navigation.js',import.meta.url),'utf8');
let checks=0;const check=(label,value)=>{assert.ok(value,label);checks++;console.log('  ✓ '+label);};
const tick=()=>new Promise(r=>setTimeout(r,35));
async function setup(withViewport=true){
 const dom=new JSDOM('<body><div class="app"><section class="page active" id="first"><input id="name"><div class="btn-row"><button id="back">رجوع</button><button id="next" disabled>التالي</button></div></section><section class="page" id="other"></section></div></body>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;Object.defineProperty(w,'innerWidth',{value:375,writable:true});Object.defineProperty(w,'innerHeight',{value:800,writable:true});
 const viewport=new w.EventTarget();Object.assign(viewport,{height:800,offsetTop:0,scale:1});
 if(withViewport)Object.defineProperty(w,'visualViewport',{value:viewport});
 w.scrollBy=()=>{};w.eval(source);await tick();
 return{dom,w,d:w.document,viewport};
}
const a=await setup();
try{
 const {w,d,viewport:v}=a;const row=d.querySelector('.btn-row');const originalParent=row.parentNode;let clicks=0;d.getElementById('next').addEventListener('click',()=>clicks++);
 d.getElementById('name').focus();await tick();check('focus without a keyboard keeps navigation below the fields',!d.getElementById('keyboard-navigation')&&row.parentNode===originalParent);
 v.height=480;v.dispatchEvent(new w.Event('resize'));await tick();
 check('keyboard viewport shrink moves the original buttons to a body-level dock',row.parentNode===d.getElementById('keyboard-navigation')&&row.parentNode.parentNode===d.body);
 check('dock tracks iOS-style overlay keyboard inset',row.parentNode.style.bottom==='320px');
 check('disabled Next remains disabled and cannot fire',d.getElementById('next').disabled&&(d.getElementById('next').click(),clicks===0));
 d.getElementById('next').disabled=false;d.getElementById('next').click();check('existing click handlers survive moving the toolbar',clicks===1);
 d.getElementById('back').hidden=true;v.offsetTop=40;v.dispatchEvent(new w.Event('scroll'));await tick();
 check('viewport panning repositions navigation without revealing a locked back button',row.parentNode.style.bottom==='280px'&&d.getElementById('back').hidden);
 w.innerHeight=480;v.offsetTop=0;w.dispatchEvent(new w.Event('resize'));await tick();check('Android resized-layout keyboard needs no extra bottom offset',row.parentNode.style.bottom==='0px');
 v.scale=2;v.dispatchEvent(new w.Event('resize'));await tick();check('pinch zoom is not mistaken for a keyboard',!d.getElementById('keyboard-navigation')&&row.parentNode===originalParent);
 v.scale=1;w.innerHeight=800;v.height=480;v.dispatchEvent(new w.Event('resize'));await tick();w.HRCApplyNavigation.reset();
 check('page navigation restores the exact original toolbar and clears dock state',row.parentNode===originalParent&&!d.body.classList.contains('keyboard-navigation-open')&&!d.getElementById('keyboard-navigation'));
 v.height=800;v.dispatchEvent(new w.Event('resize'));await tick();check('keyboard dismissal leaves one toolbar, no duplicate buttons',d.querySelectorAll('.btn-row').length===1&&d.querySelectorAll('#next').length===1);
 w.innerWidth=1440;v.height=400;v.dispatchEvent(new w.Event('resize'));await tick();check('desktop never gets the keyboard dock',!d.getElementById('keyboard-navigation'));
 w.innerWidth=375;v.height=480;v.dispatchEvent(new w.Event('resize'));await tick();d.getElementById('first').classList.remove('active');d.getElementById('other').classList.add('active');v.dispatchEvent(new w.Event('resize'));await tick();
 check('a page change cannot leave an old page toolbar floating',row.parentNode===originalParent&&!d.getElementById('keyboard-navigation'));
}finally{a.dom.window.close();}
const b=await setup(false);
try{
 b.d.getElementById('name').focus();b.w.innerHeight=470;b.w.dispatchEvent(new b.w.Event('resize'));await tick();check('resized-window fallback works without visualViewport',!!b.d.getElementById('keyboard-navigation'));
 b.w.innerHeight=800;b.w.dispatchEvent(new b.w.Event('resize'));await tick();check('fallback restores navigation after keyboard dismissal',!b.d.getElementById('keyboard-navigation'));
}finally{b.dom.window.close();}
console.log(`\nKeyboard navigation: ${checks} checks passed.`);
