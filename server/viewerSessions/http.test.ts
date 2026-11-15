// @vitest-environment node
import type { Request } from 'express';
import { describe,expect,it } from 'vitest';
import { requireViewerOrigin,resourceManifestPath,resourceRange,validateViewerQuery,viewerCookieSecret,viewerHttpPolicy } from './http.js';

const policy = { origins:['http://127.0.0.1:5180','https://wfc.internal:8443'],allowHttpLoopback:true,trustProxy:false };
function request(headers: Record<string,string | undefined>,encrypted=false): Request {
  return { socket:{encrypted},header:(name: string) => headers[name.toLowerCase()] } as unknown as Request;
}
describe('viewer origin, cookie and raw resource boundary',() => {
  it('requires the exact origin and port for mutations and refuses cross-site resource reads',() => {
    expect(requireViewerOrigin(request({host:'127.0.0.1:5180',origin:'http://127.0.0.1:5180','sec-fetch-site':'same-origin'}),policy,true)).toEqual({secure:false});
    for (const headers of [
      {host:'127.0.0.1:5180'},
      {host:'127.0.0.1:5180',origin:'http://localhost:5180'},
      {host:'127.0.0.1',origin:'http://127.0.0.1'},
      {host:'127.0.0.1:5180',origin:'http://127.0.0.1:5180','sec-fetch-site':'same-site'},
    ]) expect(() => requireViewerOrigin(request(headers),policy,true)).toThrowError(expect.objectContaining({code:'VIEWER_ORIGIN_DENIED'}));
    expect(() => requireViewerOrigin(request({host:'127.0.0.1:5180','sec-fetch-site':'cross-site'}),policy,false)).toThrow();
    expect(() => requireViewerOrigin(request({host:'127.0.0.1:5180'}),{...policy,allowHttpLoopback:false},false)).toThrow();
  });
  it('trusts forwarded protocol only under the explicit private-proxy policy',() => {
    const req = request({host:'wfc.internal:8443',origin:'https://wfc.internal:8443','x-forwarded-proto':'https'});
    expect(() => requireViewerOrigin(req,policy,true)).toThrow();
    expect(requireViewerOrigin(req,{...policy,trustProxy:true},true)).toEqual({secure:true});
    expect(() => requireViewerOrigin(request({host:'wfc.internal:8443','x-forwarded-proto':'https,http'}),{...policy,trustProxy:true},false)).toThrow();
    expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:'http://192.0.2.1',WFC_VIEWER_ALLOW_HTTP_LOOPBACK:'true'})).toThrow();
    expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:'https://wfc.internal/path'})).toThrow();
  });
  it.each(['10.0.0.1','10.255.255.254','172.16.0.1','172.31.255.254','192.168.0.1','192.168.255.254'])('allows the exact private IPv4 origin %s only with explicit LAN HTTP opt-in',hostname => {
    const origin=`http://${hostname}:5173`;
    expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:origin})).toThrow();
    const lan=viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:origin,WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP:'true'});
    // Fetch Metadata headers can be absent on ordinary HTTP LAN origins.
    expect(requireViewerOrigin(request({host:`${hostname}:5173`,origin}),lan,true)).toEqual({secure:false});
    expect(requireViewerOrigin(request({host:`${hostname}:5173`}),lan,false)).toEqual({secure:false});
    expect(() => requireViewerOrigin(request({host:`${hostname}:5173`,origin}),{...lan,allowInsecureLanHttp:false},true)).toThrow();
    expect(() => requireViewerOrigin(request({host:`${hostname}:5174`,origin}),lan,true)).toThrow();
    expect(() => requireViewerOrigin(request({host:`${hostname}:5173`}),lan,true)).toThrow();
    expect(() => requireViewerOrigin(request({host:`${hostname}:5173`,origin:'http://192.168.1.2:5173'}),lan,true)).toThrow();
    expect(() => requireViewerOrigin(request({host:`${hostname}:5173`,origin,'sec-fetch-site':'cross-site'}),lan,false)).toThrow();
  });
  it.each(['172.15.255.255','172.32.0.1','192.169.0.1','8.8.8.8','100.64.0.1','169.254.1.1','0.0.0.0','[::]','[fd00::1]','wfc.internal','192.168.1.2.evil.invalid'])('refuses LAN HTTP opt-in for non-RFC1918 literal %s',hostname => {
    const origin=`http://${hostname}:5173`;
    expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:origin,WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP:'true'})).toThrow();
    expect(() => requireViewerOrigin(request({host:`${hostname}:5173`,origin}),{...policy,origins:[origin],allowInsecureLanHttp:true},true)).toThrow();
  });
  it('keeps loopback opt-in separate and refuses wildcard, aliased and non-origin LAN configuration',() => {
    for(const origin of ['http://localhost:5173','http://127.0.0.1:5173','http://192.168.1.1:5173/','http://user@192.168.1.1:5173','http://192.168.1.1:5173/path','http://192.168.*:5173','http://0xc0a80101:5173']) {
      expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:origin,WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP:'true'})).toThrow();
    }
    expect(viewerHttpPolicy({}).allowInsecureLanHttp).toBe(false);
    expect(() => viewerHttpPolicy({WFC_VIEWER_ALLOWED_ORIGINS:'http://192.168.1.1:5173',WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP:'TRUE'})).toThrow();
    const lan={...policy,origins:['http://192.168.1.1:5173'],allowInsecureLanHttp:true,trustProxy:true};
    expect(() => requireViewerOrigin(request({host:'192.168.1.1:5173',origin:'http://192.168.1.1:5173','x-forwarded-proto':'https'}),lan,true)).toThrow();
  });
  it('accepts one exact cookie secret without treating an ID, Bearer, duplicate or encoded cookie as a credential',() => {
    const secret='A'.repeat(43);
    expect(viewerCookieSecret(`other=x; wfc_viewer_session=${secret}`)).toBe(secret);
    for (const cookie of [undefined,'wfc_viewer_session=11111111-1111-4111-8111-111111111111',`wfc_viewer_session=${secret}; wfc_viewer_session=${secret}`,'wfc_viewer_session=Bearer-TOKEN',`wfc_viewer_session=%41${secret.slice(1)}`]) expect(() => viewerCookieSecret(cookie)).toThrow();
  });
  it('preserves manifest-relative paths and refuses encoded separators, traversal and double decoding',() => {
    expect(resourceManifestPath('output/0/0.svf')).toBe('resources/output/0/0.svf');
    for (const path of ['', '../private','output//0/0.svf','output/%2e%2e/private','output%2f0/0.svf','output%5c0/0.svf','output/%252e%252e/private','output/0/%00']) expect(() => resourceManifestPath(path)).toThrowError(expect.objectContaining({status:404}));
  });
  it('supports exactly one bounded byte range and rejects malformed or unsatisfiable requests',() => {
    expect(resourceRange(undefined,10)).toBeNull();
    for (const [input,expected] of [['bytes=0-0',{start:0,end:0}],['bytes=3-',{start:3,end:9}],['bytes=-4',{start:6,end:9}],['bytes=4-99',{start:4,end:9}],['bytes=-99',{start:0,end:9}]] as const) expect(resourceRange(input,10)).toEqual(expected);
    for (const input of ['bytes=','bytes=-','bytes=-0','bytes=10-','bytes=4-3','bytes=0-1,3-4','items=0-1','bytes=9007199254740992-']) expect(() => resourceRange(input,10)).toThrowError(expect.objectContaining({status:416}));
    expect(() => resourceRange('bytes=0-',0)).toThrow();
  });
  it('accepts only the pinned SDK same-origin domain resource metadata',() => {
    const origin='http://127.0.0.1:5180';
    expect(() => validateViewerQuery('/resource',origin)).not.toThrow();
    expect(() => validateViewerQuery(`/resource?domain=${encodeURIComponent(origin)}`,origin)).not.toThrow();
    for(const query of ['','domain=http%3A%2F%2Flocalhost%3A5180','domain=https%3A%2F%2Fforeign.invalid','domain='+encodeURIComponent(origin)+'&domain='+encodeURIComponent(origin),'domain='+encodeURIComponent(origin)+'&access_token=forbidden','acmsession=forbidden','unknown=x']) {
      expect(() => validateViewerQuery('/resource?'+query,origin)).toThrowError(expect.objectContaining({code:'INVALID_VIEWER_REQUEST'}));
    }
    expect(() => validateViewerQuery(`/descriptor?domain=${encodeURIComponent(origin)}`)).toThrow();
  });
});

it('preserves nested raster names with URI-encoded spaces for exact manifest lookup', () => {
  expect(resourceManifestPath('output/0/Texture%20Folder/Fixture%20Logo.png')).toBe('resources/output/0/Texture Folder/Fixture Logo.png');
  expect(resourceManifestPath('output/0/Texture Folder/Fixture Logo.jpg')).toBe('resources/output/0/Texture Folder/Fixture Logo.jpg');
  for (const raw of ['output/0/Texture%2520Folder/a.png', 'output/0/Texture%20Folder%2Fa.png', 'output/0/Texture%20Folder/%2e%2e/a.png']) {
    expect(() => resourceManifestPath(raw)).toThrow();
  }
});
