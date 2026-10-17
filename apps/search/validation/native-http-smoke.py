import json, math, statistics, time, urllib.request, urllib.error, urllib.parse
base='http://127.0.0.1:3137'
def call(path,body=None,expected=200):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=15) as r:
            assert r.status==expected
            return json.load(r)
    except urllib.error.HTTPError as e:
        assert e.code==expected,(e.code,e.read().decode())
        return json.load(e)
p=call('/api/search/parse',{'prompt':'cheapest downtown apartment'})
assert p['parser']=='fallback'
intent=p['intent'];s=call('/api/listings/search',{'intent':intent})
assert s['status']=='completed' and len(s['results'])>0
assert all(r['id']==r['listing']['id'] and r['valuation']['status']=='insufficient_data' and r['valuation']['benchmark'] is None for r in s['results'])
redacted={**intent,'rawPrompt':'','fieldSources':{},'droppedRequests':[]}
detailPath='/api/listings/'+s['results'][0]['id']+'?intent='+urllib.parse.quote(json.dumps(redacted))
d=call(detailPath)
assert d['id']==s['results'][0]['id'] and d['matchScore']==s['results'][0]['matchScore'] and d['valuation']==s['results'][0]['valuation']
r=call('/api/geo/resolve?q=university%20of%20toronto')
assert r['status']=='ambiguous' and len(r['choices'])==3
invalid=call('/api/listings/search',{},422)
assert invalid['error']['code']=='validation_error'
travel=call('/api/search/parse',{'prompt':'within 10 minutes biking to Union Station'})['intent']
assert travel['travelTargets'] and travel['travelTargets'][0]['resolved']
travel['numericExtreme']={'field':'travel','direction':'min','percentage':5,'targetId':travel['travelTargets'][0]['id']}
pending=call('/api/listings/search',{'intent':travel})
assert pending['status']=='pending' and len(pending['jobToken'])>=32
for _ in range(20):
    terminal=call(pending['pollUrl'])
    if terminal['status']!='pending':break
    time.sleep(.01)
assert terminal['status']=='unavailable' and terminal['reason']=='routing_incomplete'
assert call(pending['pollUrl'],expected=410)['error']['code']=='search_job_expired'
scalar={**redacted,'numericExtreme':{'field':'rent','direction':'min','percentage':5}}
bench={}
for name,action in [('fallback_parse',lambda:call('/api/search/parse',{'prompt':'cheapest downtown apartment'})),('ordinary_search',lambda:call('/api/listings/search',{'intent':redacted})),('scalar_percentile',lambda:call('/api/listings/search',{'intent':scalar})),('context_detail',lambda:call(detailPath))]:
    samples=[]
    for _ in range(8):
        start=time.perf_counter();out=action();samples.append((time.perf_counter()-start)*1000)
        assert 'error' not in out
    samples.sort();bench[name]={'medianMs':round(statistics.median(samples),2),'p95Ms':round(samples[math.ceil(.95*len(samples))-1],2),'iterations':len(samples),'synthetic':True}
print(json.dumps({'results':len(s['results']),'identity_consistent':True,'destination_choices':len(r['choices']),'exact_percentile':terminal['reason'],'consumed_job':410,'native_http_fixture_benchmarks':bench},indent=2))
