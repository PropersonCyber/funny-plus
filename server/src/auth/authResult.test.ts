import { describe, expect, it } from 'vitest'
import { describeAuthFailure } from './authResult.ts'

describe('鉴权失败映射', () => {
  it('缺 token 与坏 token 都是 unauthorized', () => {
    expect(describeAuthFailure('missing')).toEqual({ status: 401, code: 'unauthorized' })
    expect(describeAuthFailure('unknown')).toEqual({ status: 401, code: 'unauthorized' })
  })

  it('已登出是 unauthorized，过期是 token_expired —— 两者必须分开', () => {
    expect(describeAuthFailure('revoked')).toEqual({ status: 401, code: 'unauthorized' })
    expect(describeAuthFailure('expired')).toEqual({ status: 401, code: 'token_expired' })
  })
})
