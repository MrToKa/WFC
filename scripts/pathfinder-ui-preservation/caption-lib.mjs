import {canonical,fail} from './lib.mjs';
export function captionBinding(before,current,{phase,expectedWeb}) {
  const old=before.capture.target,next=current.capture.target;
  const core=value=>{const {webImage,...rest}=value;return rest;};
  if(canonical(core(old))!==canonical(core(next))||canonical(before.moduleHashes)!==canonical(current.moduleHashes))fail('UI_CAPTION_API_BINDING_CHANGED');
  if(phase==='C0' && old.webImage!==next.webImage)fail('UI_CAPTION_BEFORE_WEB_CHANGED');
  if(phase==='C1' && (!/^sha256:[a-f0-9]{64}$/.test(expectedWeb??'')||next.webImage!==expectedWeb||old.webImage===next.webImage))fail('UI_CAPTION_NEW_WEB_REQUIRED');
  if(!['C0','C1'].includes(phase))fail('UI_CAPTION_PHASE');
  return {before:old.webImage,after:next.webImage,apiFixed:true,modulesFixed:true};
}
