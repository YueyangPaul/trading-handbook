'use strict';
function applyPermissions() {
  if (!state) return;
  const existing = state.records.some(x => x.id === currentId);
  document.querySelector('#fields').disabled = !state.canWrite || (existing && !state.editableIds.includes(currentId));
  document.querySelector('#new').disabled = !state.canWrite;
}
const form = document.querySelector('#form');
const fields = form.elements;
const numberFields = ['entry', 'stop', 'target', 'position', 'risk', 'pnl'];
const textFields = ['date', 'symbol', 'kind', 'status', 'exitDate', 'process', 'cause', 'notes'];
const checklist = [
  '环境：QQQ 在 200 日线上方（不在：风险减半或不做）',
  '买点类型是突破或回调，不是抄底',
  '触发已按收盘价确认，不是盘中冲动',
  '止损在结构位下方，且离入场价至少 1.5 倍 ATR',
  '目标至少 2R',
  '持有期内没有财报，或已在计划里写明怎么处理',
  '今天和明天没有 CPI、非农、FOMC',
  '仓位按 1% 风险算好（交易日志里的建议仓位）',
  '持仓不到 3 笔，且不和现有持仓同一行业',
  '本周没触发 5% 熔断',
  '下单时止损和止盈一起挂上，并在交易日志登记'
];
for (const text of checklist) {
  const label = document.createElement('label');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  label.append(input, document.createTextNode(text));
  document.querySelector('#checks').append(label);
}
const checks = [...document.querySelectorAll('#checks input')];
let state = null, currentId = null, dirty = false, busy = false;

