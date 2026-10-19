import { bitable, FieldType, type IAttachmentField, type IGridView, type ITable } from '@lark-base-open/js-sdk';
import JSZip from 'jszip';
import {safeName, uniqueName} from './files.mjs';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML=`<main><div class="icon">↓</div><h1>本行套图下载</h1><p>点选一行，套图一次带走。</p><span class="badge">飞书多维表格 · 附件工具</span><section class="card"><label for="field">下载哪一列</label><select id="field" disabled><option>正在连接飞书…</option></select><div class="selection"><strong id="count">0</strong><span>条记录已选择</span></div><div class="row"><button id="pick" disabled>选择记录</button><button id="sync" disabled>读取当前选中行</button></div><button class="primary" id="download" disabled>打包下载套图</button><button class="primary save" id="save" hidden>保存 ZIP 文件</button><progress id="progress" hidden max="100" value="0"></progress><div id="status" role="status" aria-live="polite">正在连接…</div></section><p class="tip">点击表格中的任意单元格即可选定该行。多行下载请点左侧行号，或使用“选择记录”。</p><small>附件直接从飞书下载到浏览器。本工具不需要应用密钥，不修改表格内容。</small></main>`;
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const fieldEl=el<HTMLSelectElement>('field'), count=el('count'), status=el('status'), progress=el<HTMLProgressElement>('progress');
const buttons=['pick','sync','download'].map(id=>el<HTMLButtonElement>(id));
let table:ITable, tableId='',viewId='', ids:string[]=[], busy=false, generation=0;
let readyUrl='',readyName='';
const demo=new URLSearchParams(location.search).has('demo');
function message(text:string,error=false){status.textContent=text;status.className=error?'error':'';}
function update(){count.textContent=String(ids.length);buttons.forEach(b=>b.disabled=busy||!tableId);el<HTMLButtonElement>('download').disabled=busy||!ids.length||!fieldEl.value;fieldEl.disabled=busy||!tableId;}
function clearZip(){if(readyUrl) URL.revokeObjectURL(readyUrl);readyUrl='';el('save').hidden=true;}
async function refresh(force=false){
 if(busy||demo)return;
 const seq=++generation;
 try{
  const s=await bitable.base.getSelection();
  if(!s.tableId)throw Error('请先切换到数据表。');
  const next=await bitable.base.getTable(s.tableId);
  let selected:string[]=[];
  if(s.viewId){try{const view=await next.getViewById(s.viewId) as IGridView;selected=await view.getSelectedRecordIdList();}catch{/*非表格视图使用当前记录*/}}
  if(!selected.length&&s.recordId)selected=[s.recordId];
  const fields=await next.getFieldMetaListByType(FieldType.Attachment);
  if(seq!==generation)return;
  if(s.tableId!==tableId||force){
   const previous=s.tableId===tableId?fieldEl.value:'';
   fieldEl.replaceChildren(...fields.map(f=>new Option(f.name,f.id)));
   fieldEl.value=fields.find(f=>f.id===previous)?.id||fields.find(f=>f.name==='套图输出')?.id||fields[0]?.id||'';
  }
  table=next;tableId=s.tableId;viewId=s.viewId||'';ids=[...new Set(selected)];clearZip();update();
  message(!fields.length?'当前表没有附件列。':ids.length?'已就绪，点击“打包下载套图”。':'请在表格点选一行，或点击“选择记录”。');
 }catch(e){message(errorText(e),true);}
}
function errorText(e:unknown){return e instanceof Error?e.message:'操作失败，请重试。';}
el('sync').onclick=()=>{void refresh(true);};
fieldEl.onchange=()=>{clearZip();update();};
el('pick').onclick=async()=>{
 if(demo)return;
 try{
  const picked=await bitable.ui.selectRecordIdList(tableId,viewId);
  if(picked.length){ids=[...new Set(picked)];clearZip();update();message('已选择记录，可以打包下载。');}
 }catch(e){message(errorText(e),true);}
};
el('save').onclick=()=>{if(!readyUrl)return;const a=document.createElement('a');a.href=readyUrl;a.download=readyName;document.body.append(a);a.click();a.remove();};
el('download').onclick=async()=>{
 if(busy)return;busy=true;update();clearZip();progress.hidden=false;progress.value=0;
 const recordIds=[...ids], fieldId=fieldEl.value;
 const zip=new JSZip(),used=new Map<string,Set<string>>(),failures:string[]=[];
 let total=0,done=0,bytes=0;
 try{
  message('正在读取附件…');
  type Job={id:string;token:string;name:string;size:number;folder:string};
  const jobs:Job[]=[];
  if(demo){for(let i=1;i<=6;i++)jobs.push({id:'demo',token:String(i),name:`套图_${i}.svg`,size:300,folder:''});}
  else{
   const f=await table.getField<IAttachmentField>(fieldId);
   for(let i=0;i<recordIds.length;i++){
    const attachments=await f.getValue(recordIds[i]);
    if(!attachments?.length){failures.push(`第${i+1}条记录：附件为空`);continue;}
    const folder=recordIds.length>1?`记录_${i+1}/`:'';
    for(const a of attachments)jobs.push({id:recordIds[i],token:a.token,name:a.name,size:a.size||0,folder});
   }
  }
  total=jobs.length;if(!total)throw Error('所选记录的这一列没有附件。');
  if(jobs.reduce((n,j)=>n+j.size,0)>512*1024*1024)throw Error('本次附件超过 512 MB，请减少选择的记录后重试。');
  for(const job of jobs){
   message(`正在下载 ${done+1}/${total}：${job.name}`);
   try{
    let blob:Blob|undefined;
    for(let attempt=0;attempt<3;attempt++){
     try{
      if(demo)blob=new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#e8eeff"/><text x="100" y="500" font-size="60">Demo ${job.token}</text></svg>`],{type:'image/svg+xml'});
      else{
       const urls=await table.getCellAttachmentUrls([job.token],fieldId,job.id);
       if(!urls[0])throw Error('飞书没有返回下载地址');
       const response=await fetch(urls[0],{signal:AbortSignal.timeout(90000)});
       if(!response.ok)throw Error(`下载失败 HTTP ${response.status}`);
       const mime=response.headers.get('content-type')||'';
       if(mime.includes('text/html')||mime.includes('application/json'))throw Error('飞书返回了权限或登录提示，请检查附件下载权限');
       blob=await response.blob();
       if(!blob.size)throw Error('返回了空文件');
      }
      break;
     }catch(e){if(attempt===2)throw e;}
    }
    if(!blob)throw Error('没有收到附件');
    bytes+=blob.size;if(bytes>512*1024*1024)throw Error('下载内容超过 512 MB 上限，请分批下载');
    const names=used.get(job.folder)||new Set<string>();used.set(job.folder,names);
    zip.file(job.folder+uniqueName(job.name,names),await blob.arrayBuffer());
   }catch(e){failures.push(`${job.name}：${errorText(e)}`);}
   done++;progress.value=done/total*90;
  }
  const success=Object.values(zip.files).filter(f=>!f.dir).length;
  if(!success)throw Error(`附件未能下载。请确认有下载权限，或检查浏览器是否阻止了跨域请求。\n${failures.join('\n')}`);
  if(failures.length)zip.file('_未下载清单.txt',failures.join('\n'));
  message('正在打包…');
  const blob=await zip.generateAsync({type:'blob',compression:'STORE'},m=>{progress.value=90+m.percent/10;});
  readyUrl=URL.createObjectURL(blob);readyName=safeName(`${demo?'示例_':''}${fieldEl.selectedOptions[0]?.text||'套图'}_${recordIds.length}行_${new Date().toISOString().slice(0,10)}.zip`);
  el('save').hidden=false;
  message(`已打包 ${success} 个附件${failures.length?`，${failures.length} 项未下载，详见 ZIP 内清单`:''}。点击绿色按钮保存。`);
 }catch(e){message(errorText(e),true);}
 finally{busy=false;update();}
};
if(demo){tableId='demo';ids=['demo'];fieldEl.replaceChildren(new Option('套图输出','demo'));message('示例模式：6 张测试图片，不连接飞书数据。');update();}
else if(window.parent===window){message('请在飞书的“自定义插件”中添加本页面地址后使用。当前是独立网页，无法读取表格。');fieldEl.replaceChildren(new Option('请在飞书中打开',''));}
else{void refresh(true);bitable.base.onSelectionChange(()=>{void refresh();});}
