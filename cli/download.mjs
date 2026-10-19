import {parseArgs} from 'node:util';
import {writeFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {uniqueName} from '../src/files.mjs';

const {values}=parseArgs({options:{url:{type:'string'},record:{type:'string'},row:{type:'string',default:'1'},field:{type:'string',default:'套图输出'},out:{type:'string',default:'套图.zip'}}});
const api='https://open.feishu.cn/open-apis';
async function json(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(60000)});const data=await r.json();if(!r.ok||data.code!==0)throw Error(`飞书接口失败：${data.code} ${data.msg}`);return data;}
async function main(){
 if(!values.url)throw Error('请提供 --url 多维表格链接');
 const u=new URL(values.url),base=u.pathname.match(/\/base\/([A-Za-z0-9]+)/)?.[1],table=u.searchParams.get('table');
 if(!base||!table)throw Error('链接必须包含 /base/ 标识和 table 参数');
 if(!process.env.FEISHU_APP_ID||!process.env.FEISHU_APP_SECRET)throw Error('请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量');
 const auth=await json(`${api}/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const headers={Authorization:`Bearer ${auth.tenant_access_token}`},prefix=`${api}/bitable/v1/apps/${base}/tables/${table}`;
 let record;
 if(values.record)record=(await json(`${prefix}/records/${encodeURIComponent(values.record)}`,{headers})).data.record;
 else{
  const row=Number(values.row);if(!Number.isSafeInteger(row)||row<1)throw Error('--row 必须是正整数');
  let items=[],page='';
  do{const d=(await json(`${prefix}/records?page_size=100${page?'&page_token='+encodeURIComponent(page):''}`,{headers})).data;items.push(...d.items);page=d.has_more?d.page_token:'';}while(items.length<row&&page);
  record=items[row-1];
 }
 if(!record)throw Error('没有找到指定记录');
 const attachments=record.fields[values.field];if(!Array.isArray(attachments)||!attachments.length)throw Error('指定列没有附件');
 const fields=(await json(`${prefix}/fields?page_size=100`,{headers})).data.items;
 const field=fields.find(f=>f.field_name===values.field);if(!field)throw Error('找不到附件字段');
 if(attachments.reduce((n,a)=>n+a.size,0)>512*1024*1024)throw Error('附件超过 512 MB，请缩小范围');
 const zip=new JSZip(),used=new Set();let bytes=0;
 for(let i=0;i<attachments.length;i++){
  const a=attachments[i];
  const extra=JSON.stringify({bitablePerm:{tableId:table,attachments:{[field.field_id]:{[record.record_id]:[a.file_token]}}}});
  const url=new URL(`${api}/drive/v1/medias/${encodeURIComponent(a.file_token)}/download`);url.searchParams.set('extra',extra);
  let data;
  for(let attempt=0;attempt<3;attempt++){
   try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error(`下载失败 HTTP ${r.status}`);if((r.headers.get('content-type')||'').includes('application/json'))throw Error('飞书返回错误响应');data=new Uint8Array(await r.arrayBuffer());if(!data.length)throw Error('附件为空');break;}catch(e){if(attempt===2)throw e;}
  }
  bytes+=data.length;if(bytes>512*1024*1024)throw Error('超过 512 MB 上限');
  zip.file(uniqueName(a.name,used),data);console.log(`已下载 ${i+1}/${attachments.length}`);
 }
 await writeFile(values.out,await zip.generateAsync({type:'nodebuffer',compression:'STORE'}));
 console.log(`完成：${attachments.length} 个附件，${bytes} 字节；记录 ${record.record_id}；输出 ${values.out}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
