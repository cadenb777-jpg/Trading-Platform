"""
What a company does, in a few sentences, shown the moment a company opens (Research, Security view): the opening of
its English Wikipedia article, found through Wikidata by the company's SEC CIK (property P5531), so the match is exact
rather than a name guess. Free and keyless; cached for 30 days; the reply names its source and links to it.
No match -> {about: None} and the page falls back to the SEC industry line.

Request: research.about {cik}
"""
import re
import urllib.parse

from .core import EngineError, handler
from .prospect_sources import WIKIDATA_SPARQL, web_json

SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/{title}'
QUERY = """SELECT ?article ?item WHERE {
  ?item wdt:P5531 "%s" .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
} LIMIT 1"""
MAX_CHARS = 900


def cik10(cik):
    digits = re.sub(r'\D', '', str(cik or ''))
    if not digits or len(digits) > 10:
        raise EngineError('A company needs its SEC CIK number to look up its description.')
    return digits.zfill(10)


def parse_article(data):
    """SPARQL reply -> (Wikipedia title, Wikidata id) or (None, None)."""
    for b in ((data or {}).get('results') or {}).get('bindings') or []:
        url = (b.get('article') or {}).get('value', '')
        item = (b.get('item') or {}).get('value', '').rsplit('/', 1)[-1]
        if url.startswith('https://en.wikipedia.org/wiki/'):
            return urllib.parse.unquote(url.rsplit('/wiki/', 1)[1]), item or None
    return None, None


def trim(text, limit=MAX_CHARS):
    """The summary cut at a sentence end within `limit` characters."""
    text = ' '.join((text or '').split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind('. '), cut.rfind('.'))
    return cut[:end + 1] if end > limit // 3 else cut.rstrip() + '…'


@handler('research.about')
async def about(ctx, msg):
    cik = cik10(msg.get('cik'))

    async def load():
        found = await web_json(ctx, WIKIDATA_SPARQL, {'query': QUERY % cik, 'format': 'json'}, {'Accept': 'application/sparql-results+json'})
        title, item = parse_article(found)
        if not title:
            return {'about': None}
        page = await web_json(ctx, SUMMARY.format(title=urllib.parse.quote(title.replace(' ', '_'), safe='')))
        text = trim((page or {}).get('extract', ''))
        if not text:
            return {'about': None}
        return {'about': text, 'source': 'Wikipedia', 'url': ((page.get('content_urls') or {}).get('desktop') or {}).get('page') or f'https://en.wikipedia.org/wiki/{title}',
                'wikidata': item, 'title': title}
    return await ctx.cached(('company-about', cik), 30 * 86400, load, persist=True, stale_ok=True)
