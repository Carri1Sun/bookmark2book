import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Bookmark, Source } from '../shared/types';

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
export function validatePublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('仅支持公开的 HTTP/HTTPS 网页。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    (ipaddr.isValid(hostname) && !isPublicAddress(hostname))
  )
    throw new Error('不读取本机或内网地址。');
  return url;
}
// Resolve to public addresses inside the actual socket lookup. Some local network
// proxies return 198.18/15 fake IPs; resolve those through a fixed DoH endpoint,
// validate the real answers, and pin the connection to them. Never allow fake IPs.
const dnsCache = new Map<string, { expires: number; addresses: dns.LookupAddress[] }>();
export async function publicLookup(hostname: string): Promise<dns.LookupAddress[]> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.addresses;
  let addresses = await dns.promises.lookup(hostname, { all: true });
  if (
    addresses.length &&
    addresses.every(
      (entry) =>
        ipaddr.parse(entry.address).kind() === 'ipv4' &&
        ipaddr.parse(entry.address).match(ipaddr.parseCIDR('198.18.0.0/15')),
    )
  ) {
    const response = await globalThis.fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error('公网域名解析失败。');
    const result = (await response.json()) as {
      Status?: number;
      Answer?: { type: number; data: string }[];
    };
    if (result.Status !== 0) throw new Error('公网域名解析失败。');
    addresses = (result.Answer || [])
      .filter((answer) => answer.type === 1)
      .map((answer) => ({ address: answer.data, family: 4 }));
  }
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
    throw new Error('不读取本机或内网地址。');
  dnsCache.set(hostname, { expires: Date.now() + 60_000, addresses });
  return addresses;
}
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      void publicLookup(hostname)
        .then((addresses) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        })
        .catch((error) => callback(error, '', 4));
    },
  },
});
const MAX_BYTES = 2_500_000;
const MAX_CONTENT = 14000;
export async function extractSource(bookmark: Bookmark, signal: AbortSignal): Promise<Source> {
  try {
    let url = validatePublicUrl(bookmark.url);
    let html = '';
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetch(url, {
        dispatcher,
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]),
        headers: {
          'User-Agent': 'BookmarkPress/0.1 (personal reading; public pages only)',
          Accept: 'text/html,application/xhtml+xml,text/plain',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 4) throw new Error('网页跳转次数过多。');
        url = validatePublicUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`网页暂时无法访问（${response.status}）。`);
      }
      if (
        !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(
          response.headers.get('content-type') || '',
        )
      ) {
        await response.body?.cancel();
        throw new Error('暂不支持此文件类型，可选择文章网页。');
      }
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error('网页过大，未读取正文。');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) throw new Error('网页过大，未读取正文。');
        chunks.push(chunk);
      }
      html = Buffer.concat(chunks).toString('utf8');
      break;
    }
    const dom = new JSDOM(html, { url: url.href });
    try {
      const doc = dom.window.document;
      doc.querySelectorAll('script,style,noscript,iframe,form').forEach((el) => el.remove());
      const description =
        doc
          .querySelector('meta[name="description"],meta[property="og:description"]')
          ?.getAttribute('content') || '';
      const article = new Readability(doc.cloneNode(true) as Document).parse();
      const title = (article?.title || doc.title || bookmark.title).trim().slice(0, 500);
      const text = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (text.length < 200)
        return {
          ...bookmark,
          title,
          status: 'metadata',
          content: description.slice(0, 1200),
          error: '正文较少或需登录，仅使用标题与网页简介。',
          wordCount: text.length,
        };
      return {
        ...bookmark,
        title,
        status: text.length > MAX_CONTENT ? 'excerpt' : 'full',
        content: text.slice(0, MAX_CONTENT),
        wordCount: text.length,
      };
    } finally {
      dom.window.close();
    }
  } catch (error) {
    if (signal.aborted) throw error;
    const message = error instanceof Error ? error.message : '';
    const safe = /^(网页|正文|不读取|仅支持|暂不支持)/.test(message)
      ? message
      : '网页无法读取，可能需要登录或暂时不可访问。';
    return { ...bookmark, status: 'unavailable', error: safe };
  }
}
