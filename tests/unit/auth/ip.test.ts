import { describe, expect, it } from 'vitest'

import { clientIpFromHeaders } from '@/lib/auth/ip'

const headers = (init: Record<string, string>): Headers => new Headers(init)

describe('lib/auth — عنوان العميل', () => {
  it('يأخذ أول عنوان في x-forwarded-for', () => {
    // The list is appended to by each hop; the first entry is the client and
    // the rest are proxies.
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })),
    ).toBe('203.0.113.9')
  })

  it('يتجاهل المسافات حول العناوين', () => {
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '  203.0.113.9 , 10.0.0.1' })),
    ).toBe('203.0.113.9')
  })

  it('يرجع إلى x-real-ip عند غياب x-forwarded-for', () => {
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4',
    )
  })

  it('يفضّل x-forwarded-for على x-real-ip', () => {
    expect(
      clientIpFromHeaders(
        headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.4' }),
      ),
    ).toBe('203.0.113.9')
  })

  it('يزيل أقواس IPv6 ومعرّف النطاق', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '[2001:db8::1]' }))).toBe(
      '2001:db8::1',
    )
    expect(clientIpFromHeaders(headers({ 'x-real-ip': 'fe80::1%eth0' }))).toBe('fe80::1')
  })

  it('يفكّ عناوين IPv4 المغلَّفة في IPv6', () => {
    // Node presents an IPv4 client on a dual-stack socket as ::ffff:a.b.c.d.
    // Without unwrapping, the same client would key two different throttles.
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '::ffff:203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
  })

  it('يرجع undefined عند غياب الترويسات', () => {
    // The throttle still works: it keys on the username as well, which is why a
    // missing or forged IP degrades the limiter rather than disabling it.
    expect(clientIpFromHeaders(headers({}))).toBeUndefined()
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '' }))).toBeUndefined()
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '  ,  ' }))).toBeUndefined()
  })
})
