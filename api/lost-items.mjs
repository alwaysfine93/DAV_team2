const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const fail=(status,error)=>res.status(status).json({ok:false,error});
  let payload;
  if (req.method==='GET') {
    const params=new URL(req.url,'https://local.invalid').searchParams;
    if (['photo','query','page'].some(key=>params.getAll(key).length>1)) return fail(400,'중복 요청 값을 확인해 주세요.');
    if (params.has('photo')) {
      const id=params.get('photo');
      if (!UUID.test(id)) return fail(400,'사진 요청을 확인해 주세요.');
      payload={action:'items.photo',id};
    } else {
      const query=(params.get('query')||'').trim();
      const page=Number(params.get('page')||'1');
      if (query.length>20 || !Number.isInteger(page) || page<1 || page>1000) return fail(400,'검색어 또는 페이지를 확인해 주세요.');
      payload={action:'items.list',query,page};
    }
  } else if (req.method==='POST') {
    if (String(req.headers?.['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json') return fail(415,'JSON 요청만 지원합니다.');
    let body;
    try {
      body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if (!body || typeof body!=='object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body))>750000) throw new Error();
    } catch (_) {return fail(400,'등록 내용 또는 사진 크기를 확인해 주세요.');}
    if (typeof body.id!=='string' || !UUID.test(body.id)) return fail(400,'게시글ID를 확인해 주세요.');
    for (const [key,max] of [['name',20],['features',40],['place',25]]) {
      if (typeof body[key]!=='string' || !body[key].trim() || body[key].trim().length>max) return fail(400,'물건 이름, 특징, 발견 장소를 확인해 주세요.');
    }
    if (body.photoDataUrl!==undefined && (typeof body.photoDataUrl!=='string' || body.photoDataUrl.length>700000)) return fail(400,'사진 크기를 줄여 주세요.');
    payload={action:'items.create',id:body.id,name:body.name,features:body.features,place:body.place,photoDataUrl:body.photoDataUrl||''};
  } else {
    res.setHeader('Allow','GET, POST');
    return fail(405,'GET 또는 POST 요청만 지원합니다.');
  }
  const secret=process.env.STUDENT_API_SECRET;
  const scriptUrl=process.env.STUDENT_SCRIPT_URL;
  if (!secret || secret.length<32 || !scriptUrl) return fail(503,'서버 환경 변수 설정이 필요합니다.');
  try {
    const url=new URL(scriptUrl);
    if (url.origin!=='https://script.google.com' || url.username || url.password || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error();
  } catch (_) {return fail(503,'Apps Script 배포 주소를 확인해 주세요.');}
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch(scriptUrl,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload,secret}),redirect:'follow',signal:controller.signal});
    if (!response.ok) return fail(502,'저장소 연결에 실패했습니다.');
    const data=await response.json();
    if (!data || data.ok!==true) return fail([400,404,409,429,503].includes(data?.status)?data.status:502,
      typeof data?.error==='string'?data.error:'저장소 응답을 확인하지 못했습니다.');
    if (payload.action==='items.photo') {
      if (data.mimeType!=='image/jpeg' || typeof data.base64!=='string' || data.base64.length>700000) return fail(502,'사진 응답이 잘못되었습니다.');
      const bytes=Buffer.from(data.base64,'base64');
      if (bytes.length>512000 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255) return fail(502,'사진 형식이 잘못되었습니다.');
      res.setHeader('Content-Type','image/jpeg');
      return res.status(200).send(bytes);
    }
    if (payload.action==='items.list') {
      if (!Array.isArray(data.items)) return fail(502,'게시글 응답이 잘못되었습니다.');
      return res.status(200).json({ok:true,items:data.items,total:data.total,page:data.page,hasMore:data.hasMore});
    }
    if (!data.item || data.item.id!==payload.id) return fail(502,'등록 결과를 확인하지 못했습니다.');
    return res.status(200).json({ok:true,item:data.item,alreadySaved:data.alreadySaved===true});
  } catch (_) {
    return fail(controller.signal.aborted?504:502,payload.action==='items.create'
      ? '등록 결과를 확인하지 못했습니다. 같은 화면에서 다시 눌러 확인해 주세요.'
      : '저장소 연결이 지연되고 있습니다. 다시 시도해 주세요.');
  } finally {clearTimeout(timer);}
}