function message(text, error = false, selector = '#message') {
  const element = document.querySelector(selector);
  element.textContent = text;
  element.dataset.error = String(error);
}
function localDate() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date()).replace(' ', 'T');
}
function setDirty(value) {
  dirty = value;
  document.querySelector('#dirty').textContent = value ? '有未保存的内容' : '已保存到云端';
}
function preview() {
  const parts = [];
  if (fields.status.value === '已平仓' && fields.pnl.value !== '') {
    const pnl = Number(fields.pnl.value), risk = Number(fields.risk.value);
    if (risk > 0) parts.push(`实际 R：${(pnl / risk).toFixed(2)}R`);
    else parts.push('填写开仓时的 1R 后可计算实际 R');
    if (fields.process.value) {
      const grid = fields.process.value === '按计划'
        ? (pnl > 0 ? '应得的结果' : pnl < 0 ? '正常的交易成本' : '按计划保本')
        : (pnl > 0 ? '危险的运气' : pnl < 0 ? '该得的教训' : '未按计划保本，仍需复盘');
      parts.push(grid);
    }
  }
  document.querySelector('#result').textContent = parts.join(' · ');
  fields.pnl.required = fields.status.value === '已平仓';
  fields.process.required = fields.status.value === '已平仓';
}
function loadRecord(record) {
  form.reset();
  currentId = record ? record.id : crypto.randomUUID();
  for (const name of [...textFields, ...numberFields]) {
    if (record) fields[name].value = record[name] ?? '';
  }
  if (!record) fields.date.value = localDate();
  checks.forEach((input, index) => { input.checked = Boolean(record?.checks[index]); });
  document.querySelector('#form-title').textContent = record ? `编辑记录 · ${record.symbol}` : '新建记录';
  setDirty(false);
  if (!record) document.querySelector('#dirty').textContent = '填写后点击保存';
  message('');
  preview();
  renderList();
  applyPermissions();
}
function canLeave() {
  return !dirty || window.confirm('当前内容尚未保存。要放弃这些修改吗？');
}
function renderList() {
  const list = document.querySelector('#list');
  list.replaceChildren();
  const closed = state.records.filter(x => x.status === '已平仓');
  const rated = closed.filter(x => x.risk > 0);
  const average = rated.length ? ` · 平均 ${(rated.reduce((sum, x) => sum + x.pnl / x.risk, 0) / rated.length).toFixed(2)}R（${rated.length} 笔）` : '';
  document.querySelector('#count').textContent = `${state.records.length} 条记录 · ${closed.length} 笔已平仓${average}`;
  if (!state.records.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有记录。从第一份计划开始，留住当时的判断。';
    list.append(empty);
  }
  for (const record of [...state.records].sort((a, b) => b.date.localeCompare(a.date))) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'entry-card';
    button.setAttribute('aria-current', String(record.id === currentId));
    const title = document.createElement('strong'), meta = document.createElement('small');
    title.textContent = `${record.symbol} · ${record.kind}`;
    const r = record.status === '已平仓' && record.risk > 0 ? ` · ${(record.pnl / record.risk).toFixed(2)}R` : '';
    meta.textContent = `${record.date.replace('T', ' ')} · ${record.status}${r}`;
    button.append(title, meta);
    button.addEventListener('click', () => { if (!busy && canLeave()) loadRecord(record); });
    list.append(button);
  }
}
const CLOUD = 'https://buy-timing-handbook-paul.baileyspa.chatgpt.site';
let cloudWindow = null;
const pending = new Map();
window.addEventListener('message', event => {
  if (event.origin !== CLOUD || event.source !== cloudWindow || event.data?.type !== 'journal-response') return;
  const item = pending.get(event.data.id);
  if (!item) return;
  pending.delete(event.data.id); clearTimeout(item.timer); clearInterval(item.ping);
  if (event.data.status >= 400) item.reject(new Error(event.data.data?.error || '云端请求失败'));
  else item.resolve(event.data.data);
});
function bridgeRequest(action, body) {
  if (!cloudWindow || cloudWindow.closed) return Promise.reject(new Error('请点击“连接云端”，登录后再保存'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const send = () => cloudWindow.postMessage({type:'journal-request',id,action,body}, CLOUD);
    const timer = setTimeout(() => { const p=pending.get(id);if(p)clearInterval(p.ping);pending.delete(id);reject(new Error('连接未确认；请完成连接窗口中的登录，然后重新连接。保存请求请先重新读取核对')); }, action==='read'?30000:20000);
    const ping = action==='read' ? setInterval(send,800) : null;
    pending.set(id,{resolve,reject,timer,ping});send();
  });
}
async function request(url, options) {
  if (options?.method === 'POST') return bridgeRequest('save',JSON.parse(options.body));
  if (cloudWindow && !cloudWindow.closed) return bridgeRequest('read');
  const response = await fetch(CLOUD+'/api/public-journal',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '云端读取失败，请点击连接云端');
  return data;
}
async function reload() {
  if (busy || !canLeave()) return;
  busy = true;
  document.querySelector('#reload').disabled = true;
  try {
    const data = await request('/api/journal');
    state = data;
    document.querySelector('#fields').disabled = false;
    document.querySelector('#new').disabled = false;
    loadRecord(data.records.find(x => x.id === currentId));
    message(state.canWrite ? '已读取云端记录 · 可新建或编辑自己的记录' : '公开阅读模式 · 登录后可新建记录', false, '#connection');
  } catch (error) {
    message(`读取失败：${error.message}。请稍后重新读取。`, true, '#connection');
  } finally {
    busy = false;
    document.querySelector('#reload').disabled = false;
    applyPermissions();
  }
}
form.addEventListener('input', () => { setDirty(true); message(''); preview(); });
form.addEventListener('change', () => { setDirty(true); message(''); preview(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !state) return;
  preview();
  if (!form.reportValidity()) return;
  const record = {id: currentId, checks: checks.map(input => input.checked)};
  for (const name of textFields) record[name] = fields[name].value.trim();
  for (const name of numberFields) record[name] = fields[name].value === '' ? null : Number(fields[name].value);
  busy = true;
  document.querySelector('#fields').disabled = true;
  document.querySelector('#new').disabled = true;
  document.querySelector('#reload').disabled = true;
  message('正在保存并读回核对…');
  try {
    const data = await request('/api/journal', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: state.revision, record})});
    state = data;
    loadRecord(data.records.find(x => x.id === record.id));
    message('已保存并从云端读回核对。');
  } catch (error) {
    message(`未能确认保存：${error.message}。当前输入仍保留。`, true);
  } finally {
    busy = false;
    document.querySelector('#fields').disabled = false;
    document.querySelector('#new').disabled = false;
    document.querySelector('#reload').disabled = false;
    applyPermissions();
  }
});
document.querySelector('#new').addEventListener('click', () => { if (!busy && canLeave()) loadRecord(null); });
document.querySelector('#reload').addEventListener('click', reload);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
if (location.protocol === 'file:') {
  message('请双击项目中的“打开交易日志.command”启动日志，直接打开 HTML 无法保存记录。', true, '#connection');
} else reload();

document.querySelector('#connect').addEventListener('click',async()=>{
  if(busy)return;
  const hadUnsaved=dirty;
  cloudWindow=window.open(CLOUD+'/bridge','handbook-cloud-connection','width=540,height=680');
  if(!cloudWindow){message('浏览器阻止了连接窗口，请允许本站弹出窗口后重新连接。',true);return;}
  message('请在连接窗口完成登录；登录后回到本页，必要时再次点击连接云端。');
  busy=true;
  try{
    state=await bridgeRequest('read');
    if(hadUnsaved){renderList();setDirty(true);}else loadRecord(state.records.find(x=>x.id===currentId));
    message(state.canWrite?'已连接云端，可保存自己的记录。':'已连接公开读取；请在连接窗口登录，再点击连接云端。',!state.canWrite,'#connection');
  }catch(error){message(error.message,true);}
  finally{busy=false;applyPermissions();}
});
document.querySelector('#export').addEventListener('click',async()=>{
  try{
    const data=await request('/api/journal');
    const blob=new Blob([JSON.stringify({schema_version:1,revision:data.revision,records:data.records},null,2)],{type:'application/json'});
    const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download='trading-journal.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){message('导出失败：'+error.message,true);}
});
