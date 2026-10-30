/** 后端出错时都返回 { error }，没解析出来就退回状态码，不要把 undefined 塞给用户 */
export async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return (body && typeof body.error === 'string' && body.error) || `请求失败（${res.status}）`
}
