export function safeName(value) {
  let name=String(value || '附件').normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').slice(0,160);
  if (!name) name='附件';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name='_'+name;
  return name;
}
export function uniqueName(value, used) {
  const name=safeName(value); const dot=name.lastIndexOf('.');
  const stem=dot>0?name.slice(0,dot):name, ext=dot>0?name.slice(dot):'';
  let result=name, n=2;
  while(used.has(result.toLowerCase())) result=`${stem} (${n++})${ext}`;
  used.add(result.toLowerCase()); return result;
}
