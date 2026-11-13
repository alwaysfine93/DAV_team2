// Vercel 환경 변수: STUDENT_SCRIPT_URL, STUDENT_API_SECRET
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (status, error) => res.status(status).json({ ok: false, error });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405, 'POST 요청만 지원합니다.');
  }
  const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return fail(415, 'JSON 요청만 지원합니다.');
  let body;
  try {
    if (typeof req.body === 'string' && Buffer.byteLength(req.body) > 4096) throw new Error();
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
  } catch (_) {
    return fail(400, '요청 형식이 올바르지 않습니다.');
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().normalize('NFC') : '';
  if (!/^\d{1,8}$/.test(id) || !name || name.length > 10 || /[\r\n]/.test(name)) {
    return fail(400, '학번과 이름을 확인해 주세요.');
  }
  const secret = process.env.STUDENT_API_SECRET;
  const scriptUrl = process.env.STUDENT_SCRIPT_URL;
  if (!secret || secret.length < 32 || !scriptUrl) return fail(503, '학생 명단 서버 설정이 필요합니다.');
  try {
    const url = new URL(scriptUrl);
    if (url.origin !== 'https://script.google.com' || url.username || url.password
      || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error();
  } catch (_) {
    return fail(503, '학생 명단 서버 주소를 확인해 주세요.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, secret }),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) return fail(502, '명단 서버에 연결하지 못했습니다.');
    const data = await response.json();
    if (!data || data.ok !== true || typeof data.matched !== 'boolean') {
      return fail(502, '명단을 확인하지 못했습니다. 선생님께 서버 설정 확인을 요청해 주세요.');
    }
    // 전체 명단이나 서버 응답 원문은 브라우저에 전달하지 않습니다.
    return res.status(200).json({ ok: true, matched: data.matched });
  } catch (_) {
    return fail(controller.signal.aborted ? 504 : 502,
      controller.signal.aborted ? '명단 확인 시간이 초과됐습니다. 다시 시도해 주세요.' : '명단 서버 연결에 실패했습니다.');
  } finally {
    clearTimeout(timeout);
  }
}
